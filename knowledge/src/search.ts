// Tìm kiếm SP-NV: FTS5 (bm25, trọng số tiêu đề > breadcrumb/label/thuộc tính > nội dung).
//  - Truy vấn có dấu → so khớp trên các cột có dấu (phân biệt "mất"/"mật", "nợ"/"no").
//  - Truy vấn không dấu → so khớp trên các cột đã bỏ dấu.
// Sau đó xếp hạng lại theo độ phủ từ hiếm + đa dạng hoá, và chọn đoạn trích phù hợp (ưu tiên mục "Khi nào nên chọn").
import { AppConfig } from './config';
import { KnowledgeStore } from './db';
import { hasDiacritics, lowerVi, normalize, Section, tokenize, tokenizeVi, truncate } from './text';

// Từ chức năng phổ biến trong câu hỏi tiếng Việt. Không đưa "thẻ", "tín"... vào đây.
const STOPWORDS_VI = new Set(
  'là của và cho khi nào thì có được để nên chọn tôi mình muốn cần gì những các một với về trong này đó hay hoặc bị sẽ đã đang thuộc như nhé à ơi vậy rồi ra vào làm sao nghiệp vụ sản phẩm ạ giúp hỏi'.split(' '),
);
const STOPWORDS_ASCII = new Set([...STOPWORDS_VI].map(normalize).filter((w) => !['the', 'tin', 'mat', 'no'].includes(w)));

export interface SearchHit {
  id: string;
  title: string;
  spaceKey: string;
  url: string;
  path: string[];
  labels: string[];
  properties: Record<string, string>;
  lastModified: string | null;
  score: number;
  guidance: string | null; // trích mục "khi nào nên chọn"
  excerpt: string | null; // đoạn khớp truy vấn nhất (nếu khác mục guidance)
  excerptHeading: string | null;
}

/** Cách so khớp của một truy vấn: có dấu hay không dấu */
export interface QueryPlan {
  accented: boolean;
  tokens: string[]; // toàn bộ từ (để tạo cụm 2 từ)
  terms: string[]; // từ có nghĩa (đã bỏ từ chức năng)
  fold: (s: string) => string; // chuẩn hoá văn bản để so với terms
}

export function planQuery(query: string): QueryPlan {
  const accented = hasDiacritics(query);
  const tokens = accented ? tokenizeVi(query) : tokenize(query);
  const stop = accented ? STOPWORDS_VI : STOPWORDS_ASCII;
  const terms = tokens.filter((t) => !stop.has(t));
  return { accented, tokens, terms: terms.length ? terms : tokens, fold: accented ? lowerVi : normalize };
}

const quote = (t: string) => `"${t.replace(/"/g, '')}"`;
const COLS = ['title', 'path', 'labels', 'props', 'body'];

/** Biểu thức FTS5: các cụm 2 từ liền kề (tăng điểm khi khớp đúng cụm) + từng từ, nối bằng OR, giới hạn theo nhóm cột */
export function buildMatchQuery(query: string, plan = planQuery(query)): string | null {
  if (!plan.terms.length) return null;
  const stop = new Set(plan.tokens.filter((t) => !plan.terms.includes(t)));
  const phrases: string[] = [];
  for (let i = 0; i + 1 < plan.tokens.length; i++) {
    if (stop.has(plan.tokens[i]) && stop.has(plan.tokens[i + 1])) continue;
    phrases.push(quote(`${plan.tokens[i]} ${plan.tokens[i + 1]}`));
  }
  const expr = [...new Set([...phrases, ...plan.terms.map(quote)])].slice(0, 40).join(' OR ');
  const cols = plan.accented ? COLS.map((c) => 'v' + c) : COLS;
  return `{${cols.join(' ')}} : (${expr})`;
}

function sectionScore(s: Section, plan: QueryPlan): number {
  const words = new Set(plan.fold(`${s.heading} ${s.text}`).match(/[\p{L}\p{N}]+/gu) ?? []);
  return plan.terms.reduce((n, t) => n + (words.has(t) ? 1 : 0), 0);
}

