// Danh mục: Sản phẩm, Nghiệp vụ, Trường nhập liệu, Mẫu nhập liệu.
import { Router } from 'express';
import { requireAdmin } from '../auth';
import { ah, bad, genFormCode, idParam, notFound, parseJson, prisma, requireText, throwIfErrors } from '../core';
import { CHOICE_TYPES, DATA_TYPES, DEPENDABLE_TYPES, MAX_DEPENDENCY_DEPTH, VIEW360_SOURCES } from '../../../shared/form';
import { T24_PRODUCTS } from '../t24';

export const catalogRouter = Router();

// ───── Cây Sản phẩm / Nghiệp vụ ─────

type TreeModel = 'product' | 'operation';

function treeRoutes(path: string, model: TreeModel, label: string) {
  const db = () => (prisma as any)[model];

  catalogRouter.get(
    `/${path}`,
    ah(async (_req, res) => {
      const list = await db().findMany({
        orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
        include: { _count: { select: { services: true, tickets: true, children: true } } },
      });
      res.json(
        list.map((x: any) => ({
          id: x.id,
          code: x.code,
          name: x.name,
          parentId: x.parentId,
          level: x.level,
          active: x.active,
          source: x.source,
          sortOrder: x.sortOrder,
          isLeaf: x._count.children === 0,
          serviceCount: x._count.services,
          ticketCount: x._count.tickets,
        })),
      );
    }),
  );

  catalogRouter.post(
    `/${path}`,
    requireAdmin,
    ah(async (req, res) => {
      const errors: Record<string, string> = {};
      const code = requireText(req.body.code, 'mã', 'code', errors).toUpperCase();
      const name = requireText(req.body.name, 'tên', 'name', errors);
      throwIfErrors(errors);
      if (!/^[A-Z0-9_.]+$/.test(code)) throw bad('Mã chỉ gồm chữ, số, dấu "_" và "."', { code: 'Mã chỉ gồm chữ, số, dấu "_" và "."' });
      if (await db().findUnique({ where: { code } })) throw bad(`Mã ${code} đã tồn tại`, { code: 'Mã đã tồn tại' });
      let level = 1;
      const parentId = req.body.parentId ? Number(req.body.parentId) : null;
      if (parentId) {
        const parent = await db().findUnique({ where: { id: parentId }, include: { _count: { select: { services: true } } } });
        if (!parent) throw notFound(`${label} cha`);
        if (parent.level >= 3) throw bad(`${label} chỉ hỗ trợ tối đa 3 cấp`);
        if (parent._count.services > 0)
          throw bad(`${label} cha "${parent.name}" đang được khai báo trong dịch vụ nên không thể thêm cấp con`);
        level = parent.level + 1;
      }
      const item = await db().create({
        data: { code, name, parentId, level, active: req.body.active !== false, sortOrder: Number(req.body.sortOrder) || 0 },
      });
      res.json(item);
    }),
  );

  catalogRouter.put(
    `/${path}/:id`,
    requireAdmin,
    ah(async (req, res) => {
      const id = idParam(req);
      const cur = await db().findUnique({ where: { id } });
      if (!cur) throw notFound(label);
      const errors: Record<string, string> = {};
      const name = requireText(req.body.name, 'tên', 'name', errors);
      throwIfErrors(errors);
      const item = await db().update({
        where: { id },
        data: { name, active: req.body.active !== false, sortOrder: Number(req.body.sortOrder) || 0 },
      });
      res.json(item);
    }),
  );

  catalogRouter.delete(
    `/${path}/:id`,
    requireAdmin,
    ah(async (req, res) => {
      const id = idParam(req);
      const cur = await db().findUnique({ where: { id }, include: { _count: { select: { services: true, tickets: true, children: true } } } });
      if (!cur) throw notFound(label);
      if (cur._count.children) throw bad(`Không thể xóa: ${label.toLowerCase()} đang có cấp con`);
      if (cur._count.services || cur._count.tickets) throw bad(`Không thể xóa: ${label.toLowerCase()} đã được sử dụng tại dịch vụ/phiếu`);
      await db().delete({ where: { id } });
      res.json({ ok: true });
    }),
  );
}

