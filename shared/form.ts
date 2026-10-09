// Mẫu nhập liệu động: định nghĩa trường, thứ tự hiển thị, phụ thuộc và validate.

export type DataType =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'SINGLE_CHOICE'
  | 'MULTI_CHOICE'
  | 'BOOLEAN'
  | 'CALL_RESULT'
  | 'BRANCH_RM'
  | 'ADMIN_UNIT';

export type DisplayType = 'TEXTBOX' | 'TEXTAREA' | 'DATEPICKER' | 'DROPDOWN' | 'RADIO' | 'CHECKBOX' | 'SWITCH' | 'COMPOSITE';

export type InfoType = 'INPUT' | 'VIEW360';

export type View360Source =
  | 'ACCOUNT_NO'
  | 'CARD_NO'
  | 'TRANSACTION'
  | 'CUSTOMER_PHONE'
  | 'CUSTOMER_EMAIL'
  | 'CUSTOMER_ID_NUMBER'
  | 'CUSTOMER_ADDRESS';

export interface Option {
  value: string;
  label: string;
}

export interface FormItemDef {
  itemId: number | string;
  fieldId: number;
  code: string;
  name: string;
  infoType: InfoType;
  view360Source?: View360Source | null;
  dataType: DataType;
  displayType: DisplayType;
  options: Option[];
  required: boolean;
  showOnTicket: boolean;
  placeholder?: string | null;
  sortOrder: number;
  parentItemId?: number | string | null;
  parentValues: string[];
}

export interface FormSnapshot {
  id: number;
  code: string;
  name: string;
  items: FormItemDef[];
}

export const DATA_TYPES: { value: DataType; label: string; displays: DisplayType[] }[] = [
  { value: 'TEXT', label: 'Văn bản (text)', displays: ['TEXTBOX', 'TEXTAREA'] },
  { value: 'NUMBER', label: 'Số (number)', displays: ['TEXTBOX'] },
  { value: 'DATE', label: 'Ngày (date)', displays: ['DATEPICKER'] },
  { value: 'SINGLE_CHOICE', label: 'Chọn một (single choice)', displays: ['DROPDOWN', 'RADIO'] },
  { value: 'MULTI_CHOICE', label: 'Chọn nhiều (multi choice)', displays: ['DROPDOWN', 'CHECKBOX'] },
  { value: 'BOOLEAN', label: 'Có / Không (boolean)', displays: ['CHECKBOX', 'SWITCH', 'RADIO'] },
  { value: 'CALL_RESULT', label: 'Kết quả cuộc gọi', displays: ['DROPDOWN', 'RADIO'] },
  { value: 'BRANCH_RM', label: 'Chi nhánh – RM', displays: ['COMPOSITE'] },
  { value: 'ADMIN_UNIT', label: 'Đơn vị tổ chức hành chính', displays: ['COMPOSITE'] },
];

export const DISPLAY_TYPE_LABELS: Record<DisplayType, string> = {
  TEXTBOX: 'Textbox',
  TEXTAREA: 'Textarea (nhiều dòng)',
  DATEPICKER: 'Datepicker',
  DROPDOWN: 'Dropdownlist',
  RADIO: 'Radio',
  CHECKBOX: 'Checkbox',
  SWITCH: 'Switch',
  COMPOSITE: 'Bộ trường ghép',
};

export const VIEW360_SOURCES: { value: View360Source; label: string }[] = [
  { value: 'ACCOUNT_NO', label: 'Số tài khoản (danh sách tài khoản KH)' },
  { value: 'CARD_NO', label: 'Số thẻ (danh sách thẻ KH)' },
  { value: 'TRANSACTION', label: 'Mã giao dịch (giao dịch tài khoản/thẻ)' },
  { value: 'CUSTOMER_PHONE', label: 'Số điện thoại khách hàng' },
  { value: 'CUSTOMER_EMAIL', label: 'Email khách hàng' },
  { value: 'CUSTOMER_ID_NUMBER', label: 'Số giấy tờ tùy thân' },
  { value: 'CUSTOMER_ADDRESS', label: 'Địa chỉ khách hàng' },
];

/** Kiểu dữ liệu được phép làm trường gốc cho trường phụ thuộc. */
export const DEPENDABLE_TYPES: DataType[] = ['SINGLE_CHOICE', 'BOOLEAN', 'CALL_RESULT'];
export const CHOICE_TYPES: DataType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'CALL_RESULT'];
export const MAX_DEPENDENCY_DEPTH = 2;

export const BOOLEAN_OPTIONS: Option[] = [
  { value: 'true', label: 'Có' },
  { value: 'false', label: 'Không' },
];

