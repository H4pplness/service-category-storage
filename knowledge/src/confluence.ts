// Client REST Confluence – dùng chung cho Cloud (/wiki/rest/api) và Data Center (/rest/api).
// Hai loại chỉ khác URL gốc và cách xác thực; API tìm kiếm CQL + phân trang qua _links.next giống nhau.
import { AppConfig, SpaceConfig } from './config';

export interface ConfluencePage {
  id: string;
  type: string;
  status: string;
  title: string;
  space?: { key: string; name?: string };
  version?: { number: number; when?: string; by?: { displayName?: string; publicName?: string; username?: string } };
  ancestors?: { id: string; title: string }[];
  metadata?: { labels?: { results?: { name: string }[] } };
  body?: { storage?: { value: string } };
  _links?: { webui?: string; tinyui?: string };
}

interface SearchResponse {
  results: ConfluencePage[];
  size?: number;
  _links?: { base?: string; context?: string; next?: string };
}

export const FULL_EXPAND = 'body.storage,version,ancestors,metadata.labels,space';

export class ConfluenceError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bọc chuỗi trong CQL: "abc \"x\"" */
export const cqlQuote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Định dạng thời điểm theo CQL ("yyyy/MM/dd HH:mm") ở múi giờ cấu hình */
export function cqlDate(d: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

/** CQL lấy các trang thuộc phạm vi quét của một space */
export function buildSpaceCql(space: SpaceConfig, modifiedSince?: string): string {
  const parts = [`space = ${cqlQuote(space.key)}`, 'type = page'];
  if (space.rootPageId) parts.push(`ancestor = ${space.rootPageId}`);
  if (space.labels.length) parts.push(`label in (${space.labels.map(cqlQuote).join(', ')})`);
  if (modifiedSince) parts.push(`lastmodified >= ${cqlQuote(modifiedSince)}`);
  return parts.join(' and ') + ' order by lastmodified asc';
}

export class ConfluenceClient {
  constructor(private cfg: AppConfig['confluence']) {
    if (!cfg.baseUrl) throw new ConfluenceError('Chưa cấu hình confluence.base-url');
  }

  get apiBase(): string {
    return `${this.cfg.baseUrl}/rest/api`;
  }

  private authHeader(): string | undefined {
    const { type, username, token } = this.cfg;
    if (!token) return undefined;
    if (type === 'cloud' || username) return 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64');
    return `Bearer ${token}`;
  }

  async getJson<T>(url: string): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const auth = this.authHeader();
    if (auth) headers.Authorization = auth;
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(this.cfg.timeoutMs) });
        if (res.ok) return (await res.json()) as T;
        const retryable = res.status === 429 || res.status >= 500;
        const body = (await res.text()).slice(0, 300);
        if (!retryable || attempt > this.cfg.maxRetries) {
          const hint = res.status === 401 || res.status === 403 ? ' – kiểm tra confluence.username/token' : '';
          throw new ConfluenceError(`Confluence trả về ${res.status}${hint}: ${body}`, res.status);
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      } catch (e) {
        if (e instanceof ConfluenceError || attempt > this.cfg.maxRetries) {
          throw e instanceof ConfluenceError ? e : new ConfluenceError(`Không kết nối được Confluence (${url.split('?')[0]}): ${(e as Error).message}`);
        }
        await sleep(1000 * 2 ** attempt);
      }
    }
  }

  /** Duyệt toàn bộ kết quả CQL theo từng trang kết quả (đi theo _links.next) */
  async *search(cql: string, expand?: string, limit = this.cfg.pageSize): AsyncGenerator<ConfluencePage[]> {
    const params = new URLSearchParams({ cql, limit: String(limit) });
    if (expand) params.set('expand', expand);
    let url: string | undefined = `${this.apiBase}/content/search?${params}`;
    while (url) {
      const res: SearchResponse = await this.getJson<SearchResponse>(url);
      yield res.results ?? [];
      const next = res._links?.next;
      url = next ? (/^https?:\/\//.test(next) ? next : `${this.cfg.baseUrl}${next}`) : undefined;
    }
  }

  async getPage(id: string): Promise<ConfluencePage> {
    return this.getJson<ConfluencePage>(`${this.apiBase}/content/${encodeURIComponent(id)}?expand=${FULL_EXPAND}`);
  }

  webUrl(page: ConfluencePage): string {
    const webui = page._links?.webui;
    return webui ? `${this.cfg.baseUrl}${webui}` : `${this.cfg.baseUrl}/pages/viewpage.action?pageId=${page.id}`;
  }
}
