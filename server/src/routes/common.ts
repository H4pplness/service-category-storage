// Đăng nhập, tổ chức – nhân sự, chi nhánh – RM, đơn vị hành chính, khách hàng, lịch làm việc, thông báo.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAdmin, requireAuth, signToken } from '../auth';
import { HttpError, ah, bad, idParam, notFound, prisma, toInt } from '../core';
import { getCalendarConfig, invalidateCalendar } from '../services/calendar';
import { hhmmToMinutes, shiftsTotalMinutes } from '../../../shared/sla';

export const publicRouter = Router();
export const commonRouter = Router();

const userView = (u: any) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  title: u.title,
  role: u.role,
  active: u.active,
  departmentId: u.departmentId,
  departmentName: u.department?.name ?? null,
});

// ───── Auth ─────

publicRouter.post(
  '/auth/login',
  ah(async (req, res) => {
    const { username, password } = req.body || {};
    const u = await prisma.user.findUnique({ where: { username: String(username || '').trim() }, include: { department: true } });
    if (!u || !bcrypt.compareSync(String(password || ''), u.passwordHash))
      throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không đúng');
    if (!u.active) throw new HttpError(401, 'Tài khoản đã ngừng hoạt động');
    res.json({ token: signToken(u.id), user: userView(u) });
  }),
);

publicRouter.get(
  '/auth/demo-users',
  ah(async (_req, res) => {
    const users = await prisma.user.findMany({ where: { active: true }, include: { department: true }, orderBy: { id: 'asc' } });
    res.json(users.map(userView));
  }),
);

commonRouter.get(
  '/auth/me',
  ah(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id }, include: { department: true } });
    res.json(userView(u));
  }),
);

// ───── Tổ chức ─────

commonRouter.get(
  '/departments',
  ah(async (_req, res) => {
    const list = await prisma.department.findMany({ orderBy: [{ level: 'asc' }, { code: 'asc' }] });
    const users = await prisma.user.findMany({ select: { id: true, fullName: true, active: true } });
    const um = new Map(users.map((u) => [u.id, u]));
    res.json(
      list.map((d) => ({
        ...d,
        focalUserName: d.focalUserId ? um.get(d.focalUserId)?.fullName ?? null : null,
        focalUserActive: d.focalUserId ? um.get(d.focalUserId)?.active ?? false : null,
      })),
    );
  }),
);

commonRouter.put(
  '/departments/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const { focalUserId, active } = req.body || {};
    const data: any = {};
    if (focalUserId !== undefined) data.focalUserId = focalUserId ? Number(focalUserId) : null;
    if (active !== undefined) data.active = !!active;
    res.json(await prisma.department.update({ where: { id }, data }));
  }),
);

async function descendantIds(rootId: number): Promise<number[]> {
  const all = await prisma.department.findMany({ select: { id: true, parentId: true } });
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const d of all) if (d.parentId === out[i]) out.push(d.id);
  return out;
}

commonRouter.get(
  '/users',
  ah(async (req, res) => {
    const where: any = {};
    const deptId = toInt(req.query.departmentId);
    if (deptId) where.departmentId = { in: await descendantIds(deptId) };
    if (req.query.active === 'true') where.active = true;
    if (req.query.q) where.OR = [{ fullName: { contains: String(req.query.q) } }, { username: { contains: String(req.query.q) } }];
    const users = await prisma.user.findMany({ where, include: { department: true }, orderBy: { fullName: 'asc' } });
    res.json(users.map(userView));
  }),
);

commonRouter.put(
  '/users/:id',
  requireAdmin,
  ah(async (req, res) => {
    const id = idParam(req);
    const { active, departmentId, role } = req.body || {};
    const data: any = {};
    if (active !== undefined) data.active = !!active;
    if (departmentId !== undefined) data.departmentId = departmentId ? Number(departmentId) : null;
    if (role !== undefined) data.role = role === 'ADMIN' ? 'ADMIN' : 'USER';
    if (id === req.user.id && data.active === false) throw bad('Không thể tự ngừng hoạt động tài khoản đang đăng nhập');
    const u = await prisma.user.update({ where: { id }, data, include: { department: true } });
    res.json(userView(u));
  }),
);

// ───── Chi nhánh – RM, Đơn vị hành chính ─────

