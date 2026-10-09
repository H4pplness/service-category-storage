// Confluence giả lập để nghiệm thu: mô phỏng REST API (CQL search, content by id, phân trang _links.next)
// cho cả Data Center (/rest/api) lẫn Cloud (/wiki/rest/api) + trang xem nội dung + API chỉnh sửa giả lập.
//   npm run mock:confluence            (mặc định cổng 8090, 300 trang)
//   MOCK_PAGES=10000 npm run mock:confluence   (kiểm thử quy mô lớn)
import express, { Request, Response, Router } from 'express';
import { generateMockData, MockData, MockPage } from './data';

const TZ_OFFSET = '+07:00'; // CQL lastmodified được hiểu theo giờ Việt Nam

/** Tạo ứng dụng Confluence giả lập trên bộ dữ liệu cho trước (dùng chung cho chạy tay và test tự động) */
export function createMockConfluence(data: MockData, BASE: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  // ───── CQL tối giản ─────
  interface CqlFilter {
    spaces?: string[];
    type?: string;
    ancestor?: string;
    labels?: string[];
    modifiedSince?: Date;
  }

  function parseList(s: string): string[] {
    return [...s.matchAll(/"((?:[^"\\]|\\.)*)"|([^\s,()]+)/g)].map((m) => m[1] ?? m[2]);
  }

  function parseCql(cql: string): CqlFilter {
    const f: CqlFilter = {};
    const q = cql.replace(/\s+order\s+by[\s\S]*$/i, '');
    let m: RegExpExecArray | null;
    if ((m = /space\s*=\s*"?([^"\s]+)"?/i.exec(q))) f.spaces = [m[1]];
    if ((m = /space\s+in\s*\(([^)]*)\)/i.exec(q))) f.spaces = parseList(m[1]);
    if ((m = /type\s*=\s*"?(\w+)"?/i.exec(q))) f.type = m[1];
    if ((m = /ancestor\s*=\s*"?(\d+)"?/i.exec(q))) f.ancestor = m[1];
    if ((m = /label\s+in\s*\(([^)]*)\)/i.exec(q))) f.labels = parseList(m[1]);
    else if ((m = /label\s*=\s*"?([^"\s]+)"?/i.exec(q))) f.labels = [m[1]];
    if ((m = /lastmodified\s*>=?\s*"(\d{4})[/-](\d{2})[/-](\d{2})(?:\s+(\d{2}):(\d{2}))?"/i.exec(q))) {
      f.modifiedSince = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:00${TZ_OFFSET}`);
    }
    return f;
  }

  function matches(p: MockPage, f: CqlFilter): boolean {
    if (f.spaces && !f.spaces.includes(data.spaceKey)) return false;
    if (f.type && f.type !== 'page') return false;
    if (f.ancestor && !p.ancestors.includes(f.ancestor)) return false;
    if (f.labels && !f.labels.some((l) => p.labels.includes(l))) return false;
    if (f.modifiedSince && p.lastModified < f.modifiedSince) return false;
    return true;
  }

  // ───── Biểu diễn JSON giống Confluence ─────
  function toJson(p: MockPage, expand: string[], cloud: boolean) {
    const has = (k: string) => expand.some((e) => e === k || e.startsWith(k + '.'));
    const out: any = {
      id: p.id,
      type: 'page',
      status: 'current',
      title: p.title,
      _links: {
        webui: cloud ? `/spaces/${data.spaceKey}/pages/${p.id}/${slug(p.title)}` : `/pages/viewpage.action?pageId=${p.id}`,
        self: `${BASE}${cloud ? '/wiki' : ''}/rest/api/content/${p.id}`,
      },
    };
    if (has('space')) out.space = { key: data.spaceKey, name: data.spaceName, type: 'global' };
    if (has('version')) out.version = { number: p.version, when: p.lastModified.toISOString(), by: { type: 'known', displayName: p.author } };
    if (has('ancestors')) out.ancestors = p.ancestors.map((id) => ({ id, type: 'page', title: data.pages.get(id)?.title ?? '' }));
    if (has('metadata.labels')) out.metadata = { labels: { results: p.labels.map((name) => ({ prefix: 'global', name })), size: p.labels.length } };
    if (has('body.storage')) out.body = { storage: { value: p.storage, representation: 'storage' } };
    return out;
  }

  function api(cloud: boolean): Router {
    const r = Router();
    const base = cloud ? `${BASE}/wiki` : BASE;

    r.get('/content/search', (req: Request, res: Response) => {
      const cql = String(req.query.cql ?? '');
      if (!cql) return res.status(400).json({ statusCode: 400, message: 'cql is required' });
      const expand = String(req.query.expand ?? '')
        .split(',')
        .filter(Boolean);
      const maxLimit = expand.some((e) => e.startsWith('body')) ? 50 : 200;
      const limit = Math.min(Number(req.query.limit) || 25, maxLimit);
      const start = Number(req.query.start) || 0;
      const f = parseCql(cql);
      const all = [...data.pages.values()]
        .filter((p) => matches(p, f))
        .sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime() || Number(a.id) - Number(b.id));
      const slice = all.slice(start, start + limit);
      const links: any = { base, context: cloud ? '/wiki' : '' };
      if (start + limit < all.length) {
        const qs = new URLSearchParams({ cql, limit: String(limit), start: String(start + limit) });
        if (expand.length) qs.set('expand', expand.join(','));
        links.next = `/rest/api/content/search?${qs}`;
      }
      res.json({ results: slice.map((p) => toJson(p, expand, cloud)), start, limit, size: slice.length, totalSize: all.length, _links: links });
    });

    r.get('/content/:id', (req, res) => {
      const p = data.pages.get(req.params.id);
      if (!p) return res.status(404).json({ statusCode: 404, message: 'No content found with id: ' + req.params.id });
      res.json(toJson(p, String(req.query.expand ?? '').split(','), cloud));
    });
    return r;
  }

  // ───── Trang xem nội dung (link từ kết quả chat mở được) ─────
  const CSS = `body{font-family:Segoe UI,Arial,sans-serif;max-width:900px;margin:32px auto;padding:0 24px;color:#172b4d;line-height:1.6}
  a{color:#0052cc}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #dfe1e6;padding:6px 12px;text-align:left}th{background:#f4f5f7}
  .crumb{color:#6b778c;font-size:13px}.meta{color:#6b778c;font-size:12px;margin-bottom:24px}.top{background:#0747a6;color:#fff;margin:-32px -24px 24px;padding:10px 24px;font-weight:600}
  code{background:#f4f5f7;padding:2px 4px}`;

  function renderStorage(s: string): string {
    return s
      .replace(/<ac:structured-macro ac:name="(note|info|warning|tip)"[^>]*>(?:<ac:parameter ac:name="title">([^<]*)<\/ac:parameter>)?<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body><\/ac:structured-macro>/g,
        (_m, _k, title, body) => `<div style="background:#fffae6;border-left:4px solid #ffab00;padding:8px 16px;margin:12px 0">${title ? `<b>${title}</b>` : ''}${body}</div>`)
      .replace(/<ac:structured-macro ac:name="(toc|children)"[\s\S]*?(<\/ac:structured-macro>|\/>)/g, '')
      .replace(/<\/?ac:[^>]*>/g, '');
  }

  function viewPage(p: MockPage | undefined, res: Response) {
    if (!p) return res.status(404).send('Không tìm thấy trang');
    const crumb = p.ancestors.map((id) => `<a href="/pages/viewpage.action?pageId=${id}">${esc(data.pages.get(id)?.title ?? id)}</a>`).join(' / ');
    const children = [...data.pages.values()].filter((c) => c.parentId === p.id);
    res.send(`<!doctype html><meta charset="utf-8"><title>${esc(p.title)}</title><style>${CSS}</style>
  <div class="top">Confluence (giả lập) · ${esc(data.spaceName)}</div>
  <div class="crumb">${crumb}</div><h1>${esc(p.title)}</h1>
  <div class="meta">Phiên bản ${p.version} · cập nhật ${p.lastModified.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} bởi ${esc(p.author)} · label: ${p.labels.map(esc).join(', ') || '—'}</div>
  ${renderStorage(p.storage)}
  ${children.length ? `<h3>Trang con (${children.length})</h3><ul>${children.slice(0, 500).map((c) => `<li><a href="/pages/viewpage.action?pageId=${c.id}">${esc(c.title)}</a></li>`).join('')}</ul>` : ''}`);
  }

  const app = express();
  app.use(express.json());
  app.use('/rest/api', api(false));
  app.use('/wiki/rest/api', api(true));
  app.get('/pages/viewpage.action', (req, res) => viewPage(data.pages.get(String(req.query.pageId)), res));
  app.get('/wiki/spaces/:space/pages/:id/:slug?', (req, res) => viewPage(data.pages.get(req.params.id), res));
  app.get('/', (_req, res) => viewPage(data.pages.get('100000'), res));

  // ───── API giả lập thay đổi nội dung (để kiểm thử đồng bộ thay đổi) ─────
  const touch = (p: MockPage) => {
    p.version += 1;
    p.lastModified = new Date();
  };

  app.get('/__mock/pages/:id', (req, res) => {
    const p = data.pages.get(req.params.id);
    return p ? res.json(p) : res.status(404).json({ message: 'not found' });
  });

  /** Sửa trang: { title?, appendWhen?: "tình huống mới" } → tăng version, cập nhật lastModified */
  app.post('/__mock/pages/:id', (req, res) => {
    const p = data.pages.get(req.params.id);
    if (!p) return res.status(404).json({ message: 'not found' });
    if (req.body?.title) p.title = String(req.body.title);
    if (req.body?.appendWhen) {
      p.storage = p.storage.replace(/(<h2>Khi nào nên chọn<\/h2>[\s\S]*?<ul>)/, `$1<li>${esc(String(req.body.appendWhen))}</li>`);
    }
    touch(p);
    res.json({ id: p.id, title: p.title, version: p.version, lastModified: p.lastModified });
  });

  /** Tạo trang SP-NV mới: { title, when: string[], group?: "Thẻ" } */
  app.post('/__mock/pages', (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    if (!title) return res.status(400).json({ message: 'title is required' });
    const group = [...data.pages.values()].find((p) => p.title === `[Mục lục] ${req.body?.group ?? 'Thẻ'}`) ?? data.pages.get('100001')!;
    const id = String(Math.max(...[...data.pages.keys()].map(Number)) + 1);
    const when: string[] = Array.isArray(req.body?.when) ? req.body.when : [];
    data.pages.set(id, {
      id,
      title,
      parentId: group.id,
      ancestors: [...group.ancestors, group.id],
      labels: ['sp-nv'],
      version: 1,
      lastModified: new Date(),
      author: 'Người kiểm thử',
      storage: `<h2>Khi nào nên chọn</h2><ul>${when.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`,
    });
    res.status(201).json({ id, title });
  });

  app.delete('/__mock/pages/:id', (req, res) => {
    const ok = data.pages.delete(req.params.id);
    res.status(ok ? 204 : 404).end();
  });
  return app;
}

if (require.main === module) {
  const PORT = Number(process.env.MOCK_PORT) || 8090;
  const BASE = process.env.MOCK_BASE_URL || `http://localhost:${PORT}`;
  const data = generateMockData(process.env.MOCK_SPACE || 'SPNV', Number(process.env.MOCK_PAGES ?? 300));
  createMockConfluence(data, BASE).listen(PORT, () => {
    console.log(`Confluence giả lập: ${BASE} – space ${data.spaceKey}, ${data.pages.size} trang`);
    console.log(`  Data Center API: ${BASE}/rest/api · Cloud API: ${BASE}/wiki/rest/api`);
  });
}
