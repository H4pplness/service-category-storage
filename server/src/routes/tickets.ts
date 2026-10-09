// Phiếu: tạo, xem, sửa (kể cả đổi dịch vụ), đổi trạng thái, sinh tác vụ, cập nhật tác vụ theo lô.
import { Router } from 'express';
import { isAdmin } from '../auth';
import { Actor, HttpError, ah, bad, diff, genTicketCode, idParam, logHistory, notFound, notify, parseJson, prisma, toInt } from '../core';
import { CHANNELS, CHANNEL_LABEL, NOTIFY_CHANNELS, TASK_LIMITS } from '../../../shared/constants';
import { FormSnapshot, pruneValues, validateDynamicValues } from '../../../shared/form';
import { addDuration, WorkHoursMode } from '../../../shared/sla';
import { getCalendar } from '../services/calendar';
import { AutoGenError, autoGenerate, createTask, instantiateSteps, statusLabel } from '../services/engine';
import { resolveServiceConfig, TicketConfigSnapshot } from '../services/snapshot';
import { batchUpdateTasks } from './tasks';
import {
  dynChanges,
  listAttachments,
  removeFiles,
  saveAttachments,
  taskSummary,
  ticketSummary,
  upload,
  validateAssignment,
} from './helpers';

export const ticketRouter = Router();

const listInclude = { product: true, operation: true, owner: true, creator: true, customer: true, service: true };
const actorOf = (req: any): Actor => ({ id: req.user.id, fullName: req.user.fullName });

function dynErrors(errs: Record<string, string>) {
  return Object.fromEntries(Object.entries(errs).map(([k, v]) => [`dyn.${k}`, v]));
}

async function validateLeaf(model: 'product' | 'operation', id: number | undefined, field: string, label: string, errors: Record<string, string>) {
  if (!id) {
    errors[field] = `Vui lòng chọn ${label}`;
    return null;
  }
  const x = await (prisma as any)[model].findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
  if (!x || !x.active) errors[field] = `${label} không tồn tại hoặc đã ngừng sử dụng`;
  else if (x._count.children) errors[field] = `Vui lòng chọn ${label} tới level cuối cùng`;
  return x;
}

// ───── Danh sách ─────

