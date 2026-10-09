import dayjs from 'dayjs';

export const fmtDateTime = (v?: string | number | Date | null) => (v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '—');
export const fmtDate = (v?: string | number | Date | null) => (v ? dayjs(v).format('DD/MM/YYYY') : '—');
export const fmtMoney = (v?: number | null) => (v === null || v === undefined ? '—' : new Intl.NumberFormat('vi-VN').format(v));

export function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface TreeRow {
  id: number;
  parentId: number | null;
  [k: string]: any;
}

/** Danh sách phẳng → cây (children = undefined ở lá để bảng antd không hiện nút mở rộng). */
export function buildTree<T extends TreeRow>(rows: T[]): (T & { children?: any[] })[] {
  const map = new Map<number, any>();
  rows.forEach((r) => map.set(r.id, { ...r, children: [] }));
  const roots: any[] = [];
  map.forEach((n) => {
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId).children.push(n);
    else roots.push(n);
  });
  const clean = (n: any) => {
    if (!n.children.length) delete n.children;
    else n.children.forEach(clean);
  };
  roots.forEach(clean);
  return roots;
}

/** Dữ liệu cho TreeSelect: chỉ cho chọn lá (leafOnly) và bản ghi đang sử dụng. */
export function toTreeSelect(
  rows: TreeRow[],
  opts: { leafOnly?: boolean; activeOnly?: boolean; allow?: (r: any) => boolean; label?: (r: any) => string } = {},
) {
  const filtered = opts.activeOnly ? rows.filter((r) => r.active) : rows;
  const tree = buildTree(filtered);
  const conv = (n: any): any => {
    const isLeaf = !n.children?.length;
    const allowed = opts.allow ? opts.allow(n) : true;
    return {
      value: n.id,
      title: opts.label ? opts.label(n) : `${n.name}`,
      key: n.id,
      selectable: (!opts.leafOnly || isLeaf) && allowed,
      disabled: isLeaf && !allowed,
      children: n.children?.map(conv),
    };
  };
  return tree.map(conv);
}

/** Đường dẫn tên từ gốc tới node. */
export function pathName(rows: TreeRow[] | undefined, id: number | null | undefined, sep = ' / ') {
  if (!rows || !id) return '';
  const parts: string[] = [];
  let cur = rows.find((r) => r.id === id);
  let g = 0;
  while (cur && g++ < 10) {
    parts.unshift(cur.name);
    cur = cur.parentId ? rows.find((r) => r.id === cur!.parentId) : undefined;
  }
  return parts.join(sep);
}

export function descendants(rows: TreeRow[], rootId: number): number[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) rows.forEach((r) => r.parentId === out[i] && out.push(r.id));
  return out;
}

export const uid = () => (crypto as any).randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