treeRoutes('products', 'product', 'Sản phẩm');
treeRoutes('operations', 'operation', 'Nghiệp vụ');

/** Giả lập đồng bộ danh mục sản phẩm từ T24 (bảng MB.TBL.SANPHAM.KEY). */
catalogRouter.post(
  '/products/sync-t24',
  requireAdmin,
  ah(async (_req, res) => {
    let created = 0;
    let updated = 0;
    for (const p of T24_PRODUCTS) {
      const parent = p.parent ? await prisma.product.findUnique({ where: { code: p.parent } }) : null;
      const existing = await prisma.product.findUnique({ where: { code: p.code } });
      if (existing) {
        if (existing.name !== p.name) {
          await prisma.product.update({ where: { id: existing.id }, data: { name: p.name, source: 'T24' } });
          updated++;
        }
      } else {
        await prisma.product.create({
          data: { code: p.code, name: p.name, parentId: parent?.id ?? null, level: parent ? parent.level + 1 : 1, source: 'T24' },
        });
        created++;
      }
    }
    res.json({ created, updated, total: T24_PRODUCTS.length });
  }),
);

// ───── Trường nhập liệu ─────

function fieldView(f: any) {
  return { ...f, options: parseJson(f.options, []), formCount: f._count?.formItems ?? undefined, _count: undefined };
}

function validateField(body: any) {
  const errors: Record<string, string> = {};
  const code = requireText(body.code, 'mã trường', 'code', errors).toUpperCase();
  const name = requireText(body.name, 'tên trường', 'name', errors);
  const infoType = body.infoType === 'VIEW360' ? 'VIEW360' : 'INPUT';
  const dt = DATA_TYPES.find((d) => d.value === body.dataType);
  if (!dt) errors.dataType = 'Vui lòng chọn kiểu dữ liệu';
  const displayType = body.displayType;
  if (dt && !dt.displays.includes(displayType)) errors.displayType = 'Kiểu hiển thị không phù hợp với kiểu dữ liệu';
  let view360Source: string | null = null;
  if (infoType === 'VIEW360') {
    if (!VIEW360_SOURCES.some((s) => s.value === body.view360Source)) errors.view360Source = 'Vui lòng chọn trường ánh xạ 360 view';
    else view360Source = body.view360Source;
    if (dt && !['TEXT', 'NUMBER'].includes(dt.value)) errors.dataType = 'Trường 360 view chỉ hỗ trợ kiểu text/number';
  }
  let options: { value: string; label: string }[] = [];
  if (dt && CHOICE_TYPES.includes(dt.value)) {
    options = (Array.isArray(body.options) ? body.options : [])
      .map((o: any) => ({ value: String(o.value ?? '').trim(), label: String(o.label ?? '').trim() }))
      .filter((o: any) => o.value && o.label);
    if (!options.length) errors.options = 'Vui lòng khai báo ít nhất 1 giá trị lựa chọn';
    if (new Set(options.map((o) => o.value)).size !== options.length) errors.options = 'Giá trị lựa chọn bị trùng';
  }
  if (code && !/^[A-Z0-9_]+$/.test(code)) errors.code = 'Mã chỉ gồm chữ in hoa, số và "_"';
  throwIfErrors(errors);
  return {
    code,
    name,
    infoType,
    view360Source,
    dataType: dt!.value,
    displayType,
    options: JSON.stringify(options),
    required: !!body.required,
    showOnTicket: body.showOnTicket !== false,
    placeholder: body.placeholder || null,
    description: body.description || null,
    active: body.active !== false,
  };
}

catalogRouter.get(
  '/fields',
  ah(async (_req, res) => {
    const list = await prisma.field.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { formItems: true } } } });
    res.json(list.map(fieldView));
  }),
);