ticketRouter.get(
  '/tickets',
  ah(async (req, res) => {
    const q = req.query;
    const where: any = { AND: [] };
    if (q.q) {
      const s = String(q.q).trim();
      where.AND.push({ OR: [{ code: { contains: s } }, { customer: { fullName: { contains: s } } }, { customer: { cif: { contains: s } } }] });
    }
    if (q.status) where.AND.push({ status: { in: String(q.status).split(',') } });
    if (toInt(q.productId)) where.AND.push({ productId: toInt(q.productId) });
    if (toInt(q.operationId)) where.AND.push({ operationId: toInt(q.operationId) });
    if (toInt(q.ownerId)) where.AND.push({ ownerId: toInt(q.ownerId) });
    if (q.channel) where.AND.push({ channel: String(q.channel) });
    if (q.scope === 'owner') where.AND.push({ ownerId: req.user.id });
    if (q.scope === 'created') where.AND.push({ creatorId: req.user.id });
    if (q.scope === 'assigned') where.AND.push({ tasks: { some: { assigneeId: req.user.id } } });
    if (q.from) where.AND.push({ createdAt: { gte: new Date(String(q.from)) } });
    if (q.to) where.AND.push({ createdAt: { lte: new Date(String(q.to)) } });
    if (q.overdue === 'true') where.AND.push({ status: { not: 'DONE' }, dueAt: { lt: new Date() } });
    const page = Math.max(1, toInt(q.page) ?? 1);
    const pageSize = Math.min(100, Math.max(5, toInt(q.pageSize) ?? 20));
    const [items, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: { ...listInclude, _count: { select: { tasks: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.ticket.count({ where }),
    ]);
    res.json({ items: items.map((t) => ({ ...ticketSummary(t), taskCount: t._count.tasks })), total, page, pageSize });
  }),
);

ticketRouter.get(
  '/tickets/search',
  ah(async (req, res) => {
    const s = String(req.query.q || '').trim();
    const list = await prisma.ticket.findMany({
      where: s ? { code: { contains: s } } : {},
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, status: true },
    });
    res.json(list);
  }),
);

// ───── Tạo phiếu ─────

ticketRouter.post(
  '/tickets',
  ah(async (req, res) => {
    const b = req.body || {};
    const errors: Record<string, string> = {};
    if (!CHANNELS.some((c) => c.value === b.channel)) errors.channel = 'Vui lòng chọn Kênh';
    const productId = toInt(b.productId);
    const operationId = toInt(b.operationId);
    await validateLeaf('product', productId, 'productId', 'Sản phẩm', errors);
    await validateLeaf('operation', operationId, 'operationId', 'Nghiệp vụ', errors);
    const ownerId = toInt(b.ownerId);
    const owner = ownerId ? await prisma.user.findUnique({ where: { id: ownerId } }) : null;
    if (!owner || !owner.active) errors.ownerId = 'Vui lòng chọn Người phụ trách phiếu (đang hoạt động)';
    const customerId = toInt(b.customerId) ?? null;
    const customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
    if (customerId && !customer) errors.customerId = 'Khách hàng không tồn tại';
    if (Object.keys(errors).length) throw bad('Dữ liệu không hợp lệ, vui lòng kiểm tra lại', errors);

    const cfg = await resolveServiceConfig(prisma, productId!, operationId!, customer?.segment);
    const values = (b.dynamicValues && typeof b.dynamicValues === 'object' ? b.dynamicValues : {}) as Record<string, unknown>;
    const items = cfg.form?.items ?? [];
    const dErr = validateDynamicValues(items, values, { ticketOnly: true });
    if (Object.keys(dErr).length) throw bad('Thông tin động chưa hợp lệ', dynErrors(dErr));
    const linked = await prisma.ticket.findMany({ where: { id: { in: (b.linkedTicketIds || []).map(Number) } }, select: { id: true } });

    const cal = await getCalendar();
    const creator = actorOf(req);
    const result = await prisma.$transaction(
      async (tx) => {
        const code = await genTicketCode(tx);
        const now = new Date();
        const mode = cfg.service.workHoursMode as WorkHoursMode;
        const dueAt = new Date(addDuration(mode, cal, now.getTime(), cfg.slaMinutes));
        const status = creator.id === owner!.id ? 'IN_PROGRESS' : 'NEW';
        const ticket = await tx.ticket.create({
          data: {
            code,
            channel: b.channel,
            status,
            productId: productId!,
            operationId: operationId!,
            serviceId: cfg.service.id,
            customerId,
            segment: customer?.segment ?? null,
            ownerId: owner!.id,
            creatorId: creator.id,
            description: b.description || null,
            exchangeContent: b.exchangeContent || null,
            resolutionSummary: b.resolutionSummary || null,
            linkedTicketIds: JSON.stringify(linked.map((l) => l.id)),
            workHoursMode: mode,
            slaMinutes: cfg.slaMinutes,
            slaStartAt: now,
            dueAt,
            configSnapshot: JSON.stringify(cfg.snapshot),
            dynamicValues: JSON.stringify(pruneValues(items, values, { ticketOnly: true })),
            createdAt: now,
          },
        });
        await logHistory(tx, {
          entityType: 'TICKET',
          entityId: ticket.id,
          actor: creator,
          action: 'CREATE',
          summary: `Tạo phiếu – dịch vụ ${cfg.service.code}, quy trình "${cfg.workflow.name}"`,
          changes: [
            { field: 'status', label: 'Trạng thái', oldValue: null, newValue: statusLabel(status) },
            { field: 'ownerId', label: 'Người phụ trách', oldValue: null, newValue: owner!.fullName },
            { field: 'dueAt', label: 'Thời hạn hoàn thành', oldValue: null, newValue: dueAt.toISOString() },
          ],
        });
        if (owner!.id !== creator.id)
          await notify(tx, owner!.id, `Phiếu mới ${code}`, `${creator.fullName} đã tạo phiếu và giao bạn phụ trách`, `/tickets/${ticket.id}`);
        const steps = await instantiateSteps(tx, ticket.id, 1, cfg.workflow);
        const gen = await autoGenerate(tx, ticket.id, steps[0].id, cal);
        return { ticket, autoGen: gen };
      },
      { timeout: 30000 },
    );
    res.json({
      id: result.ticket.id,
      code: result.ticket.code,
      autoGenError: result.autoGen.ok ? null : (result.autoGen as any).error ?? null,
    });
  }),
);

// ───── Chi tiết ─────

async function ticketDetail(id: number) {
  const t = await prisma.ticket.findUnique({
    where: { id },
    include: {
      ...listInclude,
      steps: {
        orderBy: [{ generation: 'desc' }, { sortOrder: 'asc' }],
        include: { tasks: { include: { assignee: true, department: true, creator: true }, orderBy: { createdAt: 'asc' } } },
      },
    },
  });
  if (!t) throw notFound('Phiếu');
  const linkedIds = parseJson<number[]>(t.linkedTicketIds, []);
  const [linked, attachments, depts, users] = await Promise.all([
    prisma.ticket.findMany({ where: { id: { in: linkedIds } }, select: { id: true, code: true, status: true } }),
    listAttachments('TICKET', t.id),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, fullName: true } }),
  ]);
  return {
    ...ticketSummary(t),
    description: t.description,
    exchangeContent: t.exchangeContent,
    resolutionSummary: t.resolutionSummary,
    customer: t.customer,
    linkedTickets: linked,
    linkedTicketIds: linkedIds,
    snapshot: parseJson<TicketConfigSnapshot | null>(t.configSnapshot, null),
    dynamicValues: parseJson(t.dynamicValues, {}),
    autoGenError: parseJson<AutoGenError | null>(t.autoGenError, null),
    serviceVersion: t.serviceVersion,
    attachments,
    steps: t.steps.map((s) => ({
      id: s.id,
      generation: s.generation,
      isOld: s.generation !== t.serviceVersion,
      stepKey: s.stepKey,
      name: s.name,
      sortOrder: s.sortOrder,
      status: s.status,
      slaDays: s.slaDays,
      slaHours: s.slaHours,
      slaMinutes: s.slaMinutes,
      description: s.description,
      expectedResult: s.expectedResult,
      departmentId: s.departmentId,
      departmentName: depts.find((d) => d.id === s.departmentId)?.name ?? null,
      assigneeId: s.assigneeId,
      assigneeName: users.find((u) => u.id === s.assigneeId)?.fullName ?? null,
      form: parseJson<FormSnapshot | null>(s.formSnapshot, null),
      results: parseJson(s.resultsSnapshot, []),
      tasks: s.tasks.map(taskSummary),
    })),
  };
}