function sectionText(s: Section): string {
  return s.text.replace(/\n{2,}/g, '\n').trim();
}

export class SearchService {
  constructor(
    private store: KnowledgeStore,
    private cfg: AppConfig,
  ) {}

  private guidanceSection(sections: Section[]): Section | undefined {
    const keys = this.cfg.content.guidanceHeadings.map(normalize);
    return sections.find((s) => keys.some((k) => normalize(s.heading).includes(k)));
  }

  /** IDF của từng từ theo số trang chứa từ đó (bảng fts5vocab) */
  private idf(terms: string[]): Map<string, number> {
    const n = Number((this.store.db.prepare('select count(*) n from pages').get() as any).n) || 1;
    const out = new Map<string, number>();
    const stmt = this.store.db.prepare('select doc from page_fts_vocab where term = ?');
    for (const t of new Set(terms)) {
      const df = Number((stmt.get(t) as any)?.doc ?? 0);
      out.set(t, Math.log((n - df + 0.5) / (df + 0.5) + 1));
    }
    return out;
  }

  /**
   * Xếp hạng lại ứng viên FTS:
   *  - 60% điểm bm25 (chuẩn hoá theo ứng viên tốt nhất) – phản ánh mức khớp nội dung, cụm từ;
   *  - 40% độ phủ thông tin: tổng IDF các từ truy vấn có mặt × trọng số trường chứa từ
   *    (tiêu đề > thuộc tính > breadcrumb/label > nội dung) – để từ hiếm, đặc trưng (vd "visa") trong tiêu đề được ưu tiên.
   * Sau đó đa dạng hoá (MMR) để các trang gần trùng tiêu đề (biến thể hạng/gói) không chiếm hết kết quả.
   */
  private rerank(candidates: any[], plan: QueryPlan, limit: number): any[] {
    const terms = plan.terms;
    if (!candidates.length || !terms.length) return candidates.slice(0, limit);
    const idf = this.idf(terms);
    const v = plan.accented ? 'v' : '';
    const ids = candidates.map((c) => Number(c.id));
    const docs = new Map<number, any>(
      (this.store.db.prepare(`select rowid, ${v}title title, ${v}path path, ${v}labels labels, ${v}props props, ${v}body body from page_fts where rowid in (${ids.map(() => '?').join(',')})`).all(...ids) as any[]).map(
        (d) => [Number(d.rowid), d],
      ),
    );
    const words = (s: string) => new Set(s.match(/[\p{L}\p{N}]+/gu) ?? []);
    const uniqTerms = [...new Set(terms)];
    const totalIdf = uniqTerms.reduce((n, t) => n + (idf.get(t) ?? 0), 0) || 1;
    const bestBm25 = -candidates[0].rank || 1;
    const scored = candidates.map((c) => {
      const d = docs.get(Number(c.id));
      const fields: [Set<string>, number][] = d
        ? [
            [words(d.title), 1.0],
            [words(d.props), 0.8],
            [words(`${d.path} ${d.labels}`), 0.6],
            [words(d.body), 0.35],
          ]
        : [];
      let coverage = 0;
      for (const t of uniqTerms) coverage += (idf.get(t) ?? 0) * (fields.find(([set]) => set.has(t))?.[1] ?? 0);
      const score = 0.6 * (-c.rank / bestBm25) + 0.4 * (coverage / totalIdf);
      return { c, score, titleWords: d ? words(d.title) : new Set<string>() };
    });

    const jaccard = (a: Set<string>, b: Set<string>) => {
      let inter = 0;
      for (const x of a) if (b.has(x)) inter++;
      return inter / (a.size + b.size - inter || 1);
    };
    const picked: typeof scored = [];
    const pool = scored.sort((a, b) => b.score - a.score);
    while (picked.length < limit && pool.length) {
      let best = 0;
      let bestVal = -Infinity;
      pool.forEach((s, i) => {
        const sim = picked.length ? Math.max(...picked.map((p) => jaccard(p.titleWords, s.titleWords))) : 0;
        const val = s.score - 0.25 * sim;
        if (val > bestVal) [best, bestVal] = [i, val];
      });
      picked.push(pool.splice(best, 1)[0]);
    }
    return picked.map((p) => ({ ...p.c, rerankScore: p.score }));
  }

