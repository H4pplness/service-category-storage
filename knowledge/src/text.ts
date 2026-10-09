// Xử lý văn bản: chuẩn hoá tiếng Việt cho tìm kiếm, chuyển Confluence storage format → Markdown, tách mục.
import { HTMLElement, Node, NodeType, parse } from 'node-html-parser';

/** Bỏ dấu + chữ thường: "Thẻ tín dụng Đen" → "the tin dung den" (dùng cho cả index lẫn câu truy vấn) */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Chữ thường, giữ dấu (dạng NFC) */
export function lowerVi(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

/** Chuỗi có chứa ký tự tiếng Việt có dấu hay không */
export function hasDiacritics(s: string): boolean {
  return /\p{M}|đ/iu.test(s.normalize('NFD'));
}

/** Tách từ giữ dấu (chữ thường) */
export function tokenizeVi(s: string): string[] {
  return lowerVi(s).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Tách từ đã chuẩn hoá (chữ cái/số) */
export function tokenize(s: string): string[] {
  return normalize(s).match(/[\p{L}\p{N}]+/gu) ?? [];
}

// ───── Confluence storage format → Markdown ─────

const SKIP_MACROS = new Set(['toc', 'children', 'pagetree', 'anchor', 'recently-updated', 'contentbylabel', 'jira', 'attachments', 'gallery']);
const PANEL_MACROS = new Set(['info', 'note', 'warning', 'tip', 'panel', 'expand']);

function attr(el: HTMLElement, name: string): string {
  return el.getAttribute(name) ?? '';
}

function macroParam(el: HTMLElement, name: string): string {
  const p = el.childNodes.find(
    (c) => c instanceof HTMLElement && c.rawTagName?.toLowerCase() === 'ac:parameter' && attr(c, 'ac:name') === name,
  );
  return p ? p.text.trim() : '';
}

function childByTag(el: HTMLElement, tag: string): HTMLElement | undefined {
  return el.childNodes.find((c) => c instanceof HTMLElement && c.rawTagName?.toLowerCase() === tag) as HTMLElement | undefined;
}

const collapse = (s: string) => s.replace(/[ \t\r\n ]+/g, ' ');

class MarkdownWriter {
  inline(nodes: Node[]): string {
    return nodes.map((n) => this.inlineNode(n)).join('');
  }

  private inlineNode(n: Node): string {
    if (n.nodeType === NodeType.TEXT_NODE) return collapse(n.text);
    if (!(n instanceof HTMLElement)) return '';
    const tag = n.rawTagName?.toLowerCase() ?? '';
    const inner = () => this.inline(n.childNodes);
    switch (tag) {
      case 'br':
        return '\n';
      case 'strong':
      case 'b': {
        const t = inner().trim();
        return t ? `**${t}**` : '';
      }
      case 'em':
      case 'i': {
        const t = inner().trim();
        return t ? `*${t}*` : '';
      }
      case 'code':
        return '`' + n.text + '`';
      case 'a': {
        const t = inner().trim();
        const href = attr(n, 'href');
        return href && t && !href.startsWith('#') ? `[${t}](${href})` : t;
      }
      case 'ac:link': {
        const body = childByTag(n, 'ac:link-body') ?? childByTag(n, 'ac:plain-text-link-body');
        if (body) return body.text.trim();
        const page = childByTag(n, 'ri:page');
        return page ? attr(page, 'ri:content-title') : '';
      }
      case 'time':
        return attr(n, 'datetime');
      case 'ac:parameter':
      case 'ac:image':
      case 'ac:emoticon':
      case 'ri:attachment':
      case 'ri:page':
      case 'ri:user':
        return '';
      default:
        return inner();
    }
  }

  blocks(nodes: Node[], ctx: { listDepth: number } = { listDepth: 0 }): string {
    let out = '';
    let inlineBuf: Node[] = [];
    const flush = () => {
      const t = this.inline(inlineBuf).trim();
      if (t) out += t + '\n\n';
      inlineBuf = [];
    };
    for (const n of nodes) {
      if (!(n instanceof HTMLElement) || !this.isBlock(n)) {
        inlineBuf.push(n);
        continue;
      }
      flush();
      out += this.block(n, ctx);
    }
    flush();
    return out;
  }

  private isBlock(el: HTMLElement): boolean {
    const tag = el.rawTagName?.toLowerCase() ?? '';
    return (
      /^h[1-6]$/.test(tag) ||
      ['p', 'div', 'ul', 'ol', 'table', 'pre', 'blockquote', 'hr', 'section', 'ac:layout', 'ac:layout-section', 'ac:layout-cell'].includes(tag) ||
      ['ac:structured-macro', 'ac:task-list', 'ac:rich-text-body'].includes(tag)
    );
  }

  private block(el: HTMLElement, ctx: { listDepth: number }): string {
    const tag = el.rawTagName?.toLowerCase() ?? '';
    const h = /^h([1-6])$/.exec(tag);
    if (h) {
      const t = this.inline(el.childNodes).trim();
      return t ? `${'#'.repeat(Number(h[1]))} ${t}\n\n` : '';
    }
    switch (tag) {
      case 'p': {
        const t = this.inline(el.childNodes).trim();
        return t ? t + '\n\n' : '';
      }
      case 'hr':
        return '---\n\n';
      case 'pre':
        return '```\n' + el.text.trim() + '\n```\n\n';
      case 'blockquote':
        return this.quote(this.blocks(el.childNodes, ctx));
      case 'ul':
      case 'ol':
        return this.list(el, tag === 'ol', ctx.listDepth) + (ctx.listDepth === 0 ? '\n' : '');
      case 'ac:task-list':
        return (
          el.childNodes
            .filter((c): c is HTMLElement => c instanceof HTMLElement && c.rawTagName?.toLowerCase() === 'ac:task')
            .map((t) => {
              const done = childByTag(t, 'ac:task-status')?.text.trim() === 'complete';
              const body = childByTag(t, 'ac:task-body');
              return `- [${done ? 'x' : ' '}] ${body ? this.inline(body.childNodes).trim() : ''}`;
            })
            .join('\n') + '\n\n'
        );
      case 'table':
        return this.table(el);
      case 'ac:structured-macro':
        return this.macro(el, ctx);
      default:
        return this.blocks(el.childNodes, ctx);
    }
  }

  private quote(md: string): string {
    const t = md.trim();
    return t
      ? t
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n') + '\n\n'
      : '';
  }

  private list(el: HTMLElement, ordered: boolean, depth: number): string {
    const indent = '  '.repeat(depth);
    let i = 0;
    let out = '';
    for (const li of el.childNodes) {
      if (!(li instanceof HTMLElement) || li.rawTagName?.toLowerCase() !== 'li') continue;
      i++;
      const inlineNodes: Node[] = [];
      let nested = '';
      for (const c of li.childNodes) {
        const t = c instanceof HTMLElement ? c.rawTagName?.toLowerCase() : '';
        if (t === 'ul' || t === 'ol') nested += this.list(c as HTMLElement, t === 'ol', depth + 1);
        else if (t === 'p') inlineNodes.push(...(c as HTMLElement).childNodes, { nodeType: NodeType.TEXT_NODE, text: ' ' } as Node);
        else inlineNodes.push(c);
      }
      out += `${indent}${ordered ? `${i}.` : '-'} ${this.inline(inlineNodes).trim()}\n${nested}`;
    }
    return out;
  }

  private table(el: HTMLElement): string {
    const rows = el
      .querySelectorAll('tr')
      .map((tr) =>
        tr.childNodes
          .filter((c): c is HTMLElement => c instanceof HTMLElement && ['td', 'th'].includes(c.rawTagName?.toLowerCase() ?? ''))
          .map((c) => this.cellText(c)),
      )
      .filter((r) => r.length);
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
    const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
    return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n') + '\n\n';
  }

  private cellText(c: HTMLElement): string {
    return this.blocks(c.childNodes)
      .trim()
      .replace(/\n+/g, '<br>')
      .replace(/\|/g, '\\|');
  }

  private macro(el: HTMLElement, ctx: { listDepth: number }): string {
    const name = attr(el, 'ac:name').toLowerCase();
    if (SKIP_MACROS.has(name)) return '';
    if (name === 'code' || name === 'noformat') {
      const body = childByTag(el, 'ac:plain-text-body');
      return body ? '```' + (macroParam(el, 'language') || '') + '\n' + body.text.trim() + '\n```\n\n' : '';
    }
    const rich = childByTag(el, 'ac:rich-text-body');
    const plain = childByTag(el, 'ac:plain-text-body');
    const body = rich ? this.blocks(rich.childNodes, ctx) : plain ? plain.text.trim() + '\n\n' : '';
    if (PANEL_MACROS.has(name)) {
      const title = macroParam(el, 'title');
      return this.quote((title ? `**${title}**\n\n` : '') + body);
    }
    return body;
  }
}

/** Bỏ CDATA của Confluence để parser đọc được nội dung */
function prepareStorage(html: string): string {
  return html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}

export function parseStorage(html: string): HTMLElement {
  return parse(prepareStorage(html || ''), { comment: false, blockTextElements: { script: false, style: false } });
}

export function storageToMarkdown(html: string): string {
  const md = new MarkdownWriter().blocks(parseStorage(html).childNodes);
  return md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lấy bảng thuộc tính trang (macro Page Properties "details", hoặc bảng 2 cột đầu tiên) */
export function extractProperties(html: string): Record<string, string> {
  const root = parseStorage(html);
  const writer = new MarkdownWriter();
  const details = root
    .querySelectorAll('*')
    .find((e) => e.rawTagName?.toLowerCase() === 'ac:structured-macro' && attr(e, 'ac:name').toLowerCase() === 'details');
  const tables = (details ?? root).querySelectorAll('table');
  const out: Record<string, string> = {};
  for (const table of tables) {
    for (const tr of table.querySelectorAll('tr')) {
      const cells = tr.childNodes.filter(
        (c): c is HTMLElement => c instanceof HTMLElement && ['td', 'th'].includes(c.rawTagName?.toLowerCase() ?? ''),
      );
      if (cells.length !== 2) continue;
      const key = writer.inline(cells[0].childNodes).trim().replace(/:$/, '');
      const value = writer.blocks(cells[1].childNodes).trim().replace(/\n+/g, '; ');
      if (key && value && Object.keys(out).length < 30) out[key] = value;
    }
    if (Object.keys(out).length) break;
  }
  return out;
}

export interface Section {
  heading: string;
  level: number;
  text: string;
}

/** Tách markdown theo tiêu đề (h1–h3). Phần trước tiêu đề đầu tiên có heading rỗng. */
export function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let cur: Section = { heading: '', level: 0, text: '' };
  let inCode = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    const m = !inCode && /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      if (cur.heading || cur.text.trim()) sections.push({ ...cur, text: cur.text.trim() });
      cur = { heading: m[2].trim(), level: m[1].length, text: '' };
    } else cur.text += line + '\n';
  }
  if (cur.heading || cur.text.trim()) sections.push({ ...cur, text: cur.text.trim() });
  return sections;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return (lastBreak > max * 0.6 ? cut.slice(0, lastBreak + 1) : cut).trimEnd() + ' …';
}
