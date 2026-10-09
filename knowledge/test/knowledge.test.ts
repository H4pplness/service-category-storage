import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildConfig, parseProperties, resolvePlaceholders } from '../src/config';
import { buildSpaceCql, cqlDate } from '../src/confluence';
import { createApp, Context } from '../src/app';
import { KnowledgeStore } from '../src/db';
import { ConfluenceClient } from '../src/confluence';
import { SearchService, planQuery } from '../src/search';
import { SyncService } from '../src/sync';
import { extractProperties, normalize, splitSections, storageToMarkdown } from '../src/text';
import { generateMockData } from '../mock-confluence/data';
import { createMockConfluence } from '../mock-confluence/server';

const listen = (app: { listen: (port: number, cb: () => void) => Server }) =>
  new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
const portOf = (s: Server) => (s.address() as AddressInfo).port;

describe('cấu hình', () => {
  it('đọc file properties, chú thích, nối dòng và biến môi trường', () => {
    const p = parseProperties('# chú thích\na.b = 1\n! khác\nc: x \\\n  y\nd=${KHONG_CO:mac-dinh}\n');
    assert.equal(p['a.b'], '1');
    assert.equal(p.c, 'x y');
    assert.equal(resolvePlaceholders(p.d, {}), 'mac-dinh');
    assert.equal(resolvePlaceholders('${X:a}', { X: 'b' }), 'b');
  });

  it('cấu hình space, root page và label', () => {
    const cfg = buildConfig({
      'confluence.type': 'cloud',
      'confluence.base-url': 'https://x.atlassian.net/wiki/',
      'confluence.spaces': 'SPNV, OPS',
      'confluence.space.OPS.root-page-id': '123',
      'confluence.space.OPS.labels': 'sp-nv,huong-dan',
    });
    assert.equal(cfg.confluence.baseUrl, 'https://x.atlassian.net/wiki');
    assert.deepEqual(
      cfg.confluence.spaces.map((s) => s.key),
      ['SPNV', 'OPS'],
    );
    assert.equal(
      buildSpaceCql(cfg.confluence.spaces[1], '2026/10/09 08:00'),
      'space = "OPS" and type = page and ancestor = 123 and label in ("sp-nv", "huong-dan") and lastmodified >= "2026/10/09 08:00" order by lastmodified asc',
    );
    assert.throws(() => buildConfig({ 'confluence.type': 'server' }));
  });

  it('định dạng ngày CQL theo múi giờ', () => {
    assert.equal(cqlDate(new Date('2026-10-09T01:30:00Z'), 'Asia/Ho_Chi_Minh'), '2026/10/09 08:30');
  });
});

