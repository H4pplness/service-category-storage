// Danh mục: Quy trình (công việc, SLA, kết quả, rẽ nhánh) và Dịch vụ.
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { requireAdmin } from '../auth';
import { ah, bad, idParam, notFound, prisma, requireText, throwIfErrors, toInt } from '../core';
import { workflowInclude, workflowSlaMinutes } from '../services/snapshot';
import { SEGMENTS } from '../../../shared/constants';

export const configRouter = Router();

// ───── Quy trình ─────

async function workflowView(wf: any) {
  const deptIds = wf.steps.map((s: any) => s.departmentId).filter(Boolean);
  const userIds = wf.steps.map((s: any) => s.assigneeId).filter(Boolean);
  const [depts, users] = await Promise.all([
    prisma.department.findMany({ where: { id: { in: deptIds } } }),
    prisma.user.findMany({ where: { id: { in: userIds } } }),
  ]);
  return {
    ...wf,
    slaMinutes: workflowSlaMinutes(wf),
    steps: wf.steps.map((s: any) => ({
      ...s,
      departmentName: depts.find((d) => d.id === s.departmentId)?.name ?? null,
      assigneeName: users.find((u) => u.id === s.assigneeId)?.fullName ?? null,
    })),
  };
}

configRouter.get(
  '/workflows',
  ah(async (req, res) => {
    const where: any = {};
    if (req.query.workHoursMode) where.workHoursMode = String(req.query.workHoursMode);
    if (req.query.active === 'true') where.active = true;
    const list = await prisma.workflow.findMany({
      where,
      include: { ...workflowInclude, _count: { select: { services: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      list.map((w) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        description: w.description,
        workHoursMode: w.workHoursMode,
        active: w.active,
        stepCount: w.steps.length,
        slaMinutes: workflowSlaMinutes(w),
        serviceCount: w._count.services,
        updatedAt: w.updatedAt,
        stepNames: w.steps.map((s) => s.name),
      })),
    );
  }),
);

configRouter.get(
  '/workflows/:id',
  ah(async (req, res) => {
    const wf = await prisma.workflow.findUnique({
      where: { id: idParam(req) },
      include: { ...workflowInclude, _count: { select: { services: true } } },
    });
    if (!wf) throw notFound('Quy trình');
    res.json({ ...(await workflowView(wf)), serviceCount: wf._count.services, _count: undefined });
  }),
);

async function validateWorkflow(body: any, excludeId?: number) {
  const errors: Record<string, string> = {};
  const code = requireText(body.code, 'mã quy trình', 'code', errors).toUpperCase();
  const name = requireText(body.name, 'tên quy trình', 'name', errors);
  throwIfErrors(errors);
  const dup = await prisma.workflow.findUnique({ where: { code } });
  if (dup && dup.id !== excludeId) throw bad('Mã quy trình đã tồn tại', { code: 'Mã quy trình đã tồn tại' });
  const steps: any[] = Array.isArray(body.steps) ? body.steps : [];
  if (!steps.length) throw bad('Quy trình phải có ít nhất 1 công việc');
  const stepKeys = new Set(steps.map((s) => s.key));
  steps.forEach((s, i) => {
    if (!String(s.name || '').trim()) throw bad(`Công việc #${i + 1}: vui lòng nhập tên`);
    const sla = (Number(s.slaDays) || 0) + (Number(s.slaHours) || 0) + (Number(s.slaMinutes) || 0);
    if (sla <= 0) throw bad(`Công việc "${s.name}": SLA phải lớn hơn 0`);
    if ([s.slaDays, s.slaHours, s.slaMinutes].some((v) => Number(v) < 0)) throw bad(`Công việc "${s.name}": SLA không hợp lệ`);
    const results: any[] = Array.isArray(s.results) ? s.results : [];
    const leaves = results.filter((r) => !results.some((c) => c.parentKey === r.key));
    if (!leaves.length) throw bad(`Công việc "${s.name}": cần cấu hình ít nhất 1 kết quả công việc`);
    for (const r of results) {
      if (!String(r.name || '').trim()) throw bad(`Công việc "${s.name}": kết quả chưa có tên`);
      if (r.parentKey && !results.some((p) => p.key === r.parentKey)) throw bad(`Công việc "${s.name}": kết quả cha không hợp lệ`);
      if (r.routeType === 'GOTO') {
        if (!r.gotoStepKey || !stepKeys.has(r.gotoStepKey))
          throw bad(`Công việc "${s.name}" – kết quả "${r.name}": chưa chọn công việc chuyển đến`);
        if (r.gotoStepKey === s.key) throw bad(`Công việc "${s.name}" – kết quả "${r.name}": không thể chuyển đến chính công việc này`);
      }
    }
  });
  return {
    code,
    name,
    description: body.description || null,
    workHoursMode: body.workHoursMode === 'H24' ? 'H24' : 'OFFICE',
    active: body.active !== false,
    steps,
  };
}

async function saveSteps(tx: any, workflowId: number, steps: any[]) {
  await tx.workflowStep.deleteMany({ where: { workflowId } });
  let order = 1;
  for (const s of steps) {
    const step = await tx.workflowStep.create({
      data: {
        key: s.key || randomUUID(),
        workflowId,
        sortOrder: order++,
        name: String(s.name).trim(),
        description: s.description || null,
        expectedResult: s.expectedResult || null,
        slaDays: Number(s.slaDays) || 0,
        slaHours: Number(s.slaHours) || 0,
        slaMinutes: Number(s.slaMinutes) || 0,
        departmentId: toInt(s.departmentId) ?? null,
        assigneeId: toInt(s.assigneeId) ?? null,
        formId: toInt(s.formId) ?? null,
      },
    });
    let ro = 1;
    for (const r of s.results || []) {
      const isLeaf = !(s.results || []).some((c: any) => c.parentKey === r.key);
      await tx.stepResult.create({
        data: {
          key: r.key || randomUUID(),
          stepId: step.id,
          parentKey: r.parentKey || null,
          code: String(r.code || '').trim() || `KQ${ro}`,
          name: String(r.name).trim(),
          sortOrder: ro++,
          routeType: isLeaf && ['NEXT', 'GOTO', 'END'].includes(r.routeType) ? r.routeType : 'NEXT',
          gotoStepKey: isLeaf && r.routeType === 'GOTO' ? r.gotoStepKey : null,
        },
      });
    }
  }
}

configRouter.post(
  '/workflows',
  requireAdmin,
  ah(async (req, res) => {
    const input = await validateWorkflow(req.body);
    const wf = await prisma.$transaction(async (tx) => {
      const { steps, ...data } = input;
      const w = await tx.workflow.create({ data });
      await saveSteps(tx, w.id, steps);
      return w;
    });
    res.json(wf);
  }),
);

configRouter.put(
  '/workflows/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const cur = await prisma.workflow.findUnique({ where: { id }, include: { _count: { select: { services: true } } } });
    if (!cur) throw notFound('Quy trình');
    const input = await validateWorkflow(req.body, id);
    if (cur._count.services && cur.workHoursMode !== input.workHoursMode)
      throw bad('Quy trình đang được áp dụng tại dịch vụ, không được đổi giờ làm việc');
    if (cur._count.services && !input.active) {
      const activeSv = await prisma.serviceWorkflow.count({ where: { workflowId: id, service: { active: true } } });
      if (activeSv) throw bad('Quy trình đang được áp dụng tại dịch vụ đang sử dụng, không thể ngừng sử dụng');
    }
    const wf = await prisma.$transaction(async (tx) => {
      const { steps, ...data } = input;
      const w = await tx.workflow.update({ where: { id }, data });
      await saveSteps(tx, id, steps);
      return w;
    });
    res.json(wf);
  }),
);

