// Engine quy trình: khởi tạo công việc, sinh tác vụ (thủ công / tự động), rẽ nhánh theo kết quả, hoàn thành phiếu.
import type { Task, Ticket, TicketStep } from '@prisma/client';
import { addDuration, slaToMinutes, WorkCalendar, WorkHoursMode } from '../../../shared/sla';
import type { FormSnapshot } from '../../../shared/form';
import { Actor, Tx, clock, genTaskCode, logHistory, notify, parseJson } from '../core';
import { loadFormSnapshot } from './snapshot';

export interface ResultSnap {
  key: string;
  parentKey: string | null;
  code: string;
  name: string;
  sortOrder: number;
  routeType: 'NEXT' | 'GOTO' | 'END';
  gotoStepKey: string | null;
}

export interface AutoGenError {
  stepId: number;
  stepName: string;
  message: string;
  at: string;
  seen: boolean;
}

export function resultLeaves(results: ResultSnap[]) {
  return results.filter((r) => !results.some((c) => c.parentKey === r.key));
}

export function resultPath(results: ResultSnap[], key: string): string {
  const parts: string[] = [];
  let cur = results.find((r) => r.key === key);
  let guard = 0;
  while (cur && guard++ < 10) {
    parts.unshift(cur.name);
    cur = cur.parentKey ? results.find((r) => r.key === cur!.parentKey) : undefined;
  }
  return parts.join(' / ');
}

export async function instantiateSteps(tx: Tx, ticketId: number, generation: number, workflow: any) {
  const out: TicketStep[] = [];
  for (const s of [...workflow.steps].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const form = await loadFormSnapshot(tx, s.formId);
    const results: ResultSnap[] = s.results.map((r: any) => ({
      key: r.key,
      parentKey: r.parentKey,
      code: r.code,
      name: r.name,
      sortOrder: r.sortOrder,
      routeType: r.routeType,
      gotoStepKey: r.gotoStepKey,
    }));
    out.push(
      await tx.ticketStep.create({
        data: {
          ticketId,
          generation,
          stepKey: s.key,
          name: s.name,
          sortOrder: s.sortOrder,
          status: 'PENDING',
          slaDays: s.slaDays,
          slaHours: s.slaHours,
          slaMinutes: s.slaMinutes,
          departmentId: s.departmentId,
          assigneeId: s.assigneeId,
          description: s.description,
          expectedResult: s.expectedResult,
          formSnapshot: JSON.stringify(form),
          resultsSnapshot: JSON.stringify(results),
        },
      }),
    );
  }
  return out;
}

type Resolve = { ok: true; departmentId: number; assigneeId: number } | { ok: false; reason: string };

/** Xác định người nhận tác vụ tự sinh theo cấu hình công việc. */
export async function resolveAssignee(tx: Tx, step: TicketStep): Promise<Resolve> {
  if (step.assigneeId) {
    const u = await tx.user.findUnique({ where: { id: step.assigneeId } });
    if (!u || !u.active || !u.departmentId)
      return { ok: false, reason: `Nhân sự xử lý "${u?.fullName ?? '#' + step.assigneeId}" không còn hoạt động (không khả dụng) trên cây đơn vị` };
    return { ok: true, departmentId: u.departmentId, assigneeId: u.id };
  }
  if (!step.departmentId) return { ok: false, reason: 'Công việc không có phòng ban xử lý được chỉ định' };
  const d = await tx.department.findUnique({ where: { id: step.departmentId } });
  if (!d || !d.active) return { ok: false, reason: 'Phòng ban xử lý được chỉ định không còn hoạt động' };
  if (!d.focalUserId) return { ok: false, reason: `Phòng ban "${d.name}" không có nhân sự được chỉ định nhận tác vụ` };
  const u = await tx.user.findUnique({ where: { id: d.focalUserId } });
  if (!u || !u.active || !u.departmentId)
    return {
      ok: false,
      reason: `Nhân sự đầu mối "${u?.fullName ?? '#' + d.focalUserId}" của phòng ban "${d.name}" không còn hoạt động (không khả dụng) trên cây đơn vị`,
    };
  return { ok: true, departmentId: u.departmentId, assigneeId: u.id };
}

export interface CreateTaskInput {
  ticket: Ticket;
  step: TicketStep;
  departmentId: number;
  assigneeId: number;
  creator: Actor | null; // null = hệ thống
  description?: string | null;
  notifyChannels: string[];
  dynamicValues: Record<string, unknown>;
  cal: WorkCalendar;
}

