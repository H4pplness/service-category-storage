import { CalendarConfig, DEFAULT_SHIFTS, Shift, WorkCalendar } from '../../../shared/sla';
import { parseJson, prisma } from '../core';

let cache: WorkCalendar | null = null;

export async function getCalendarConfig(): Promise<CalendarConfig & { list: any[] }> {
  const s = await prisma.setting.findUnique({ where: { key: 'workShifts' } });
  const shifts = parseJson<Shift[]>(s?.value, DEFAULT_SHIFTS);
  const list = await prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  return {
    shifts,
    holidays: list.filter((h) => h.type === 'HOLIDAY').map((h) => h.date),
    workdays: list.filter((h) => h.type === 'WORKDAY').map((h) => h.date),
    list,
  };
}

export async function getCalendar(): Promise<WorkCalendar> {
  if (!cache) cache = new WorkCalendar(await getCalendarConfig());
  return cache;
}

export function invalidateCalendar() {
  cache = null;
}