configRouter.delete(
  '/workflows/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const n = await prisma.serviceWorkflow.count({ where: { workflowId: id } });
    if (n) throw bad('Không thể xóa: quy trình đang được áp dụng tại dịch vụ');
    await prisma.workflow.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

// ───── Dịch vụ ─────

const serviceInclude = {
  product: true,
  operation: true,
  form: true,
  workflows: { include: { workflow: { include: workflowInclude } } },
  _count: { select: { tickets: true } },
};

function serviceView(s: any) {
  return {
    id: s.id,
    code: s.code,
    productId: s.productId,
    productName: s.product.name,
    productCode: s.product.code,
    operationId: s.operationId,
    operationName: s.operation.name,
    operationCode: s.operation.code,
    formId: s.formId,
    formName: s.form?.name ?? null,
    formCode: s.form?.code ?? null,
    workHoursMode: s.workHoursMode,
    active: s.active,
    segmentMode: s.segmentMode,
    used: s._count.tickets > 0,
    ticketCount: s._count.tickets,
    updatedAt: s.updatedAt,
    workflows: s.workflows.map((w: any) => ({
      segment: w.segment,
      workflowId: w.workflowId,
      workflowName: w.workflow.name,
      workflowCode: w.workflow.code,
      slaMinutes: workflowSlaMinutes(w.workflow),
    })),
  };
}

configRouter.get(
  '/services',
  ah(async (_req, res) => {
    const list = await prisma.service.findMany({ include: serviceInclude, orderBy: { updatedAt: 'desc' } });
    res.json(list.map(serviceView));
  }),
);

/** Nghiệp vụ đã map với sản phẩm qua dịch vụ đang sử dụng (dùng khi tạo phiếu). */
configRouter.get(
  '/services/operations-for-product',
  ah(async (req, res) => {
    const productId = toInt(req.query.productId);
    if (!productId) return res.json([]);
    const list = await prisma.service.findMany({ where: { productId, active: true }, select: { operationId: true } });
    res.json(list.map((s) => s.operationId));
  }),
);

/** Nghiệp vụ đã map với sản phẩm (để loại khỏi danh sách chọn khi khai báo dịch vụ). */
configRouter.get(
  '/services/mapped-operations',
  ah(async (req, res) => {
    const productId = toInt(req.query.productId);
    const excludeId = toInt(req.query.excludeServiceId);
    if (!productId) return res.json([]);
    const list = await prisma.service.findMany({
      where: { productId, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { operationId: true },
    });
    res.json(list.map((s) => s.operationId));
  }),
);

configRouter.get(
  '/services/lookup',
  ah(async (req, res) => {
    const productId = toInt(req.query.productId);
    const operationId = toInt(req.query.operationId);
    if (!productId || !operationId) return res.json(null);
    const s = await prisma.service.findUnique({
      where: { productId_operationId: { productId, operationId } },
      include: serviceInclude,
    });
    if (!s || !s.active) return res.json(null);
    res.json(serviceView(s));
  }),
);

configRouter.get(
  '/services/:id',
  ah(async (req, res) => {
    const s = await prisma.service.findUnique({ where: { id: idParam(req) }, include: serviceInclude });
    if (!s) throw notFound('Dịch vụ');
    res.json(serviceView(s));
  }),
);

async function validateService(body: any) {
  const errors: Record<string, string> = {};
  const productId = toInt(body.productId);
  const operationId = toInt(body.operationId);
  if (!productId) errors.productId = 'Vui lòng chọn Sản phẩm';
  if (!operationId) errors.operationId = 'Vui lòng chọn Nghiệp vụ';
  throwIfErrors(errors);
  const [product, operation] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, include: { _count: { select: { children: true } } } }),
    prisma.operation.findUnique({ where: { id: operationId }, include: { _count: { select: { children: true } } } }),
  ]);
  if (!product || !product.active) errors.productId = 'Sản phẩm không tồn tại hoặc đã ngừng sử dụng';
  else if (product._count.children) errors.productId = 'Vui lòng chọn Sản phẩm tới level cuối cùng';
  if (!operation || !operation.active) errors.operationId = 'Nghiệp vụ không tồn tại hoặc đã ngừng sử dụng';
  else if (operation._count.children) errors.operationId = 'Vui lòng chọn Nghiệp vụ tới level cuối cùng';
  throwIfErrors(errors);

  const workHoursMode = body.workHoursMode === 'H24' ? 'H24' : 'OFFICE';
  const segmentMode = body.segmentMode === 'BY_SEGMENT' ? 'BY_SEGMENT' : 'ALL';
  const wfMap: Record<string, number | undefined> = body.workflows || {};
  const segs = segmentMode === 'ALL' ? ['ALL'] : SEGMENTS.map((s) => s.value as string);
  const workflows: { segment: string; workflowId: number }[] = [];
  for (const seg of segs) {
    const wid = toInt(wfMap[seg]);
    if (!wid) {
      errors[`wf_${seg}`] = 'Vui lòng chọn quy trình';
      continue;
    }
    const wf = await prisma.workflow.findUnique({ where: { id: wid } });
    if (!wf || !wf.active) errors[`wf_${seg}`] = 'Quy trình không tồn tại hoặc đã ngừng sử dụng';
    else if (wf.workHoursMode !== workHoursMode) errors[`wf_${seg}`] = 'Quy trình không cùng chế độ giờ làm việc với dịch vụ';
    else workflows.push({ segment: seg, workflowId: wid });
  }
  const formId = toInt(body.formId) ?? null;
  if (formId) {
    const f = await prisma.form.findUnique({ where: { id: formId } });
    if (!f || !f.active) errors.formId = 'Mẫu nhập liệu không tồn tại hoặc đã ngừng sử dụng';
  }
  throwIfErrors(errors);
  return {
    productId: productId!,
    operationId: operationId!,
    code: `${product!.code}-${operation!.code}`,
    formId,
    workHoursMode,
    segmentMode,
    active: body.active !== false,
    workflows,
  };
}