export async function createTask(tx: Tx, p: CreateTaskInput): Promise<Task> {
  const code = await genTaskCode(tx);
  const now = clock.now();
  const mode = p.ticket.workHoursMode as WorkHoursMode;
  const slaMinutes = slaToMinutes(p.step.slaDays, p.step.slaHours, p.step.slaMinutes, mode);
  const dueAt = new Date(addDuration(mode, p.cal, now.getTime(), slaMinutes));
  const status = p.creator && p.creator.id === p.assigneeId ? 'IN_PROGRESS' : 'NEW';
  const task = await tx.task.create({
    data: {
      code,
      ticketId: p.ticket.id,
      ticketStepId: p.step.id,
      departmentId: p.departmentId,
      assigneeId: p.assigneeId,
      creatorId: p.creator?.id ?? null,
      description: p.description || null,
      notifyChannels: JSON.stringify(p.notifyChannels),
      status,
      dynamicValues: JSON.stringify(p.dynamicValues || {}),
      workHoursMode: mode,
      slaMinutes,
      dueAt,
      createdAt: now,
    },
    include: { assignee: true, department: true },
  });
  const pendingErr = parseJson<AutoGenError | null>(p.ticket.autoGenError, null);
  if (pendingErr?.stepId === p.step.id) await tx.ticket.update({ where: { id: p.ticket.id }, data: { autoGenError: null } });
  if (p.step.status === 'PENDING' || p.step.status === 'SKIPPED' || p.step.status === 'DONE') {
    await tx.ticketStep.update({ where: { id: p.step.id }, data: { status: 'ACTIVE' } });
  }
  await logHistory(tx, {
    entityType: 'TASK',
    entityId: task.id,
    actor: p.creator,
    action: 'CREATE',
    summary: p.creator ? 'Tạo tác vụ' : 'Hệ thống tự sinh tác vụ theo quy trình',
    changes: [
      { field: 'step', label: 'Công việc', oldValue: null, newValue: p.step.name },
      { field: 'departmentId', label: 'Phòng ban chuyên xử lý', oldValue: null, newValue: task.department?.name ?? null },
      { field: 'assigneeId', label: 'Nhân sự chuyên xử lý', oldValue: null, newValue: task.assignee?.fullName ?? null },
      { field: 'status', label: 'Trạng thái', oldValue: null, newValue: status === 'NEW' ? 'Mới' : 'Đang xử lý' },
      { field: 'dueAt', label: 'Thời hạn hoàn thành', oldValue: null, newValue: dueAt.toISOString() },
    ],
  });
  await logHistory(tx, {
    entityType: 'TICKET',
    entityId: p.ticket.id,
    actor: p.creator,
    action: 'TASK_CREATE',
    summary: `${p.creator ? 'Tạo' : 'Tự sinh'} tác vụ ${code} – công việc "${p.step.name}", giao cho ${task.assignee?.fullName}`,
  });
  if (!p.creator || p.creator.id !== p.assigneeId) {
    await notify(
      tx,
      p.assigneeId,
      `Tác vụ mới ${code}`,
      `Bạn được giao xử lý công việc "${p.step.name}" của phiếu ${p.ticket.code}`,
      `/tickets/${p.ticket.id}?task=${task.id}`,
    );
  }
  return task;
}

/** Giá trị trường động của tác vụ: kế thừa giá trị trên phiếu theo mã trường. */
export function prefillTaskValues(ticket: Ticket, step: TicketStep): Record<string, unknown> {
  const form = parseJson<FormSnapshot | null>(step.formSnapshot, null);
  if (!form) return {};
  const tv = parseJson<Record<string, unknown>>(ticket.dynamicValues, {});
  const out: Record<string, unknown> = {};
  for (const it of form.items) if (tv[it.code] !== undefined) out[it.code] = tv[it.code];
  return out;
}

/** Tự động sinh tác vụ cho công việc. Lỗi → lưu cảnh báo trên phiếu (hiển thị lần đầu mở phiếu). */
export async function autoGenerate(tx: Tx, ticketId: number, stepId: number, cal: WorkCalendar) {
  const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const step = await tx.ticketStep.findUniqueOrThrow({ where: { id: stepId } });
  if (ticket.status === 'DONE' || step.status === 'CANCELLED') return { ok: false as const, skipped: true };
  const open = await tx.task.count({ where: { ticketStepId: step.id, status: { not: 'DONE' } } });
  if (open > 0) return { ok: true as const, skipped: true };

  const r = await resolveAssignee(tx, step);
  if (!r.ok) {
    const err: AutoGenError = { stepId: step.id, stepName: step.name, message: r.reason, at: clock.now().toISOString(), seen: false };
    await tx.ticket.update({ where: { id: ticket.id }, data: { autoGenError: JSON.stringify(err) } });
    await tx.ticketStep.update({ where: { id: step.id }, data: { status: 'ACTIVE' } });
    await logHistory(tx, {
      entityType: 'TICKET',
      entityId: ticket.id,
      actor: null,
      action: 'AUTO_TASK_FAILED',
      summary: `Sinh tự động tác vụ cho công việc "${step.name}" thất bại: ${r.reason}`,
    });
    await notify(
      tx,
      ticket.ownerId,
      `Sinh tác vụ tự động thất bại – ${ticket.code}`,
      `Công việc "${step.name}": ${r.reason}`,
      `/tickets/${ticket.id}`,
    );
    return { ok: false as const, error: err };
  }
  const task = await createTask(tx, {
    ticket,
    step,
    departmentId: r.departmentId,
    assigneeId: r.assigneeId,
    creator: null,
    description: step.description,
    notifyChannels: ['EMAIL'],
    dynamicValues: prefillTaskValues(ticket, step),
    cal,
  });
  if (ticket.autoGenError) await tx.ticket.update({ where: { id: ticket.id }, data: { autoGenError: null } });
  return { ok: true as const, task };
}

