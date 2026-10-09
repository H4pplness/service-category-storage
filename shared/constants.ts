export const TICKET_STATUS = {
  NEW: { label: 'Mới', color: 'blue' },
  IN_PROGRESS: { label: 'Đang xử lý', color: 'processing' },
  RETURNED: { label: 'Trả lại xử lý', color: 'orange' },
  DONE: { label: 'Hoàn thành', color: 'success' },
} as const;
export type TicketStatus = keyof typeof TICKET_STATUS;

export const TASK_STATUS = {
  NEW: { label: 'Mới', color: 'blue' },
  IN_PROGRESS: { label: 'Đang xử lý', color: 'processing' },
  RETURNED: { label: 'Trả lại xử lý', color: 'orange' },
  REPORTED_DONE: { label: 'Báo hoàn thành', color: 'purple' },
  DONE: { label: 'Hoàn thành', color: 'success' },
} as const;
export type TaskStatus = keyof typeof TASK_STATUS;

export const STEP_STATUS = {
  PENDING: { label: 'Chưa thực hiện', color: 'default' },
  ACTIVE: { label: 'Đang thực hiện', color: 'processing' },
  DONE: { label: 'Hoàn thành', color: 'success' },
  SKIPPED: { label: 'Bỏ qua', color: 'default' },
  CANCELLED: { label: 'Hủy', color: 'error' },
} as const;
export type StepStatus = keyof typeof STEP_STATUS;

export const SEGMENTS = [
  { value: 'MASS', label: 'Mass' },
  { value: 'SME', label: 'SME' },
  { value: 'PRIORITY', label: 'Priority' },
  { value: 'PRIVATE', label: 'Private' },
] as const;

export const SEGMENT_LABEL: Record<string, string> = {
  ALL: 'Tất cả phân khúc',
  MASS: 'Mass',
  SME: 'SME',
  PRIORITY: 'Priority',
  PRIVATE: 'Private',
};

export const WORK_HOURS_LABEL: Record<string, string> = {
  OFFICE: 'Giờ hành chính',
  H24: '24/7',
};

export const CHANNELS = [
  { value: 'COUNTER', label: 'Tại quầy' },
  { value: 'HOTLINE', label: 'Tổng đài' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'APP', label: 'Ứng dụng / Website' },
  { value: 'SOCIAL', label: 'Mạng xã hội' },
];
export const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.value, c.label]));

export const NOTIFY_CHANNELS = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'APP', label: 'Thông báo trên hệ thống' },
];
export const NOTIFY_LABEL: Record<string, string> = Object.fromEntries(NOTIFY_CHANNELS.map((c) => [c.value, c.label]));

export const ROUTE_TYPES = [
  { value: 'NEXT', label: 'Công việc kế tiếp (mặc định)' },
  { value: 'GOTO', label: 'Chuyển đến công việc…' },
  { value: 'END', label: 'Kết thúc quy trình' },
];

export const TASK_LIMITS = {
  maxFileSize: 10 * 1024 * 1024,
  maxFiles: 20,
};