catalogRouter.post(
  '/fields',
  requireAdmin,
  ah(async (req, res) => {
    const data = validateField(req.body);
    if (await prisma.field.findUnique({ where: { code: data.code } })) throw bad('Mã trường đã tồn tại', { code: 'Mã trường đã tồn tại' });
    res.json(fieldView(await prisma.field.create({ data })));
  }),
);

catalogRouter.put(
  '/fields/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const cur = await prisma.field.findUnique({ where: { id }, include: { _count: { select: { formItems: true } } } });
    if (!cur) throw notFound('Trường nhập liệu');
    const data = validateField({ ...req.body, code: cur.code });
    if (cur._count.formItems && cur.dataType !== data.dataType)
      throw bad('Trường đang nằm trong mẫu nhập liệu, không được đổi kiểu dữ liệu', { dataType: 'Không được đổi kiểu dữ liệu' });
    res.json(fieldView(await prisma.field.update({ where: { id }, data })));
  }),
);

catalogRouter.delete(
  '/fields/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const n = await prisma.formItem.count({ where: { fieldId: id } });
    if (n) throw bad('Không thể xóa: trường đang được sử dụng trong mẫu nhập liệu');
    await prisma.field.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

// ───── Mẫu nhập liệu ─────

interface ItemInput {
  key: string;
  fieldId: number;
  sortOrder: number;
  parentKey?: string | null;
  parentValues?: string[];
}

async function validateFormInput(body: any, excludeId?: number) {
  const errors: Record<string, string> = {};
  const name = requireText(body.name, 'tên mẫu nhập liệu', 'name', errors);
  throwIfErrors(errors);
  const dup = await prisma.form.findMany({ where: excludeId ? { id: { not: excludeId } } : {}, select: { name: true } });
  if (dup.some((d) => d.name.trim().toLowerCase() === name.toLowerCase()))
    throw bad('Tên mẫu nhập liệu đã tồn tại', { name: 'Tên mẫu nhập liệu không được trùng' });

  const items: ItemInput[] = Array.isArray(body.items) ? body.items : [];
  const fieldIds = items.map((i) => Number(i.fieldId));
  if (new Set(fieldIds).size !== fieldIds.length) throw bad('Một trường chỉ được chọn 1 lần trong mẫu');
  const fields = await prisma.field.findMany({ where: { id: { in: fieldIds } } });
  const fm = new Map(fields.map((f) => [f.id, f]));
  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const it of items) {
    const f = fm.get(Number(it.fieldId));
    if (!f) throw bad('Trường nhập liệu không tồn tại');
    if (!f.active) throw bad(`Trường "${f.name}" đang ngừng sử dụng`);
    if (it.parentKey) {
      const parent = byKey.get(it.parentKey);
      if (!parent) throw bad(`Trường gốc của "${f.name}" không hợp lệ`);
      const pf = fm.get(Number(parent.fieldId))!;
      if (!DEPENDABLE_TYPES.includes(pf.dataType as any))
        throw bad(`Trường gốc "${pf.name}" phải có kiểu single choice / boolean / kết quả cuộc gọi`);
      if (!it.parentValues?.length) throw bad(`Vui lòng chọn giá trị kích hoạt cho trường phụ thuộc "${f.name}"`);
      let depth = 0;
      let cur: ItemInput | undefined = it;
      while (cur?.parentKey && depth < 10) {
        cur = byKey.get(cur.parentKey);
        depth++;
        if (cur === it) throw bad('Cấu hình phụ thuộc bị vòng lặp');
      }
      if (depth > MAX_DEPENDENCY_DEPTH) throw bad(`Trường "${f.name}" vượt quá ${MAX_DEPENDENCY_DEPTH} cấp phụ thuộc`);
    }
  }
  return { name, description: body.description || null, active: body.active !== false, items };
}

