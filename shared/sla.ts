// Tính SLA / thời điểm đến hạn / sớm - trễ. Dùng chung cho server và web.
// Toàn bộ phép tính lịch làm việc theo giờ Việt Nam (UTC+7, không có DST).

export type WorkHoursMode = 'OFFICE' | 'H24';

export interface Shift {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface CalendarConfig {
  shifts: Shift[];
  holidays: string[]; // YYYY-MM-DD ngày nghỉ lễ
  workdays: string[]; // YYYY-MM-DD ngày làm bù (làm việc dù là T7/CN)
}

export const DEFAULT_SHIFTS: Shift[] = [
  { start: '08:00', end: '12:00' },
  { start: '13:00', end: '17:00' },
];

const VN_OFFSET = 7 * 3600_000;
const DAY_MS = 86400_000;
const MIN_MS = 60_000;

/** 1 ngày (1N) theo đặc tả: giờ hành chính = 8 giờ, 24/7 = 24 giờ. */
export function dayLengthMinutes(mode: WorkHoursMode): number {
  return mode === 'H24' ? 1440 : 480;
}

export function slaToMinutes(days: number, hours: number, minutes: number, mode: WorkHoursMode): number {
  return (days || 0) * dayLengthMinutes(mode) + (hours || 0) * 60 + (minutes || 0);
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function shiftsTotalMinutes(shifts: Shift[]): number {
  return shifts.reduce((s, x) => s + Math.max(0, hhmmToMinutes(x.end) - hhmmToMinutes(x.start)), 0);
}

function vnDayStart(ms: number): number {
  return Math.floor((ms + VN_OFFSET) / DAY_MS) * DAY_MS - VN_OFFSET;
}

export function vnDateString(ms: number): string {
  return new Date(ms + VN_OFFSET).toISOString().slice(0, 10);
}

export class WorkCalendar {
  private shifts: [number, number][];
  private holidays: Set<string>;
  private workdays: Set<string>;

  constructor(cfg: CalendarConfig) {
    const shifts = cfg.shifts?.length ? cfg.shifts : DEFAULT_SHIFTS;
    this.shifts = shifts
      .map((s) => [hhmmToMinutes(s.start), hhmmToMinutes(s.end)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    this.holidays = new Set(cfg.holidays || []);
    this.workdays = new Set(cfg.workdays || []);
  }

  isWorkingDay(dayStart: number): boolean {
    const ds = vnDateString(dayStart);
    if (this.workdays.has(ds)) return true;
    if (this.holidays.has(ds)) return false;
    const wd = new Date(dayStart + VN_OFFSET).getUTCDay();
    return wd >= 1 && wd <= 5;
  }

  private segments(dayStart: number): [number, number][] {
    if (!this.isWorkingDay(dayStart)) return [];
    return this.shifts.map(([a, b]) => [dayStart + a * MIN_MS, dayStart + b * MIN_MS]);
  }

  /** Cộng `minutes` phút làm việc vào thời điểm start. */
  addWorkingMinutes(startMs: number, minutes: number): number {
    if (minutes <= 0) return startMs;
    let remaining = minutes * MIN_MS;
    let day = vnDayStart(startMs);
    for (let i = 0; i < 3700; i++) {
      for (const [a, b] of this.segments(day)) {
        const s = Math.max(startMs, a);
        if (s >= b) continue;
        const avail = b - s;
        if (remaining <= avail) return s + remaining;
        remaining -= avail;
      }
      day += DAY_MS;
    }
    return startMs + minutes * MIN_MS;
  }

  /** Số phút làm việc nằm giữa a và b (âm nếu b < a). */
  workingMinutesBetween(a: number, b: number): number {
    if (b < a) return -this.workingMinutesBetween(b, a);
    let total = 0;
    let day = vnDayStart(a);
    for (let i = 0; i < 3700 && day <= b; i++) {
      for (const [s, e] of this.segments(day)) {
        const lo = Math.max(a, s);
        const hi = Math.min(b, e);
        if (hi > lo) total += hi - lo;
      }
      day += DAY_MS;
    }
    return total / MIN_MS;
  }
}

export function addDuration(mode: WorkHoursMode, cal: WorkCalendar, startMs: number, minutes: number): number {
  if (mode === 'H24') return startMs + minutes * MIN_MS;
  return cal.addWorkingMinutes(startMs, minutes);
}

/** Thời lượng (phút) từ a đến b theo chế độ giờ làm việc; âm nếu b < a. */
export function durationBetween(mode: WorkHoursMode, cal: WorkCalendar, a: number, b: number): number {
  if (mode === 'H24') return (b - a) / MIN_MS;
  return cal.workingMinutesBetween(a, b);
}

/** Định dạng: bỏ các thành phần bằng 0; tất cả bằng 0 → "0 phút". */
export function formatDuration(minutes: number, mode: WorkHoursMode): string {
  const total = Math.floor(Math.abs(minutes));
  const dayLen = dayLengthMinutes(mode);
  const d = Math.floor(total / dayLen);
  const h = Math.floor((total % dayLen) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} ngày`);
  if (h) parts.push(`${h} giờ`);
  if (m) parts.push(`${m} phút`);
  return parts.length ? parts.join(' ') : '0 phút';
}

export function formatSla(minutes: number, mode: WorkHoursMode): string {
  return formatDuration(minutes, mode);
}

export type SlaTag = 'NEAR_DUE' | 'OVERDUE' | null;

export interface SlaInfo {
  diffMinutes: number; // X
  kind: 'EARLY' | 'LATE' | 'ON_TIME';
  text: string; // "Sớm 1 giờ" / "Trễ 2 ngày 3 giờ" / "Đúng hạn"
  tag: SlaTag;
  done: boolean;
}

export function computeSla(p: {
  mode: WorkHoursMode;
  cal: WorkCalendar;
  startAt: number;
  dueAt: number;
  completedAt?: number | null;
  slaMinutes: number;
  now?: number;
}): SlaInfo {
  const now = p.now ?? Date.now();
  const done = !!p.completedAt;
  const ref = done ? (p.completedAt as number) : now;
  const x = durationBetween(p.mode, p.cal, ref, p.dueAt);
  let kind: SlaInfo['kind'];
  if (done && Math.abs(x) < 1) kind = 'ON_TIME';
  else kind = x > 0 || (!done && x === 0) ? 'EARLY' : 'LATE';
  const text = kind === 'ON_TIME' ? 'Đúng hạn' : `${kind === 'EARLY' ? 'Sớm' : 'Trễ'} ${formatDuration(x, p.mode)}`;

  let tag: SlaTag = null;
  if (done) {
    if ((p.completedAt as number) > p.dueAt) tag = 'OVERDUE';
  } else if (now > p.dueAt) {
    tag = 'OVERDUE';
  } else if (p.slaMinutes > 0) {
    const elapsed = durationBetween(p.mode, p.cal, p.startAt, now);
    const ratio = elapsed / p.slaMinutes;
    if (ratio >= 0.9 && ratio <= 1) tag = 'NEAR_DUE';
  }
  return { diffMinutes: x, kind, text, tag, done };
}