ticketRouter.get(
  '/tickets/:id',
  ah(async (req, res) => {
    const id = idParam(req);
    if (req.query.open === '1') {
      const t = await prisma.ticket.findUnique({ where: { id } });
      if (!t) throw notFound('Phiếu');
      // Người phụ trách mở phiếu lần đầu khi phiếu đang Mới → tự chuyển Đang xử lý
      if (t.status === 'NEW' && t.ownerId === req.user.id) {
        await prisma.$transaction(async (tx) => {
          await tx.ticket.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
          await logHistory(tx, {
            entityType: 'TICKET',
            entityId: id,
            actor: actorOf(req),
            action: 'STATUS',
            summary: 'Người phụ trách mở phiếu lần đầu',
            changes: [{ field: 'status', label: 'Trạng thái', oldValue: 'Mới', newValue: 'Đang xử lý' }],
          });
        });
      }
    }
    res.json(await ticketDetail(id));
  }),
);

ticketRouter.post(
  '/tickets/:id/alert-seen',
  ah(async (req, res) => {
    const id = idParam(req);
    const t = await prisma.ticket.findUnique({ where: { id } });
    const err = parseJson<AutoGenError | null>(t?.autoGenError, null);
    if (t && err && !err.seen) await prisma.ticket.update({ where: { id }, data: { autoGenError: JSON.stringify({ ...err, seen: true }) } });
    res.json({ ok: true });
  }),
);

ticketRouter.post(
  '/tickets/:id/retry-autogen',
  ah(async (req, res) => {
    const id = idParam(req);
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) throw notFound('Phiếu');
    const err = parseJson<AutoGenError | null>(t.autoGenError, null);
    if (!err) return res.json({ ok: true });
    const cal = await getCalendar();
    const r = await prisma.$transaction((tx) => autoGenerate(tx, id, err.stepId, cal), { timeout: 30000 });
    if (!r.ok && (r as any).error) throw bad(`Sinh tác vụ tự động vẫn thất bại: ${(r as any).error.message}`);
    res.json({ ok: true });
  }),
);