describe('xử lý văn bản', () => {
  const storage =
    '<ac:structured-macro ac:name="details"><ac:rich-text-body><table><tbody>' +
    '<tr><th>Mã sản phẩm</th><td>THE.TD.VISA</td></tr><tr><th>Phòng xử lý</th><td>Phòng Tra soát</td></tr>' +
    '</tbody></table></ac:rich-text-body></ac:structured-macro>' +
    '<ac:structured-macro ac:name="toc"/>' +
    '<h2>Khi nào nên chọn</h2><ul><li>Khách hàng <strong>mất thẻ</strong></li><li>Lộ OTP<ul><li>qua điện thoại</li></ul></li></ul>' +
    '<ac:structured-macro ac:name="note"><ac:parameter ac:name="title">Lưu ý</ac:parameter><ac:rich-text-body><p>Xử lý 24/7</p></ac:rich-text-body></ac:structured-macro>' +
    '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[a < b && c]]></ac:plain-text-body></ac:structured-macro>' +
    '<p>Xem <ac:link><ri:page ri:content-title="Trang khác"/></ac:link> &amp; tiếp</p>';

  it('chuyển storage format sang markdown', () => {
    const md = storageToMarkdown(storage);
    assert.match(md, /## Khi nào nên chọn/);
    assert.match(md, /- Khách hàng \*\*mất thẻ\*\*/);
    assert.match(md, /\n {2}- qua điện thoại/);
    assert.match(md, /> \*\*Lưu ý\*\*/);
    assert.match(md, /```\na < b && c\n```/);
    assert.match(md, /Xem Trang khác & tiếp/);
    assert.match(md, /\| Mã sản phẩm \| THE.TD.VISA \|/);
  });

  it('lấy bảng thuộc tính trang', () => {
    assert.deepEqual(extractProperties(storage), { 'Mã sản phẩm': 'THE.TD.VISA', 'Phòng xử lý': 'Phòng Tra soát' });
  });

  it('tách mục theo tiêu đề, bỏ qua dấu # trong khối code', () => {
    const s = splitSections('mở đầu\n## A\nnội dung a\n```\n# không phải tiêu đề\n```\n### B\nb');
    assert.deepEqual(
      s.map((x) => x.heading),
      ['', 'A', 'B'],
    );
  });

  it('chuẩn hoá tiếng Việt và nhận biết truy vấn có dấu', () => {
    assert.equal(normalize('Đổi Thẻ TÍN DỤNG'), 'doi the tin dung');
    assert.equal(planQuery('mất thẻ').accented, true);
    assert.equal(planQuery('mat the').accented, false);
  });
});

describe('đồng bộ + tìm kiếm + MCP (với Confluence giả lập)', () => {
  const data = generateMockData('SPNV', 0);
  let mock: Server;
  let ctx: Context;
  let app: Server;

  before(async () => {
    mock = await listen(createMockConfluence(data, 'http://127.0.0.1'));
    const base = `http://127.0.0.1:${portOf(mock)}`;
    const cfg = buildConfig({
      'confluence.type': 'datacenter',
      'confluence.base-url': base,
      'confluence.spaces': 'SPNV',
      'confluence.page-size': '20',
      'confluence.exclude-title-prefixes': '[Mục lục]',
      'mcp.auth-token': 'secret',
    });
    const store = new KnowledgeStore(':memory:');
    const client = new ConfluenceClient(cfg.confluence);
    ctx = { cfg, store, client, sync: new SyncService(store, client, cfg), search: new SearchService(store, cfg) };
    app = await listen(createApp(ctx));
  });

  after(() => {
    mock.close();
    app.close();
    ctx.store.close();
  });

  it('lần đầu quét toàn bộ, bỏ trang mục lục', async () => {
    const r = await ctx.sync.run('auto');
    assert.equal(r.status, 'SUCCESS');
    const expected = [...data.pages.values()].filter((p) => !p.title.startsWith('[Mục lục]')).length;
    assert.equal(ctx.store.countBySpace().SPNV, expected);
    const page = ctx.store.getPage('100000')!;
    assert.equal(page.title, 'Sổ tay chọn Sản phẩm - Nghiệp vụ');
    const child = [...data.pages.values()].find((p) => p.title.includes('Visa – Tra soát'))!;
    assert.deepEqual(ctx.store.getPage(child.id)!.path, ['Sổ tay chọn Sản phẩm - Nghiệp vụ', 'Thẻ']);
  });

  it('lần sau chỉ lấy trang thay đổi, phát hiện nội dung mới', async () => {
    const target = [...data.pages.values()].find((p) => p.title === 'Thẻ ghi nợ nội địa – Cấp lại PIN')!;
    const base = `http://127.0.0.1:${portOf(mock)}`;
    await fetch(`${base}/__mock/pages/${target.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appendWhen: 'Khách hàng muốn đổi PIN do sinh nhật trùng mã PIN cũ ngoạn mục' }),
    });
    const r = await ctx.sync.run('auto');
    assert.equal(r.upserted, 1);
    assert.ok(r.fetched < 20, `chỉ quét thay đổi, đã lấy ${r.fetched}`);
    const hits = ctx.search.search('sinh nhật trùng mã PIN ngoạn mục', { limit: 3 });
    assert.equal(hits[0].id, target.id);
  });

  it('đối soát xoá trang không còn trên Confluence', async () => {
    const victim = [...data.pages.values()].find((p) => p.title.startsWith('Vay tín chấp'))!;
    data.pages.delete(victim.id);
    const r = await ctx.sync.run('reconcile');
    assert.equal(r.deleted, 1);
    assert.equal(ctx.store.getPage(victim.id), null);
  });

  it('tìm kiếm có dấu/không dấu, ưu tiên mục "Khi nào nên chọn"', () => {
    const accented = ctx.search.search('quên mật khẩu đăng nhập ứng dụng', { limit: 3 });
    assert.match(accented[0].title, /Mobile Banking – Cấp lại mật khẩu/);
    assert.match(accented[0].guidance ?? '', /quên mật khẩu/);
    const ascii = ctx.search.search('quen mat khau dang nhap ung dung', { limit: 3 });
    assert.equal(ascii[0].id, accented[0].id);
    assert.match(ctx.search.search('thẻ visa bị trừ tiền 2 lần')[0].title, /Visa – Tra soát giao dịch/);
  });

  it('MCP: yêu cầu token, liệt kê tool, gọi tìm kiếm và đọc trang', async () => {
    const url = new URL(`http://127.0.0.1:${portOf(app)}/mcp`);
    const unauth = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(unauth.status, 401);

    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer secret' } } }));
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), ['get_knowledge_status', 'get_product_guidance', 'search_product_guidance']);

    const res: any = await client.callTool({ name: 'search_product_guidance', arguments: { query: 'khóa thẻ ghi nợ vì mất thẻ', limit: 3 } });
    const text = res.content[0].text as string;
    assert.match(text, /Khóa thẻ \/ tài khoản/);
    const pageId = /page_id: (\d+)/.exec(text)![1];

    const page: any = await client.callTool({ name: 'get_product_guidance', arguments: { page_id: pageId } });
    assert.match(page.content[0].text, /## Khi nào nên chọn/);
    const missing: any = await client.callTool({ name: 'get_product_guidance', arguments: { page_id: '1' } });
    assert.equal(missing.isError, true);
    await client.close();
  });
});
