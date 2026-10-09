// Tác vụ: danh sách, xem, xử lý thủ công, xóa, đính kèm, lịch sử, cập nhật theo lô.
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { isAdmin } from '../auth';
import { Actor, HttpError, ah, bad, diff, idParam, logHistory, notFound, notify, parseJson, prisma, toInt } from '../core';
import { TASK_LIMITS, TASK_STATUS } from '../../../shared/constants';
import { FormSnapshot, pruneValues, validateDynamicValues } from '../../../shared/form';
import { getCalendar } from '../services/calendar';
import { ResultSnap, evaluateStep, resultLeaves, resultPath } from '../services/engine';
import {
  UPLOAD_DIR,
  deptSubtree,
  dynChanges,
  listAttachments,
  removeFiles,
  saveAttachments,
  taskSummary,
  upload,
  validateAssignment,
} from './helpers';

export const taskRouter = Router();

const actorOf = (req: any): Actor => ({ id: req.user.id, fullName: req.user.fullName });
const label = (s: string) => (TASK_STATUS as any)[s]?.label ?? s;
const dynErrors = (errs: Record<string, string>) => Object.fromEntries(Object.entries(errs).map(([k, v]) => [`dyn.${k}`, v]));

// ───── Danh sách tác vụ ─────

taskRouter.get(
  '/tasks',
  ah(async (req, res) => {
    const q = req.query;
    const AND: any[] = [];
    const scope = String(q.scope || 'assigned');
    if (scope === 'assigned') AND.push({ assigneeId: req.user.id });
    if (scope === 'created') AND.push({ creatorId: req.user.id });
    if (scope === 'department' && req.user.departmentId) AND.push({ departmentId: { in: await deptSubtree(req.user.departmentId) } });
    if (q.status) AND.push({ status: { in: String(q.status).split(',') } });
    if (q.q) {
      const s = String(q.q).trim();
      AND.push({ OR: [{ code: { contains: s } }, { ticket: { code: { contains: s } } }, { step: { name: { contains: s } } }] });
    }
    if (toInt(q.departmentId)) AND.push({ departmentId: { in: await deptSubtree(toInt(q.departmentId)!) } });
    if (toInt(q.assigneeId)) AND.push({ assigneeId: toInt(q.assigneeId) });
    if (q.overdue === 'true') AND.push({ status: { not: 'DONE' }, dueAt: { lt: new Date() } });
    if (q.open === 'true') AND.push({ status: { not: 'DONE' } });
    AND.push({ step: { status: { not: 'CANCELLED' } } });
    const where = { AND };
    const page = Math.max(1, toInt(q.page) ?? 1);
    const pageSize = Math.min(100, Math.max(5, toInt(q.pageSize) ?? 20));
    const [items, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: { assignee: true, department: true, creator: true, step: true, ticket: { include: { customer: true } } },
        orderBy: [{ dueAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.task.count({ where }),
    ]);
    res.json({
      items: items.map((t) => ({
        ...taskSummary(t),
        stepName: t.step.name,
        ticketCode: t.ticket.code,
        ticketStatus: t.ticket.status,
        customerName: t.ticket.customer?.fullName ?? null,
      })),
      total,
      page,
      pageSize,
    });
  }),
);

// ───── Chi tiết tác vụ ─────

async function taskDetail(id: number) {
  const t = await prisma.task.findUnique({
    where: { id },
    include: { assignee: true, department: true, creator: true, step: true, ticket: { include: { customer: true } } },
  });
  if (!t) throw notFound('Tác vụ');
  return {
    ...taskSummary(t),
    description: t.description,
    note: t.note,
    resultKey: t.resultKey,
    notifyChannels: parseJson<string[]>(t.notifyChannels, []),
    dynamicValues: parseJson(t.dynamicValues, {}),
    step: {
      id: t.step.id,
      name: t.step.name,
      status: t.step.status,
      cancelled: t.step.status === 'CANCELLED' || t.step.generation !== t.ticket.serviceVersion,
      expectedResult: t.step.expectedResult,
      form: parseJson<FormSnapshot | null>(t.step.formSnapshot, null),
      results: parseJson<ResultSnap[]>(t.step.resultsSnapshot, []),
    },
    ticket: {
      id: t.ticket.id,
      code: t.ticket.code,
      status: t.ticket.status,
      customerId: t.ticket.customerId,
      customerName: t.ticket.customer?.fullName ?? null,
      ownerId: t.ticket.ownerId,
    },
    attachments: await listAttachments('TASK', t.id),
  };
}

taskRouter.get(
  '/tasks/:id',
  ah(async (req, res) => {
    const id = idParam(req);
    if (req.query.open === '1') {
      const t = await prisma.task.findUnique({ where: { id } });
      if (!t) throw notFound('Tác vụ');
      // Người được phân giao mở tác vụ đang Mới → tự chuyển Đang xử lý
      if (t.status === 'NEW' && t.assigneeId === req.user.id) {
        await prisma.$transaction(async (tx) => {
          await tx.task.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
          await logHistory(tx, {
            entityType: 'TASK',
            entityId: id,
            actor: actorOf(req),
            action: 'OPEN',
            summary: 'Người được phân giao mở tác vụ',
            changes: [{ field: 'status', label: 'Trạng thái', oldValue: 'Mới', newValue: 'Đang xử lý' }],
          });
        });
      }
    }
    res.json(await taskDetail(id));
  }),
);

taskRouter.get(
  '/tasks/:id/history',
  ah(async (req, res) => {
    const list = await prisma.history.findMany({
      where: { entityType: 'TASK', entityId: idParam(req) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    res.json(list.map((h) => ({ ...h, changes: parseJson(h.changes, []) })));
  }),
);

// ───── Xử lý tác vụ ─────

const ACTION_STATUS: Record<string, string> = {
  RETURN: 'RETURNED',
  REPORT_DONE: 'REPORTED_DONE',
  DONE: 'DONE',
};
const ACTION_LABEL: Record<string, string> = {
  RECEIVE: 'Nhận tác vụ',
  UPDATE: 'Cập nhật',
  RETURN: 'Trả lại xử lý',
  REPORT_DONE: 'Báo hoàn thành',
  DONE: 'Hoàn thành',
};

taskRouter.post(
  '/tasks/:id/action',
  ah(async (req, res) => {
    const id = idParam(req);
    const action = String(req.body?.action || '');
    if (!ACTION_LABEL[action]) throw bad('Thao tác không hợp lệ');
    const t = await prisma.task.findUnique({ where: { id }, include: { step: true, ticket: true, assignee: true, department: true } });
    if (!t) throw notFound('Tác vụ');
    if (t.status === 'DONE') throw bad('Tác vụ đã Hoàn thành, không thể thao tác');
    if (t.step.status === 'CANCELLED' || t.step.generation !== t.ticket.serviceVersion)
      throw bad('Công việc của tác vụ đã bị hủy (thay đổi dịch vụ), không thể thao tác');
    const actor = actorOf(req);
    const b = req.body || {};
    const results = parseJson<ResultSnap[]>(t.step.resultsSnapshot, []);
    const form = parseJson<FormSnapshot | null>(t.step.formSnapshot, null);
    const items = form?.items ?? [];
    const oldValues = parseJson<Record<string, any>>(t.dynamicValues, {});

    let departmentId = t.departmentId;
    let assigneeId = t.assigneeId;
    let resultKey = t.resultKey;
    let status = t.status;
    let note = b.note !== undefined ? b.note || null : t.note;
    let values = oldValues;

    if (action === 'RECEIVE') {
      const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (!me.departmentId) throw bad('Bạn chưa thuộc phòng ban nào trên cây đơn vị');
      departmentId = me.departmentId;
      assigneeId = me.id;
      status = 'IN_PROGRESS';
    } else {
      const locked = t.status === 'REPORTED_DONE';
      if (!locked) {
        const a = await validateAssignment(b.departmentId ?? t.departmentId, b.assigneeId ?? t.assigneeId);
        departmentId = a.departmentId;
        assigneeId = a.assigneeId;
        if (b.resultKey !== undefined) resultKey = b.resultKey || null;
      }
      if (resultKey && !resultLeaves(results).some((r) => r.key === resultKey))
        throw bad('Kết quả không hợp lệ', { resultKey: 'Vui lòng chọn Kết quả tới level cuối cùng' });
      if (b.dynamicValues && typeof b.dynamicValues === 'object') values = b.dynamicValues;
      if (ACTION_STATUS[action]) {
        const errors: Record<string, string> = {};
        if (!resultKey) errors.resultKey = 'Vui lòng chọn Kết quả';
        Object.assign(errors, dynErrors(validateDynamicValues(items, values)));
        if (Object.keys(errors).length) throw bad('Dữ liệu không hợp lệ, vui lòng kiểm tra lại', errors);
      }
      // Thay đổi người phụ trách tác vụ → reset trạng thái Mới
      if (assigneeId !== t.assigneeId) status = 'NEW';
      if (ACTION_STATUS[action]) status = ACTION_STATUS[action];
    }

    const newValues = pruneValues(items, values);
    const [dept, assignee] = await Promise.all([
      departmentId ? prisma.department.findUnique({ where: { id: departmentId } }) : null,
      assigneeId ? prisma.user.findUnique({ where: { id: assigneeId } }) : null,
    ]);
    const changes = diff([
      { field: 'departmentId', label: 'Phòng ban chuyên xử lý', old: t.department?.name, new: dept?.name },
      { field: 'assigneeId', label: 'Nhân sự chuyên xử lý', old: t.assignee?.fullName, new: assignee?.fullName },
      { field: 'resultKey', label: 'Kết quả', old: t.resultKey ? resultPath(results, t.resultKey) : null, new: resultKey ? resultPath(results, resultKey) : null },
      { field: 'note', label: 'Ghi chú xử lý', old: t.note, new: note },
      { field: 'status', label: 'Trạng thái', old: label(t.status), new: label(status) },
    ]);
    changes.push(...(await dynChanges(items, oldValues, newValues)));

    const cal = await getCalendar();
    await prisma.$transaction(
      async (tx) => {
        await tx.task.update({
          where: { id },
          data: {
            departmentId,
            assigneeId,
            resultKey,
            resultLabel: resultKey ? resultPath(results, resultKey) : null,
            note,
            status,
            dynamicValues: JSON.stringify(newValues),
            completedAt: status === 'DONE' ? new Date() : null,
          },
        });
        await logHistory(tx, { entityType: 'TASK', entityId: id, actor, action, summary: ACTION_LABEL[action], changes });
        if (assigneeId && assigneeId !== t.assigneeId && assigneeId !== actor.id)
          await notify(tx, assigneeId, `Tác vụ ${t.code}`, `Bạn được giao xử lý công việc "${t.step.name}" của phiếu ${t.ticket.code}`, `/tickets/${t.ticketId}?task=${id}`);
        if (action === 'RETURN' || action === 'REPORT_DONE') {
          const targets = new Set([t.creatorId, t.ticket.ownerId].filter((x): x is number => !!x && x !== actor.id));
          for (const u of targets)
            await notify(tx, u, `Tác vụ ${t.code} – ${ACTION_LABEL[action]}`, `${actor.fullName}: ${ACTION_LABEL[action]} công việc "${t.step.name}" (phiếu ${t.ticket.code})`, `/tickets/${t.ticketId}?task=${id}`);
        }
        if (status === 'DONE') {
          await logHistory(tx, {
            entityType: 'TICKET',
            entityId: t.ticketId,
            actor,
            action: 'TASK_DONE',
            summary: `Tác vụ ${t.code} (công việc "${t.step.name}") Hoàn thành – kết quả: ${resultPath(results, resultKey!)}`,
          });
          await evaluateStep(tx, t.ticketStepId, cal);
        }
      },
      { timeout: 30000 },
    );
    res.json(await taskDetail(id));
  }),
);

// ───── Xóa tác vụ ─────

taskRouter.delete(
  '/tasks/:id',
  ah(async (req, res) => {
    const id = idParam(req);
    const t = await prisma.task.findUnique({ where: { id }, include: { step: true } });
    if (!t) throw notFound('Tác vụ');
    if (!['NEW', 'IN_PROGRESS'].includes(t.status)) throw bad('Chỉ được xóa tác vụ ở trạng thái Mới hoặc Đang xử lý');
    const files = await prisma.attachment.findMany({ where: { ownerType: 'TASK', ownerId: id } });
    const cal = await getCalendar();
    await prisma.$transaction(
      async (tx) => {
        await tx.attachment.deleteMany({ where: { ownerType: 'TASK', ownerId: id } });
        await tx.task.delete({ where: { id } });
        await logHistory(tx, {
          entityType: 'TICKET',
          entityId: t.ticketId,
          actor: actorOf(req),
          action: 'TASK_DELETE',
          summary: `Xóa tác vụ ${t.code} – công việc "${t.step.name}"`,
        });
        await evaluateStep(tx, t.ticketStepId, cal);
      },
      { timeout: 30000 },
    );
    for (const f of files) fs.promises.unlink(path.join(UPLOAD_DIR, f.storedName)).catch(() => undefined);
    res.json({ ok: true });
  }),
);

// ───── File đính kèm của tác vụ (lưu riêng, không ghi về phiếu) ─────

taskRouter.post(
  '/tasks/:id/attachments',
  upload.array('files', TASK_LIMITS.maxFiles),
  ah(async (req, res) => {
    const id = idParam(req);
    const files = (req.files as Express.Multer.File[]) || [];
    const t = await prisma.task.findUnique({ where: { id } });
    if (!t) {
      removeFiles(files);
      throw notFound('Tác vụ');
    }
    const current = await prisma.attachment.count({ where: { ownerType: 'TASK', ownerId: id } });
    if (current + files.length > TASK_LIMITS.maxFiles) {
      removeFiles(files);
      throw bad(`Mỗi tác vụ tối đa ${TASK_LIMITS.maxFiles} file (hiện có ${current} file)`);
    }
    const saved = await prisma.$transaction(async (tx) => {
      const out = await saveAttachments(tx, 'TASK', id, files, req.user.id);
      if (out.length)
        await logHistory(tx, {
          entityType: 'TASK',
          entityId: id,
          actor: actorOf(req),
          action: 'ATTACH',
          summary: 'Bổ sung file đính kèm',
          changes: [{ field: 'attachments', label: 'Đính kèm file', oldValue: null, newValue: out.map((a) => a.fileName).join(', ') }],
        });
      return out;
    });
    res.json(saved);
  }),
);

// ───── File: tải về / xóa ─────

taskRouter.get(
  '/attachments/:id/download',
  ah(async (req, res) => {
    const a = await prisma.attachment.findUnique({ where: { id: idParam(req) } });
    if (!a) throw notFound('File');
    const p = path.join(UPLOAD_DIR, a.storedName);
    if (!fs.existsSync(p)) throw notFound('File');
    if (req.query.inline === '1') {
      res.setHeader('Content-Type', a.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
      return res.sendFile(p);
    }
    res.download(p, a.fileName);
  }),
);

taskRouter.delete(
  '/attachments/:id',
  ah(async (req, res) => {
    const a = await prisma.attachment.findUnique({ where: { id: idParam(req) } });
    if (!a) throw notFound('File');
    if (a.uploadedById !== req.user.id && !isAdmin(req)) throw new HttpError(403, 'Chỉ người tải lên mới được xóa file');
    if (a.ownerType === 'TASK') {
      const t = await prisma.task.findUnique({ where: { id: a.ownerId } });
      if (t?.status === 'DONE') throw bad('Tác vụ đã hoàn thành, không thể xóa file');
    }
    await prisma.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: a.id } });
      await logHistory(tx, {
        entityType: a.ownerType as any,
        entityId: a.ownerId,
        actor: actorOf(req),
        action: 'DETACH',
        changes: [{ field: 'attachments', label: 'Đính kèm file', oldValue: a.fileName, newValue: null }],
      });
    });
    fs.promises.unlink(path.join(UPLOAD_DIR, a.storedName)).catch(() => undefined);
    res.json({ ok: true });
  }),
);