async function ensureUniquePair(productId: number, operationId: number, excludeId?: number) {
  const dup = await prisma.service.findUnique({ where: { productId_operationId: { productId, operationId } } });
  if (dup && dup.id !== excludeId)
    throw bad(`Sản phẩm + Nghiệp vụ đã được khai báo tại dịch vụ ${dup.code}`, { operationId: 'Nghiệp vụ đã được map với sản phẩm' });
}

configRouter.post(
  '/services',
  requireAdmin,
  ah(async (req, res) => {
    const input = await validateService(req.body);
    await ensureUniquePair(input.productId, input.operationId);
    const { workflows, ...data } = input;
    const s = await prisma.service.create({ data: { ...data, workflows: { create: workflows } } });
    res.json(s);
  }),
);

configRouter.put(
  '/services/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const cur = await prisma.service.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
    if (!cur) throw notFound('Dịch vụ');
    const input = await validateService(req.body);
    const pairChanged = cur.productId !== input.productId || cur.operationId !== input.operationId;
    const used = cur._count.tickets > 0;
    if (used && pairChanged) throw bad('Dịch vụ đã được sử dụng, không được thay đổi Sản phẩm/Nghiệp vụ');
    await ensureUniquePair(input.productId, input.operationId, id);
    const { workflows, ...data } = input;
    const s = await prisma.$transaction(async (tx) => {
      if (pairChanged) {
        // Dịch vụ chưa dùng đổi Sản phẩm/Nghiệp vụ → sinh bản ghi mới, xóa bản ghi cũ
        await tx.service.delete({ where: { id } });
        return tx.service.create({ data: { ...data, workflows: { create: workflows } } });
      }
      await tx.serviceWorkflow.deleteMany({ where: { serviceId: id } });
      return tx.service.update({ where: { id }, data: { ...data, workflows: { create: workflows } } });
    });
    res.json(s);
  }),
);

configRouter.delete(
  '/services/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const n = await prisma.ticket.count({ where: { serviceId: id } });
    if (n) throw bad('Không thể xóa: dịch vụ đã được sử dụng tại phiếu');
    await prisma.service.delete({ where: { id } });
    res.json({ ok: true });
  }),
);