export function optionsOf(item: Pick<FormItemDef, 'dataType' | 'options'>): Option[] {
  return item.dataType === 'BOOLEAN' ? BOOLEAN_OPTIONS : item.options || [];
}

/** Sắp xếp: trường gốc theo thứ tự, trường phụ thuộc hiển thị liền kề ngay sau trường gốc. */
export function orderItems<T extends Pick<FormItemDef, 'itemId' | 'sortOrder' | 'parentItemId'>>(items: T[]): T[] {
  const byParent = new Map<string, T[]>();
  const ids = new Set(items.map((i) => String(i.itemId)));
  for (const it of items) {
    const p = it.parentItemId != null && ids.has(String(it.parentItemId)) ? String(it.parentItemId) : '';
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(it);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  const out: T[] = [];
  const walk = (p: string, guard: number) => {
    if (guard > 5) return;
    for (const it of byParent.get(p) || []) {
      out.push(it);
      walk(String(it.itemId), guard + 1);
    }
  };
  walk('', 0);
  return out;
}

export function depthOf(item: FormItemDef, items: FormItemDef[]): number {
  let d = 0;
  let cur: FormItemDef | undefined = item;
  while (cur && cur.parentItemId != null && d < 10) {
    cur = items.find((i) => String(i.itemId) === String(cur!.parentItemId));
    if (cur) d++;
  }
  return d;
}

function valueToKey(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

export function isItemVisible(item: FormItemDef, items: FormItemDef[], values: Record<string, unknown>): boolean {
  if (item.parentItemId == null) return true;
  const parent = items.find((i) => String(i.itemId) === String(item.parentItemId));
  if (!parent) return true;
  if (!isItemVisible(parent, items, values)) return false;
  const key = valueToKey(values[parent.code]);
  return key !== null && item.parentValues.includes(key);
}

export function visibleItems(items: FormItemDef[], values: Record<string, unknown>, opts?: { ticketOnly?: boolean }): FormItemDef[] {
  return orderItems(items).filter(
    (it) => (!opts?.ticketOnly || it.showOnTicket) && isItemVisible(it, items, values),
  );
}

export function isEmptyValue(item: FormItemDef, v: any): boolean {
  if (v === null || v === undefined) return true;
  switch (item.dataType) {
    case 'BOOLEAN':
      return typeof v !== 'boolean' && v !== 'true' && v !== 'false';
    case 'MULTI_CHOICE':
      return !Array.isArray(v) || v.length === 0;
    case 'BRANCH_RM':
      return !v.branchId || !v.rmId;
    case 'ADMIN_UNIT':
      return !v.provinceId || !v.wardId || !String(v.address || '').trim();
    case 'NUMBER':
      return v === '' || Number.isNaN(Number(v));
    default:
      return String(v).trim() === '';
  }
}

/** Trả về lỗi theo mã trường (chỉ xét các trường đang hiển thị). */
export function validateDynamicValues(
  items: FormItemDef[],
  values: Record<string, unknown>,
  opts?: { ticketOnly?: boolean },
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const it of visibleItems(items, values, opts)) {
    const v: any = values[it.code];
    if (it.required && it.dataType !== 'BOOLEAN' && isEmptyValue(it, v)) {
      errors[it.code] = `Vui lòng nhập "${it.name}"`;
      continue;
    }
    if (it.required && it.dataType === 'BOOLEAN' && isEmptyValue(it, v) && it.displayType === 'RADIO') {
      errors[it.code] = `Vui lòng chọn "${it.name}"`;
      continue;
    }
    if (v === null || v === undefined || v === '') continue;
    if (it.dataType === 'NUMBER' && Number.isNaN(Number(v))) errors[it.code] = `"${it.name}" phải là số`;
    if ((it.dataType === 'SINGLE_CHOICE' || it.dataType === 'CALL_RESULT') && !optionsOf(it).some((o) => o.value === v))
      errors[it.code] = `Giá trị "${it.name}" không hợp lệ`;
    if (it.dataType === 'MULTI_CHOICE' && Array.isArray(v) && v.some((x) => !optionsOf(it).some((o) => o.value === x)))
      errors[it.code] = `Giá trị "${it.name}" không hợp lệ`;
  }
  return errors;
}

/** Chỉ giữ giá trị của các trường đang hiển thị. */
export function pruneValues(items: FormItemDef[], values: Record<string, unknown>, opts?: { ticketOnly?: boolean }) {
  const out: Record<string, unknown> = {};
  for (const it of visibleItems(items, values, opts)) {
    if (values[it.code] !== undefined) out[it.code] = values[it.code];
  }
  return out;
}
