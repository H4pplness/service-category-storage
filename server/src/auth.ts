import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError, ah, prisma } from './core';

const SECRET = process.env.JWT_SECRET || 'dcms-dev-secret-change-me';

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
  departmentId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

export function signToken(userId: number) {
  return jwt.sign({ sub: userId }, SECRET, { expiresIn: '7d' });
}

export const requireAuth = ah(async (req: Request, _res: Response, next: NextFunction) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token as string | undefined);
  if (!token) throw new HttpError(401, 'Chưa đăng nhập');
  let sub: number;
  try {
    sub = Number((jwt.verify(token, SECRET) as any).sub);
  } catch {
    throw new HttpError(401, 'Phiên đăng nhập đã hết hạn');
  }
  const u = await prisma.user.findUnique({ where: { id: sub } });
  if (!u || !u.active) throw new HttpError(401, 'Tài khoản không còn hoạt động');
  req.user = { id: u.id, username: u.username, fullName: u.fullName, role: u.role, departmentId: u.departmentId };
  next();
});

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') return next(new HttpError(403, 'Bạn không có quyền thực hiện chức năng này'));
  next();
}

export const isAdmin = (req: Request) => req.user?.role === 'ADMIN';