/**
 * Đánh giá công việc sau khi một tác vụ Hoàn thành (hoặc bị xóa):
 * khi toàn bộ tác vụ của công việc đã Hoàn thành → rẽ nhánh theo Kết quả của tác vụ hoàn thành sau cùng.
 */
export async function evaluateStep(tx: Tx, stepId: number, cal: WorkCalendar) {
  const step = await tx.ticketStep.findUnique({ where: { id: stepId } });
  if (!step || step.status !== 'ACTIVE') return;
  const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: step.ticketId } });
  if (step.generation !== ticket.serviceVersion) return;
  const tasks = await tx.task.findMany({ where: { ticketStepId: step.id }, orderBy: { completedAt: 'desc' } });
  if (!tasks.length || tasks.some((t) => t.status !== 'DONE')) return;

  await tx.ticketStep.update({ where: { id: step.id }, data: { status: 'DONE' } });
  const last = tasks[0];
  const results = parseJson<ResultSnap[]>(step.resultsSnapshot, []);
  const res = results.find((r) => r.key === last.resultKey);
  const route = res?.routeType ?? 'NEXT';
  const steps = await tx.ticketStep.findMany({
    where: { ticketId: ticket.id, generation: ticket.serviceVersion },
    orderBy: { sortOrder: 'asc' },
  });

  let next: TicketStep | null = null;
  if (route === 'GOTO') next = steps.find((s) => s.stepKey === res?.gotoStepKey) ?? null;
  else if (route === 'NEXT') next = steps.find((s) => s.sortOrder > step.sortOrder) ?? null;

  if (next) {
    if (next.sortOrder > step.sortOrder) {
      const between = steps.filter((s) => s.sortOrder > step.sortOrder && s.sortOrder < next!.sortOrder && s.status === 'PENDING');
      for (const s of between) await tx.ticketStep.update({ where: { id: s.id }, data: { status: 'SKIPPED' } });
    }
    await tx.ticketStep.update({ where: { id: next.id }, data: { status: 'ACTIVE' } });
    await logHistory(tx, {
      entityType: 'TICKET',
      entityId: ticket.id,
      actor: null,
      action: 'STEP_NEXT',
      summary: `Hoàn thành công việc "${step.name}"${res ? ` (kết quả: ${resultPath(results, res.key)})` : ''} → chuyển sang công việc "${next.name}"`,
    });
    await autoGenerate(tx, ticket.id, next.id, cal);
  } else {
    for (const s of steps.filter((s) => s.status === 'PENDING'))
      await tx.ticketStep.update({ where: { id: s.id }, data: { status: 'SKIPPED' } });
    await logHistory(tx, {
      entityType: 'TICKET',
      entityId: ticket.id,
      actor: null,
      action: 'STEP_END',
      summary: `Hoàn thành công việc "${step.name}"${res ? ` (kết quả: ${resultPath(results, res.key)})` : ''} → kết thúc quy trình`,
    });
    await maybeCompleteTicket(tx, ticket.id);
  }
}

/** Phiếu tự chuyển Hoàn thành khi hết quy trình và toàn bộ tác vụ đã hoàn thành. */
export async function maybeCompleteTicket(tx: Tx, ticketId: number) {
  const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (ticket.status === 'DONE') return;
  const steps = await tx.ticketStep.findMany({ where: { ticketId, generation: ticket.serviceVersion } });
  if (steps.some((s) => s.status === 'ACTIVE' || s.status === 'PENDING')) return;
  const open = await tx.task.count({
    where: { ticketId, status: { not: 'DONE' }, step: { generation: ticket.serviceVersion } },
  });
  if (open > 0) return;
  const now = clock.now();
  await tx.ticket.update({ where: { id: ticketId }, data: { status: 'DONE', completedAt: now, autoGenError: null } });
  await logHistory(tx, {
    entityType: 'TICKET',
    entityId: ticketId,
    actor: null,
    action: 'STATUS',
    summary: 'Toàn bộ tác vụ đã hoàn thành – phiếu tự động chuyển Hoàn thành',
    changes: [{ field: 'status', label: 'Trạng thái', oldValue: statusLabel(ticket.status), newValue: 'Hoàn thành' }],
  });
  await notify(tx, ticket.ownerId, `Phiếu ${ticket.code} đã hoàn thành`, 'Toàn bộ công việc theo quy trình đã hoàn thành', `/tickets/${ticketId}`);
}

const TS: Record<string, string> = { NEW: 'Mới', IN_PROGRESS: 'Đang xử lý', RETURNED: 'Trả lại xử lý', DONE: 'Hoàn thành' };
export const statusLabel = (s: string) => TS[s] ?? s;
