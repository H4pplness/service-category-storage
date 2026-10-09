import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { TASK_LIMITS } from '../../../shared/constants';
import { Tx, bad, diff, parseJson, prisma } from '../core';
import type { FormItemDef } from '../../../shared/form';

export const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: TASK_LIMITS.maxFileSize, files: TASK_LIMITS.maxFiles },
});

export const decodeName = (name: string) => {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
};

export async function saveAttachments(tx: Tx, ownerType: 'TICKET' | 'TASK', ownerId: number, files: Express.Multer.File[], userId: number) {
  const out: { id: number; fileName: string }[] = [];
  for (const f of files) {
    out.push(
      await tx.attachment.create({
        data: {
          ownerType,
          ownerId,
          fileName: decodeName(f.originalname),
          storedName: f.filename,
          size: f.size,
          mimeType: f.mimetype,
          uploadedById: userId,
        },
      }),
    );
  }
  return out;
}

export function removeFiles(files: Express.Multer.File[] | undefined) {
  for (const f of files || []) fs.promises.unlink(f.path).catch(() => undefined);
}

export async function listAttachments(ownerType: 'TICKET' | 'TASK', ownerId: number) {
  const list = await prisma.attachment.findMany({ where: { ownerType, ownerId }, orderBy: { createdAt: 'asc' } });
  const users = await prisma.user.findMany({ where: { id: { in: list.map((a) => a.uploadedById!).filter(Boolean) } } });
  return list.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    size: a.size,
    mimeType: a.mimeType,
    createdAt: a.createdAt,
    uploadedById: a.uploadedById,
    uploadedByName: users.find((u) => u.id === a.uploadedById)?.fullName ?? null,
  }));
}

/** Toàn bộ id phòng ban con cháu (bao gồm chính nó). */
export async function deptSubtree(rootId: number): Promise<number[]> {
  const all = await prisma.department.findMany({ select: { id: true, parentId: true } });
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const d of all) if (d.parentId === out[i]) out.push(d.id);
  return out;
}

/** Kiểm tra cặp Phòng ban/Nhân sự; phòng ban được cập nhật theo phòng ban nhỏ nhất của nhân sự. */
export async function validateAssignment(departmentId: unknown, assigneeId: unknown) {
  const errors: Record<string, string> = {};
  const dId = Number(departmentId) || null;
  const uId = Number(assigneeId) || null;
  if (!dId) errors.departmentId = 'Vui lòng chọn Phòng ban chuyên xử lý';
  if (!uId) errors.assigneeId = 'Vui lòng chọn Nhân sự chuyên xử lý';
  if (Object.keys(errors).length) throw bad('Dữ liệu không hợp lệ', errors);
  const u = await prisma.user.findUnique({ where: { id: uId! } });
  if (!u || !u.active || !u.departmentId) throw bad('Nhân sự không còn hoạt động', { assigneeId: 'Nhân sự không còn hoạt động trên hệ thống' });
  const sub = await deptSubtree(dId!);
  if (!sub.includes(u.departmentId)) throw bad('Nhân sự không thuộc phòng ban đã chọn', { assigneeId: 'Nhân sự không thuộc phòng ban đã chọn' });
  return { departmentId: u.departmentId, assigneeId: u.id, user: u };
}

export function taskSummary(t: any) {
  return {
    id: t.id,
    code: t.code,
    status: t.status,
    ticketId: t.ticketId,
    ticketStepId: t.ticketStepId,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.fullName ?? null,
    departmentId: t.departmentId,
    departmentName: t.department?.name ?? null,
    creatorId: t.creatorId,
    creatorName: t.creator?.fullName ?? (t.creatorId ? null : 'Hệ thống'),
    createdAt: t.createdAt,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
    slaMinutes: t.slaMinutes,
    workHoursMode: t.workHoursMode,
    resultLabel: t.resultLabel,
  };
}

export function ticketSummary(t: any) {
  return {
    id: t.id,
    code: t.code,
    channel: t.channel,
    status: t.status,
    productId: t.productId,
    productName: t.product?.name,
    operationId: t.operationId,
    operationName: t.operation?.name,
    serviceCode: t.service?.code ?? null,
    customerId: t.customerId,
    customerName: t.customer?.fullName ?? null,
    customerCif: t.customer?.cif ?? null,
    segment: t.segment,
    ownerId: t.ownerId,
    ownerName: t.owner?.fullName,
    creatorId: t.creatorId,
    creatorName: t.creator?.fullName,
    createdAt: t.createdAt,
    slaStartAt: t.slaStartAt,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
    slaMinutes: t.slaMinutes,
    workHoursMode: t.workHoursMode,
    workflowName: parseJson<any>(t.configSnapshot, {})?.workflow?.name ?? null,
    hasAutoGenError: !!t.autoGenError,
  };
}

/** Hiển thị giá trị trường động dạng chữ để ghi lịch sử. */
async function dynDisplay(items: FormItemDef[], values: Record<string, any>) {
  const out: Record<string, string | null> = {};
  for (const it of items) {
    const v = values[it.code];
    if (v === undefined || v === null || v === '') {
      out[it.code] = null;
      continue;
    }
    if (it.dataType === 'SINGLE_CHOICE' || it.dataType === 'CALL_RESULT') out[it.code] = it.options.find((o) => o.value === v)?.label ?? String(v);
    else if (it.dataType === 'MULTI_CHOICE') out[it.code] = (v as string[]).map((x) => it.options.find((o) => o.value === x)?.label ?? x).join(', ');
    else if (it.dataType === 'BOOLEAN') out[it.code] = v === true || v === 'true' ? 'Có' : 'Không';
    else if (it.dataType === 'BRANCH_RM') {
      const b = v.branchId ? await prisma.branch.findUnique({ where: { id: Number(v.branchId) } }) : null;
      const r = v.rmId ? await prisma.relationshipManager.findUnique({ where: { id: Number(v.rmId) } }) : null;
      out[it.code] = [b?.name, r?.fullName].filter(Boolean).join(' | ');
    } else if (it.dataType === 'ADMIN_UNIT') {
      const p = v.provinceId ? await prisma.province.findUnique({ where: { id: Number(v.provinceId) } }) : null;
      const w = v.wardId ? await prisma.ward.findUnique({ where: { id: Number(v.wardId) } }) : null;
      out[it.code] = [v.address, w?.name, p?.name].filter(Boolean).join(', ');
    } else out[it.code] = String(v);
  }
  return out;
}

export async function dynChanges(items: FormItemDef[], oldV: Record<string, any>, newV: Record<string, any>) {
  const [a, b] = await Promise.all([dynDisplay(items, oldV), dynDisplay(items, newV)]);
  return diff(items.map((it) => ({ field: `dyn.${it.code}`, label: it.name, old: a[it.code], new: b[it.code] })));
}

