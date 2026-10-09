import type { NextFunction, Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export const bad = (message: string, fieldErrors?: Record<string, string>) => new HttpError(400, message, fieldErrors);
export const notFound = (what = 'Bản ghi') => new HttpError(404, `${what} không tồn tại`);

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;
export const ah =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function toInt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n)) throw bad('Tham số không hợp lệ');
  return n;
}

export function requireText(v: unknown, label: string, field: string, errors: Record<string, string>): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) errors[field] = `Vui lòng nhập ${label}`;
  return s;
}

export function throwIfErrors(errors: Record<string, string>) {
  if (Object.keys(errors).length) throw bad('Dữ liệu không hợp lệ, vui lòng kiểm tra lại', errors);
}

// ───── Đồng hồ hệ thống (cho phép script dữ liệu mẫu giả lập thời điểm) ─────

export const clock = { now: (): Date => new Date() };

// ───── Sinh mã ─────

const pad = (n: number, w: number) => String(n).padStart(w, '0');

function vnParts(d = clock.now()) {
  const v = new Date(d.getTime() + 7 * 3600_000);
  return {
    yy: pad(v.getUTCFullYear() % 100, 2),
    mm: pad(v.getUTCMonth() + 1, 2),
    dd: pad(v.getUTCDate(), 2),
  };
}

async function nextSeq(tx: Tx, key: string): Promise<number> {
  const s = await tx.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return s.value;
}

/** P + yymmdd + xxxxx (reset theo ngày) */
export async function genTicketCode(tx: Tx) {
  const { yy, mm, dd } = vnParts();
  const k = `P${yy}${mm}${dd}`;
  return k + pad(await nextSeq(tx, k), 5);
}

/** V + yymmdd + xxxxx (reset theo ngày) */
export async function genTaskCode(tx: Tx) {
  const { yy, mm, dd } = vnParts();
  const k = `V${yy}${mm}${dd}`;
  return k + pad(await nextSeq(tx, k), 5);
}

/** F + mmyy + xxxx (reset theo tháng) */
export async function genFormCode(tx: Tx) {
  const { yy, mm } = vnParts();
  const k = `F${mm}${yy}`;
  return k + pad(await nextSeq(tx, k), 4);
}

// ───── Lịch sử (log) ─────

export interface Change {
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface Actor {
  id: number;
  fullName: string;
}

export const SYSTEM_NAME = 'Hệ thống';

function display(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.length ? v.map((x) => display(x)).join(', ') : null;
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function diff(defs: { field: string; label: string; old: unknown; new: unknown }[]): Change[] {
  const out: Change[] = [];
  for (const d of defs) {
    const o = display(d.old);
    const n = display(d.new);
    if (o !== n) out.push({ field: d.field, label: d.label, oldValue: o, newValue: n });
  }
  return out;
}

export async function logHistory(
  tx: Tx,
  p: { entityType: 'TICKET' | 'TASK'; entityId: number; actor: Actor | null; action: string; summary?: string; changes?: Change[] },
) {
  await tx.history.create({
    data: {
      entityType: p.entityType,
      entityId: p.entityId,
      actorId: p.actor?.id ?? null,
      actorName: p.actor?.fullName ?? SYSTEM_NAME,
      action: p.action,
      summary: p.summary,
      changes: JSON.stringify(p.changes ?? []),
      createdAt: clock.now(),
    },
  });
}

export async function notify(tx: Tx, userId: number | null | undefined, title: string, message: string, link?: string) {
  if (!userId) return;
  await tx.notification.create({ data: { userId, title, message, link, createdAt: clock.now() } });
}