async function saveItems(tx: any, formId: number, items: ItemInput[]) {
  await tx.formItem.deleteMany({ where: { formId } });
  const idByKey = new Map<string, number>();
  const pending = [...items];
  let guard = 0;
  while (pending.length && guard++ < 10) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const it = pending[i];
      if (it.parentKey && !idByKey.has(it.parentKey)) continue;
      const row = await tx.formItem.create({
        data: {
          formId,
          fieldId: Number(it.fieldId),
          sortOrder: Number(it.sortOrder) || 0,
          parentItemId: it.parentKey ? idByKey.get(it.parentKey)! : null,
          parentValues: JSON.stringify(it.parentKey ? it.parentValues || [] : []),
        },
      });
      idByKey.set(it.key, row.id);
      pending.splice(i, 1);
    }
  }
}

async function formUsage(id: number) {
  const [activeServices, activeSteps, inactiveServices] = await Promise.all([
    prisma.service.count({ where: { formId: id, active: true } }),
    prisma.workflowStep.count({ where: { formId: id, workflow: { active: true } } }),
    prisma.service.count({ where: { formId: id, active: false } }),
  ]);
  return { activeServices, activeSteps, inactiveServices };
}

catalogRouter.get(
  '/forms',
  ah(async (_req, res) => {
    const list = await prisma.form.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true, services: true, steps: true } } },
    });
    res.json(
      list.map((f) => ({
        ...f,
        itemCount: f._count.items,
        serviceCount: f._count.services,
        stepCount: f._count.steps,
        _count: undefined,
      })),
    );
  }),
);

catalogRouter.get(
  '/forms/:id',
  ah(async (req, res) => {
    const f = await prisma.form.findUnique({
      where: { id: idParam(req) },
      include: { items: { include: { field: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!f) throw notFound('Mẫu nhập liệu');
    res.json({
      ...f,
      items: f.items.map((it) => ({
        id: it.id,
        key: String(it.id),
        fieldId: it.fieldId,
        sortOrder: it.sortOrder,
        parentKey: it.parentItemId ? String(it.parentItemId) : null,
        parentValues: parseJson(it.parentValues, []),
        field: fieldView(it.field),
      })),
    });
  }),
);

catalogRouter.post(
  '/forms',
  requireAdmin,
  ah(async (req, res) => {
    const input = await validateFormInput(req.body);
    const form = await prisma.$transaction(async (tx) => {
      const code = await genFormCode(tx);
      const f = await tx.form.create({ data: { code, name: input.name, description: input.description, active: input.active } });
      await saveItems(tx, f.id, input.items);
      return f;
    });
    res.json(form);
  }),
);

catalogRouter.put(
  '/forms/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    if (!(await prisma.form.findUnique({ where: { id } }))) throw notFound('Mẫu nhập liệu');
    const input = await validateFormInput(req.body, id);
    if (!input.active) {
      const u = await formUsage(id);
      if (u.activeServices || u.activeSteps)
        throw bad('Mẫu đang được dùng trong dịch vụ/công việc đang hoạt động, không thể ngừng sử dụng');
    }
    const form = await prisma.$transaction(async (tx) => {
      const f = await tx.form.update({ where: { id }, data: { name: input.name, description: input.description, active: input.active } });
      await saveItems(tx, id, input.items);
      return f;
    });
    res.json(form);
  }),
);

catalogRouter.delete(
  '/forms/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const u = await formUsage(id);
    if (u.activeServices || u.activeSteps)
      throw bad('Không thể xóa: mẫu nhập liệu đang nằm trong dịch vụ/công việc đang hoạt động');
    await prisma.$transaction(async (tx) => {
      await tx.service.updateMany({ where: { formId: id }, data: { formId: null } });
      await tx.workflowStep.updateMany({ where: { formId: id }, data: { formId: null } });
      await tx.form.delete({ where: { id } });
    });
    res.json({ ok: true });
  }),
);