ticketRouter.get(
  '/tickets/:id/history',
  ah(async (req, res) => {
    const list = await prisma.history.findMany({
      where: { entityType: 'TICKET', entityId: idParam(req) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    res.json(list.map((h) => ({ ...h, changes: parseJson(h.changes, []) })));
  }),
);

// ───── Sửa phiếu ─────

ticketRouter.put(
  '/tickets/:id',
  ah(async (req, res) => {
    const id = idParam(req);
    const t = await prisma.ticket.findUnique({ where: { id }, include: listInclude });
    if (!t) throw notFound('Phiếu');
    const b = req.body || {};
    const errors: Record<string, string> = {};
    const channel = b.channel ?? t.channel;
    if (!CHANNELS.some((c) => c.value === channel)) errors.channel = 'Vui lòng chọn Kênh';
    const productId = toInt(b.productId) ?? t.productId;
    const operationId = toInt(b.operationId) ?? t.operationId;
    const serviceChanged = productId !== t.productId || operationId !== t.operationId;
    let product: any = t.product;
    let operation: any = t.operation;
    if (serviceChanged) {
      if (t.status === 'DONE') throw bad('Phiếu đã hoàn thành, không thể đổi Sản phẩm/Nghiệp vụ');
      product = await validateLeaf('product', productId, 'productId', 'Sản phẩm', errors);
      operation = await validateLeaf('operation', operationId, 'operationId', 'Nghiệp vụ', errors);
    }
    const ownerId = toInt(b.ownerId) ?? t.ownerId;
    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner || (!owner.active && ownerId !== t.ownerId)) errors.ownerId = 'Người phụ trách không hợp lệ';
    const customerId = b.customerId === undefined ? t.customerId : toInt(b.customerId) ?? null;
    const customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
    if (Object.keys(errors).length) throw bad('Dữ liệu không hợp lệ, vui lòng kiểm tra lại', errors);

    const oldSnap = parseJson<TicketConfigSnapshot>(t.configSnapshot, null as any);
    const oldValues = parseJson<Record<string, any>>(t.dynamicValues, {});
    const values = (b.dynamicValues && typeof b.dynamicValues === 'object' ? b.dynamicValues : oldValues) as Record<string, any>;
    const cfg = serviceChanged ? await resolveServiceConfig(prisma, productId, operationId, customer?.segment) : null;
    const items = (cfg ? cfg.form?.items : oldSnap?.form?.items) ?? [];
    const dErr = validateDynamicValues(items, values, { ticketOnly: true });
    if (Object.keys(dErr).length) throw bad('Thông tin động chưa hợp lệ', dynErrors(dErr));
    const linkedIds = b.linkedTicketIds
      ? (await prisma.ticket.findMany({ where: { id: { in: b.linkedTicketIds.map(Number) } }, select: { id: true } }))
          .map((x) => x.id)
          .filter((x) => x !== id)
      : parseJson<number[]>(t.linkedTicketIds, []);
    const [oldLinked, newLinked] = await Promise.all([
      prisma.ticket.findMany({ where: { id: { in: parseJson<number[]>(t.linkedTicketIds, []) } }, select: { code: true } }),
      prisma.ticket.findMany({ where: { id: { in: linkedIds } }, select: { code: true } }),
    ]);

    const actor = actorOf(req);
    const cal = await getCalendar();
    await prisma.$transaction(
      async (tx) => {
        const data: any = {
          channel,
          ownerId,
          customerId,
          segment: customer?.segment ?? null,
          description: b.description !== undefined ? b.description || null : t.description,
          exchangeContent: b.exchangeContent !== undefined ? b.exchangeContent || null : t.exchangeContent,
          resolutionSummary: b.resolutionSummary !== undefined ? b.resolutionSummary || null : t.resolutionSummary,
          linkedTicketIds: JSON.stringify(linkedIds),
          dynamicValues: JSON.stringify(pruneValues(items, values, { ticketOnly: true })),
        };
        const changes = diff([
          { field: 'channel', label: 'Kênh', old: CHANNEL_LABEL[t.channel], new: CHANNEL_LABEL[channel] },
          { field: 'customerId', label: 'Khách hàng', old: t.customer?.fullName, new: customer?.fullName },
          { field: 'ownerId', label: 'Người phụ trách', old: t.owner.fullName, new: owner!.fullName },
          { field: 'description', label: 'Mô tả', old: t.description, new: data.description },
          { field: 'exchangeContent', label: 'Nội dung trao đổi', old: t.exchangeContent, new: data.exchangeContent },
          { field: 'resolutionSummary', label: 'Tóm tắt cách xử lý', old: t.resolutionSummary, new: data.resolutionSummary },
          { field: 'linkedTicketIds', label: 'Mã phiếu liên kết', old: oldLinked.map((x) => x.code), new: newLinked.map((x) => x.code) },
        ]);
        changes.push(...(await dynChanges(items, oldValues, data.dynamicValues ? JSON.parse(data.dynamicValues) : {})));

        if (cfg) {
          const now = new Date();
          const mode = cfg.service.workHoursMode as WorkHoursMode;
          const dueAt = new Date(addDuration(mode, cal, now.getTime(), cfg.slaMinutes));
          Object.assign(data, {
            productId,
            operationId,
            serviceId: cfg.service.id,
            workHoursMode: mode,
            slaMinutes: cfg.slaMinutes,
            slaStartAt: now,
            dueAt,
            configSnapshot: JSON.stringify(cfg.snapshot),
            serviceVersion: t.serviceVersion + 1,
            autoGenError: null,
          });
          changes.unshift(
            ...diff([
              { field: 'productId', label: 'Sản phẩm', old: t.product.name, new: product.name },
              { field: 'operationId', label: 'Nghiệp vụ', old: t.operation.name, new: operation.name },
              { field: 'serviceId', label: 'Dịch vụ', old: oldSnap?.service?.code, new: cfg.service.code },
              { field: 'workflow', label: 'Quy trình', old: oldSnap?.workflow?.name, new: cfg.workflow.name },
              { field: 'dueAt', label: 'Thời hạn hoàn thành', old: t.dueAt.toISOString(), new: dueAt.toISOString() },
            ]),
          );
          // Công việc thuộc dịch vụ cũ bị thay thế → Hủy
          await tx.ticketStep.updateMany({ where: { ticketId: id, generation: t.serviceVersion }, data: { status: 'CANCELLED' } });
        }
        await tx.ticket.update({ where: { id }, data });
        if (changes.length)
          await logHistory(tx, {
            entityType: 'TICKET',
            entityId: id,
            actor,
            action: cfg ? 'CHANGE_SERVICE' : 'UPDATE',
            summary: cfg ? 'Đổi dịch vụ của phiếu – các công việc thuộc dịch vụ cũ chuyển trạng thái Hủy' : undefined,
            changes,
          });
        if (ownerId !== t.ownerId && ownerId !== actor.id)
          await notify(tx, ownerId, `Phiếu ${t.code}`, `${actor.fullName} đã giao bạn phụ trách phiếu`, `/tickets/${id}`);
        if (cfg) {
          const steps = await instantiateSteps(tx, id, t.serviceVersion + 1, cfg.workflow);
          await autoGenerate(tx, id, steps[0].id, cal);
        }
      },
      { timeout: 30000 },
    );
    res.json(await ticketDetail(id));
  }),
);

// ───── Đổi trạng thái phiếu ─────

ticketRouter.post(
  '/tickets/:id/status',
  ah(async (req, res) => {
    const id = idParam(req);
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) throw notFound('Phiếu');
    if (!isAdmin(req) && t.ownerId !== req.user.id)
      throw new HttpError(403, 'Chỉ người phụ trách phiếu hoặc quản trị mới được đổi trạng thái phiếu');
    const status = String(req.body?.status || '');
    if (!['IN_PROGRESS', 'RETURNED', 'DONE'].includes(status)) throw bad('Trạng thái không hợp lệ');
    if (status === t.status) return res.json({ ok: true });
    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: { status, completedAt: status === 'DONE' ? new Date() : null, ...(status === 'DONE' ? { autoGenError: null } : {}) },
      });
      await logHistory(tx, {
        entityType: 'TICKET',
        entityId: id,
        actor: actorOf(req),
        action: 'STATUS',
        summary: req.body?.reason ? `Lý do: ${req.body.reason}` : undefined,
        changes: [{ field: 'status', label: 'Trạng thái', oldValue: statusLabel(t.status), newValue: statusLabel(status) }],
      });
      if (t.ownerId !== req.user.id)
        await notify(tx, t.ownerId, `Phiếu ${t.code}`, `${req.user.fullName} đã chuyển phiếu sang "${statusLabel(status)}"`, `/tickets/${id}`);
    });
    res.json({ ok: true });
  }),
);

