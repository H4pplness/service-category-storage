// Đẩy dữ liệu mẫu Sản phẩm - Nghiệp vụ lên Confluence (dùng cấu hình kết nối của kho tri thức).
//   npm run seed:confluence -w knowledge -- --dry-run     xem trước, không ghi
//   npm run seed:confluence -w knowledge                  tạo/cập nhật trang trên space đầu tiên trong confluence.spaces
// Chạy lại an toàn: trang trùng tiêu đề được cập nhật (nếu nội dung đổi) thay vì tạo mới.
import { getConfig } from '../src/config';
import { ConfluenceClient } from '../src/confluence';
import { storageToMarkdown } from '../src/text';
import { GROUPS, Operation, OPERATIONS, Product, PRODUCTS } from './catalog';

const SEED_LABEL = 'du-lieu-mau';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const pageTitle = (p: Product, op: Operation) => `${p.name} – ${op.name}`;
const groupTitle = (g: string) => `[Mục lục] ${g}`;

function spNvStorage(p: Product, op: Operation): string {
  const li = (items: string[]) => '<ul>' + items.map((i) => `<li>${md(i.replace(/\{sp\}/g, p.name))}</li>`).join('') + '</ul>';
  const row = (k: string, v: string) => `<tr><th><p>${esc(k)}</p></th><td><p>${esc(v)}</p></td></tr>`;
  return [
    '<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body><table><tbody>',
    row('Mã sản phẩm', p.code),
    row('Sản phẩm', p.name),
    row('Nhóm sản phẩm', p.group),
    row('Mã nghiệp vụ', op.code),
    row('Nghiệp vụ', op.name),
    row('Phòng xử lý', op.dept),
    row('SLA tham chiếu', op.sla),
    row('Kênh tiếp nhận', op.channel),
    '</tbody></table></ac:rich-text-body></ac:structured-macro>',
    p.note ? `<p><strong>${esc(p.name)}</strong>: ${esc(p.note)}.</p>` : '',
    '<h2>Khi nào nên chọn</h2>',
    `<p>Chọn <strong>${esc(pageTitle(p, op))}</strong> khi:</p>`,
    li(op.when),
    '<h2>Không áp dụng khi</h2>',
    li(op.notWhen),
    '<h2>Thông tin, hồ sơ cần thu thập</h2>',
    `<ol>${op.docs.map((d) => `<li>${md(d)}</li>`).join('')}</ol>`,
    op.note
      ? `<ac:structured-macro ac:name="note" ac:schema-version="1"><ac:parameter ac:name="title">Lưu ý</ac:parameter><ac:rich-text-body><p>${md(op.note)}</p></ac:rich-text-body></ac:structured-macro>`
      : '',
    '<h2>Quy trình xử lý tóm tắt</h2>',
    `<p>Phiếu được chuyển tới <strong>${esc(op.dept)}</strong>. SLA tham chiếu: ${esc(op.sla)}. Chi tiết các bước xem tại cấu hình Dịch vụ trên DCMS.</p>`,
    '<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body><p>Dữ liệu mẫu phục vụ thử nghiệm trợ lý chọn SP-NV của DCMS – không phải quy định nghiệp vụ chính thức.</p></ac:rich-text-body></ac:structured-macro>',
  ].join('');
}

function groupStorage(g: string): string {
  return (
    `<p>Danh sách Sản phẩm - Nghiệp vụ nhóm <strong>${esc(g)}</strong>. Mỗi trang con mô tả khi nào nên chọn SP-NV đó khi tạo phiếu trên DCMS.</p>` +
    '<ac:structured-macro ac:name="children" ac:schema-version="2"><ac:parameter ac:name="all">true</ac:parameter></ac:structured-macro>'
  );
}

interface RemotePage {
  id: string;
  title: string;
  version: { number: number };
  body?: { storage?: { value: string } };
  ancestors?: { id: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const cfg = getConfig();
  const space = cfg.confluence.spaces[0]?.key;
  if (!space) throw new Error('Chưa cấu hình confluence.spaces');
  const client = new ConfluenceClient(cfg.confluence);
  const api = client.apiBase;

  const plan: { group: string; product: Product; op: Operation }[] = [];
  for (const product of PRODUCTS) {
    for (const code of product.ops) {
      const op = OPERATIONS[code];
      if (!op) throw new Error(`Thiếu nghiệp vụ ${code} cho ${product.code}`);
      plan.push({ group: product.group, product, op });
    }
  }
  console.log(`Space ${space} (${cfg.confluence.baseUrl}): ${GROUPS.length} trang mục lục + ${plan.length} trang SP-NV${dryRun ? ' [DRY RUN]' : ''}`);
  if (dryRun) {
    for (const g of GROUPS) {
      console.log(`\n${groupTitle(g)}`);
      plan.filter((x) => x.group === g).forEach((x) => console.log(`  - ${pageTitle(x.product, x.op)}`));
    }
    return;
  }

  const homeId = await client.getSpaceHomepageId(space);
  const stats = { created: 0, updated: 0, unchanged: 0 };

  const find = async (title: string): Promise<RemotePage | null> => {
    const qs = new URLSearchParams({ spaceKey: space, title, expand: 'version,body.storage,ancestors' });
    const r = await client.request<{ results: RemotePage[] }>('GET', `${api}/content?${qs}`);
    return r.results[0] ?? null;
  };

  const addLabels = (id: string, labels: string[]) =>
    client.request('POST', `${api}/content/${id}/label`, labels.map((name) => ({ prefix: 'global', name })));

  const upsert = async (title: string, storage: string, parentId: string | null, labels: string[]): Promise<string> => {
    const existing = await find(title);
    const ancestors = parentId ? [{ id: parentId }] : undefined;
    if (!existing) {
      const created = await client.request<{ id: string }>('POST', `${api}/content`, {
        type: 'page',
        title,
        space: { key: space },
        ancestors,
        body: { storage: { value: storage, representation: 'storage' } },
      });
      await addLabels(created.id, labels);
      stats.created++;
      console.log(`  + ${title}`);
      return created.id;
    }
    const sameParent = !parentId || existing.ancestors?.at(-1)?.id === parentId;
    // Confluence chuẩn hoá lại storage khi lưu → so sánh nội dung hiển thị thay vì chuỗi gốc
    if (storageToMarkdown(existing.body?.storage?.value ?? '') === storageToMarkdown(storage) && sameParent) {
      stats.unchanged++;
      return existing.id;
    }
    await client.request('PUT', `${api}/content/${existing.id}`, {
      id: existing.id,
      type: 'page',
      title,
      space: { key: space },
      ancestors,
      version: { number: existing.version.number + 1, message: 'Cập nhật dữ liệu mẫu SP-NV' },
      body: { storage: { value: storage, representation: 'storage' } },
    });
    await addLabels(existing.id, labels);
    stats.updated++;
    console.log(`  ~ ${title}`);
    return existing.id;
  };

  for (const g of GROUPS) {
    const groupId = await upsert(groupTitle(g), groupStorage(g), homeId, ['muc-luc', SEED_LABEL]);
    for (const x of plan.filter((p) => p.group === g)) {
      await upsert(pageTitle(x.product, x.op), spNvStorage(x.product, x.op), groupId, ['sp-nv', SEED_LABEL, slug(g), slug(x.op.name)]);
      await sleep(120); // giảm tải cho Confluence Cloud
    }
  }
  console.log(`\nXong: tạo mới ${stats.created}, cập nhật ${stats.updated}, không đổi ${stats.unchanged}.`);
}

main().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