commonRouter.get(
  '/branches',
  ah(async (_req, res) => res.json(await prisma.branch.findMany({ orderBy: { name: 'asc' } }))),
);
commonRouter.get(
  '/rms',
  ah(async (req, res) => {
    const branchId = toInt(req.query.branchId);
    res.json(
      await prisma.relationshipManager.findMany({
        where: { active: true, ...(branchId ? { branchId } : {}) },
        orderBy: { fullName: 'asc' },
      }),
    );
  }),
);
commonRouter.get(
  '/provinces',
  ah(async (_req, res) => res.json(await prisma.province.findMany({ orderBy: { name: 'asc' } }))),
);
commonRouter.get(
  '/wards',
  ah(async (req, res) => {
    const provinceId = toInt(req.query.provinceId);
    res.json(await prisma.ward.findMany({ where: provinceId ? { provinceId } : {}, orderBy: { name: 'asc' } }));
  }),
);

// ───── Khách hàng (360 view) ─────

commonRouter.get(
  '/customers',
  ah(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const where = q
      ? { OR: [{ cif: { contains: q } }, { fullName: { contains: q } }, { phone: { contains: q } }, { idNumber: { contains: q } }] }
      : {};
    res.json(await prisma.customer.findMany({ where, take: 20, orderBy: { fullName: 'asc' } }));
  }),
);
commonRouter.get(
  '/customers/:id',
  ah(async (req, res) => {
    const c = await prisma.customer.findUnique({
      where: { id: idParam(req) },
      include: { accounts: true, cards: true, transactions: { orderBy: { txnAt: 'desc' } } },
    });
    if (!c) throw notFound('Khách hàng');
    res.json(c);
  }),
);

// ───── Lịch làm việc ─────

commonRouter.get(
  '/calendar',
  ah(async (_req, res) => res.json(await getCalendarConfig())),
);

commonRouter.put(
  '/calendar/shifts',
  requireAdmin,
  ah(async (req, res) => {
    const shifts = Array.isArray(req.body?.shifts) ? req.body.shifts : [];
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!shifts.length || shifts.some((s: any) => !re.test(s.start) || !re.test(s.end) || hhmmToMinutes(s.end) <= hhmmToMinutes(s.start)))
      throw bad('Ca làm việc không hợp lệ');
    const sorted = [...shifts].sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start));
    for (let i = 1; i < sorted.length; i++)
      if (hhmmToMinutes(sorted[i].start) < hhmmToMinutes(sorted[i - 1].end)) throw bad('Các ca làm việc bị chồng lấn');
    if (shiftsTotalMinutes(sorted) !== 480) throw bad('Tổng thời gian các ca phải bằng 8 giờ (1 ngày làm việc = 8 giờ)');
    const value = JSON.stringify(sorted.map((s: any) => ({ start: s.start, end: s.end })));
    await prisma.setting.upsert({ where: { key: 'workShifts' }, create: { key: 'workShifts', value }, update: { value } });
    invalidateCalendar();
    res.json(await getCalendarConfig());
  }),
);

commonRouter.post(
  '/calendar/holidays',
  requireAdmin,
  ah(async (req, res) => {
    const { date, name, type } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw bad('Ngày không hợp lệ', { date: 'Ngày không hợp lệ' });
    if (!String(name || '').trim()) throw bad('Vui lòng nhập tên', { name: 'Vui lòng nhập tên' });
    const exists = await prisma.holiday.findUnique({ where: { date } });
    if (exists) throw bad('Ngày này đã được khai báo', { date: 'Ngày này đã được khai báo' });
    const h = await prisma.holiday.create({ data: { date, name: String(name).trim(), type: type === 'WORKDAY' ? 'WORKDAY' : 'HOLIDAY' } });
    invalidateCalendar();
    res.json(h);
  }),
);

commonRouter.delete(
  '/calendar/holidays/:id',
  requireAdmin,
  ah(async (req, res) => {
    await prisma.holiday.delete({ where: { id: idParam(req) } });
    invalidateCalendar();
    res.json({ ok: true });
  }),
);

// ───── Thông báo ─────

commonRouter.get(
  '/notifications',
  ah(async (req, res) => {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: req.user.id, read: false } }),
    ]);
    res.json({ items, unread });
  }),
);
commonRouter.post(
  '/notifications/read-all',
  ah(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.user.id, read: false }, data: { read: true } });
    res.json({ ok: true });
  }),
);
commonRouter.post(
  '/notifications/:id/read',
  ah(async (req, res) => {
    await prisma.notification.updateMany({ where: { id: idParam(req), userId: req.user.id }, data: { read: true } });
    res.json({ ok: true });
  }),
);

export { requireAuth };