// ───── File đính kèm của phiếu ─────

ticketRouter.post(
  '/tickets/:id/attachments',
  upload.array('files', TASK_LIMITS.maxFiles),
  ah(async (req, res) => {
    const id = idParam(req);
    const files = (req.files as Express.Multer.File[]) || [];
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) {
      removeFiles(files);
      throw notFound('Phiếu');
    }
    const saved = await prisma.$transaction(async (tx) => {
      const out = await saveAttachments(tx, 'TICKET', id, files, req.user.id);
      if (out.length)
        await logHistory(tx, {
          entityType: 'TICKET',
          entityId: id,
          actor: actorOf(req),
          action: 'ATTACH',
          changes: [{ field: 'attachments', label: 'Đính kèm file', oldValue: null, newValue: out.map((a) => a.fileName).join(', ') }],
        });
      return out;
    });
    res.json(saved);
  }),
);

// ───── Tạo tác vụ (thủ công) ─────

ticketRouter.post(
  '/tickets/:id/steps/:stepId/tasks',
  ah(async (req, res) => {
    const id = idParam(req);
    const stepId = idParam(req, 'stepId');
    const t = await prisma.ticket.findUnique({ where: { id } });
    if (!t) throw notFound('Phiếu');
    if (t.status === 'DONE') throw bad('Phiếu đã Hoàn thành, không thể tạo tác vụ');
    const step = await prisma.ticketStep.findUnique({ where: { id: stepId } });
    if (!step || step.ticketId !== id) throw notFound('Công việc');
    if (step.status === 'CANCELLED' || step.generation !== t.serviceVersion) throw bad('Công việc đã bị hủy, không thể tạo tác vụ');
    const b = req.body || {};
    const { departmentId, assigneeId } = await validateAssignment(b.departmentId, b.assigneeId);
    const channels: string[] = (Array.isArray(b.notifyChannels) ? b.notifyChannels : []).filter((c: string) =>
      NOTIFY_CHANNELS.some((n) => n.value === c),
    );
    if (!channels.length) throw bad('Vui lòng chọn ít nhất 1 hình thức thông báo', { notifyChannels: 'Chọn ít nhất 1 hình thức thông báo' });
    const form = parseJson<FormSnapshot | null>(step.formSnapshot, null);
    const values = (b.dynamicValues || {}) as Record<string, unknown>;
    const dErr = validateDynamicValues(form?.items ?? [], values);
    if (Object.keys(dErr).length) throw bad('Thông tin động chưa hợp lệ', dynErrors(dErr));
    const cal = await getCalendar();
    const task = await prisma.$transaction(
      (tx) =>
        createTask(tx, {
          ticket: t,
          step,
          departmentId,
          assigneeId,
          creator: actorOf(req),
          description: b.description,
          notifyChannels: channels,
          dynamicValues: pruneValues(form?.items ?? [], values),
          cal,
        }),
      { timeout: 30000 },
    );
    res.json({ id: task.id, code: task.code, status: task.status });
  }),
);

// ───── Cập nhật tác vụ theo lô (từ danh sách phiếu) ─────

ticketRouter.post(
  '/tickets/batch-update-tasks',
  ah(async (req, res) => {
    const ids: number[] = (req.body?.ticketIds || []).map(Number).filter(Boolean);
    if (!ids.length) throw bad('Vui lòng chọn phiếu');
    const tasks = await prisma.task.findMany({
      where: { ticketId: { in: ids }, status: { in: ['NEW', 'IN_PROGRESS', 'RETURNED'] }, step: { status: { not: 'CANCELLED' } } },
      select: { id: true },
    });
    const r = await batchUpdateTasks(
      tasks.map((x) => x.id),
      req.body,
      actorOf(req),
    );
    res.json(r);
  }),
);

