import { Router } from 'express';
import { ah, prisma } from '../core';
import { computeSla, WorkHoursMode } from '../../../shared/sla';
import { getCalendar } from '../services/calendar';
import { taskSummary, ticketSummary } from './helpers';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const uid = req.user.id;
    const cal = await getCalendar();
    const now = Date.now();
    const [openTasks, byStatus, ownedOpen, recentTickets] = await Promise.all([
      prisma.task.findMany({
        where: { assigneeId: uid, status: { not: 'DONE' }, step: { status: { not: 'CANCELLED' } } },
        include: { assignee: true, department: true, creator: true, step: true, ticket: { include: { customer: true } } },
        orderBy: { dueAt: 'asc' },
      }),
      prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.ticket.count({ where: { ownerId: uid, status: { not: 'DONE' } } }),
      prisma.ticket.findMany({
        where: { OR: [{ ownerId: uid }, { creatorId: uid }] },
        include: { product: true, operation: true, owner: true, creator: true, customer: true, service: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);
    let overdue = 0;
    let nearDue = 0;
    const tasks = openTasks.map((t) => {
      const sla = computeSla({
        mode: t.workHoursMode as WorkHoursMode,
        cal,
        startAt: t.createdAt.getTime(),
        dueAt: t.dueAt.getTime(),
        completedAt: null,
        slaMinutes: t.slaMinutes,
        now,
      });
      if (sla.tag === 'OVERDUE') overdue++;
      if (sla.tag === 'NEAR_DUE') nearDue++;
      return { ...taskSummary(t), stepName: t.step.name, ticketCode: t.ticket.code, customerName: t.ticket.customer?.fullName ?? null };
    });
    res.json({
      myOpenTasks: tasks.length,
      myNewTasks: openTasks.filter((t) => t.status === 'NEW').length,
      myOverdueTasks: overdue,
      myNearDueTasks: nearDue,
      myOwnedOpenTickets: ownedOpen,
      ticketsByStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      tasks: tasks.slice(0, 8),
      recentTickets: recentTickets.map(ticketSummary),
    });
  }),
);