// ───── Cập nhật theo lô ─────

export async function batchUpdateTasks(taskIds: number[], body: any, actor: Actor) {
  if (!taskIds.length) throw bad('Không có tác vụ nào phù hợp để cập nhật (chỉ cập nhật tác vụ Mới / Đang xử lý / Trả lại xử lý)');
  const { departmentId, assigneeId } = await validateAssignment(body?.departmentId, body?.assigneeId);
  const [dept, user] = await Promise.all([
    prisma.department.findUniqueOrThrow({ where: { id: departmentId } }),
    prisma.user.findUniqueOrThrow({ where: { id: assigneeId } }),
  ]);
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    include: { assignee: true, department: true, step: true, ticket: true },
  });
  let updated = 0;
  const skipped: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      for (const t of tasks) {
        if (!['NEW', 'IN_PROGRESS', 'RETURNED'].includes(t.status) || t.step.status === 'CANCELLED') {
          skipped.push(t.code);
          continue;
        }
        const changed = t.assigneeId !== assigneeId;
        const status = changed ? 'NEW' : t.status;
        const changes = diff([
          { field: 'departmentId', label: 'Phòng ban chuyên xử lý', old: t.department?.name, new: dept.name },
          { field: 'assigneeId', label: 'Nhân sự chuyên xử lý', old: t.assignee?.fullName, new: user.fullName },
          { field: 'status', label: 'Trạng thái', old: label(t.status), new: label(status) },
        ]);
        if (!changes.length) continue;
        await tx.task.update({ where: { id: t.id }, data: { departmentId, assigneeId, status } });
        await logHistory(tx, { entityType: 'TASK', entityId: t.id, actor, action: 'BATCH_UPDATE', summary: 'Cập nhật theo lô', changes });
        if (changed && assigneeId !== actor.id)
          await notify(tx, assigneeId, `Tác vụ ${t.code}`, `Bạn được giao xử lý công việc "${t.step.name}" của phiếu ${t.ticket.code}`, `/tickets/${t.ticketId}?task=${t.id}`);
        updated++;
      }
    },
    { timeout: 60000 },
  );
  return { updated, skipped, total: tasks.length };
}

taskRouter.post(
  '/tasks/batch-update',
  ah(async (req, res) => {
    const ids: number[] = (req.body?.taskIds || []).map(Number).filter(Boolean);
    if (!ids.length) throw bad('Vui lòng chọn tác vụ');
    res.json(await batchUpdateTasks(ids, req.body, actorOf(req)));
  }),
);