  search(query: string, opts: { limit?: number; space?: string } = {}): SearchHit[] {
    const limit = Math.max(1, Math.min(opts.limit ?? this.cfg.search.defaultLimit, this.cfg.search.maxLimit));
    const plan = planQuery(query);
    const match = buildMatchQuery(query, plan);
    if (!match) return [];
    const params: (string | number)[] = [match];
    let where = 'page_fts match ?';
    if (opts.space) {
      where += ' and p.space_key = ?';
      params.push(opts.space);
    }
    params.push(Math.max(limit * 8, 80));
    const w = '10.0, 3.0, 3.0, 3.0, 1.0';
    const weights = plan.accented ? `0, 0, 0, 0, 0, ${w}` : `${w}, 0, 0, 0, 0, 0`;
    const candidates = this.store.db
      .prepare(
        `select p.id, p.title, p.space_key, p.url, p.path, p.labels, p.properties, p.last_modified,
                bm25(page_fts, ${weights}) as rank
         from page_fts join pages p on p.id = cast(page_fts.rowid as text)
         where ${where}
         order by rank limit ?`,
      )
      .all(...params) as any[];

    const rows = this.rerank(candidates, plan, limit);
    return rows.map((r) => {
      const sections = this.store.getSections(r.id);
      const guidance = this.guidanceSection(sections);
      const best = sections
        .filter((s) => s !== guidance)
        .map((s) => ({ s, score: sectionScore(s, plan) }))
        .sort((a, b) => b.score - a.score)[0];
      const showExcerpt = best && best.score > 0 && (!guidance || best.score > sectionScore(guidance, plan));
      return {
        id: r.id,
        title: r.title,
        spaceKey: r.space_key,
        url: r.url,
        path: JSON.parse(r.path),
        labels: JSON.parse(r.labels),
        properties: JSON.parse(r.properties),
        lastModified: r.last_modified,
        score: Math.round((r.rerankScore ?? 0) * 1000) / 1000,
        guidance: guidance ? truncate(sectionText(guidance), 700) : sections[0] ? truncate(sectionText(sections[0]), 400) : null,
        excerpt: showExcerpt ? truncate(sectionText(best.s), 400) : null,
        excerptHeading: showExcerpt ? best.s.heading : null,
      };
    });
  }
}

// ───── Định dạng kết quả cho LLM (markdown) ─────

export function formatHits(query: string, hits: SearchHit[]): string {
  if (!hits.length) {
    return `Không tìm thấy sản phẩm - nghiệp vụ nào khớp với "${query}". Hãy thử từ khoá khác (tên sản phẩm, tên nghiệp vụ, triệu chứng/nhu cầu của khách hàng) hoặc ít từ hơn.`;
  }
  const lines = [`Tìm thấy ${hits.length} ứng viên cho "${query}" (xếp theo mức độ phù hợp):`, ''];
  hits.forEach((h, i) => {
    lines.push(`## ${i + 1}. ${h.title}`);
    lines.push(`- page_id: ${h.id} · space: ${h.spaceKey}${h.path.length ? ` · thuộc: ${h.path.join(' › ')}` : ''}`);
    const props = Object.entries(h.properties).slice(0, 6);
    if (props.length) lines.push(`- Thuộc tính: ${props.map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
    lines.push(`- Link: ${h.url}`);
    if (h.guidance) lines.push('', '**Khi nào nên chọn:**', h.guidance);
    if (h.excerpt) lines.push('', `**Đoạn liên quan (${h.excerptHeading || 'nội dung'}):**`, h.excerpt);
    lines.push('');
  });
  lines.push('Dùng get_product_guidance(page_id) để đọc toàn văn trang trước khi kết luận nếu các ứng viên gần giống nhau.');
  return lines.join('\n');
}
