// Engine đồng bộ Confluence → kho tri thức.
//  - Lần đầu (hoặc space mới cấu hình): quét toàn bộ space.
//  - Các lần sau: chỉ lấy trang có lastmodified >= mốc lần trước (lùi overlap phút), so version để bỏ qua trang không đổi.
//  - Đối soát (reconcile): lấy toàn bộ id để xoá trang đã bị xoá/di chuyển khỏi phạm vi quét.
import { AppConfig, SpaceConfig } from './config';
import { buildSpaceCql, ConfluenceClient, ConfluencePage, cqlDate, FULL_EXPAND } from './confluence';
import { KnowledgeStore, PageRecord } from './db';
import { extractProperties, splitSections, storageToMarkdown } from './text';

export type SyncMode = 'auto' | 'full' | 'reconcile';

export interface SyncStats {
  fetched: number;
  upserted: number;
  unchanged: number;
  deleted: number;
}

export interface SyncResult extends SyncStats {
  runId: number;
  mode: SyncMode;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  errors: string[];
  durationMs: number;
}

const log = (...args: unknown[]) => console.log(`[sync ${new Date().toISOString()}]`, ...args);

/** Bỏ tiền tố kiểu "[Mục lục] " khỏi tiêu đề trang cha khi hiển thị breadcrumb */
const cleanTitle = (title: string, prefixes: string[]) => {
  const p = prefixes.find((x) => title.startsWith(x));
  return p ? title.slice(p.length).trim() : title;
};

export function toPageRecord(page: ConfluencePage, client: ConfluenceClient, excludePrefixes: string[] = []): PageRecord {
  const html = page.body?.storage?.value ?? '';
  const markdown = storageToMarkdown(html);
  return {
    id: String(page.id),
    spaceKey: page.space?.key ?? '',
    title: page.title,
    url: client.webUrl(page),
    path: (page.ancestors ?? []).map((a) => cleanTitle(a.title, excludePrefixes)),
    labels: (page.metadata?.labels?.results ?? []).map((l) => l.name),
    properties: extractProperties(html),
    version: page.version?.number ?? 0,
    lastModified: page.version?.when ?? null,
    lastModifiedBy: page.version?.by?.displayName ?? page.version?.by?.publicName ?? page.version?.by?.username ?? null,
    markdown,
    sections: splitSections(markdown),
  };
}

export class SyncService {
  private current: Promise<SyncResult> | null = null;
  // id các trang luôn bỏ qua (trang chủ của space)
  private excludedIds = new Set<string>();

  constructor(
    private store: KnowledgeStore,
    private client: ConfluenceClient,
    private cfg: AppConfig,
  ) {}

  get running(): boolean {
    return this.current !== null;
  }

  /** Chạy đồng bộ; nếu đang có lần chạy khác thì trả về chính lần chạy đó (không chạy chồng) */
  run(mode: SyncMode = 'auto'): Promise<SyncResult> {
    if (this.current) return this.current;
    this.current = this.execute(mode).finally(() => (this.current = null));
    return this.current;
  }

  private isExcluded(title: string, id?: string): boolean {
    return (id !== undefined && this.excludedIds.has(String(id))) || this.cfg.confluence.excludeTitlePrefixes.some((p) => title.startsWith(p));
  }

  private async execute(mode: SyncMode): Promise<SyncResult> {
    const started = Date.now();
    const runId = this.store.startRun(mode);
    const stats: SyncStats = { fetched: 0, upserted: 0, unchanged: 0, deleted: 0 };
    const errors: string[] = [];
    log(`Bắt đầu đồng bộ (#${runId}, ${mode})`);

    // Space không còn trong cấu hình → xoá dữ liệu cũ
    const configured = new Set(this.cfg.confluence.spaces.map((s) => s.key));
    for (const key of this.store.spaceKeys()) {
      if (configured.has(key)) continue;
      const ids = this.store.pageIdsOfSpace(key);
      this.store.transaction(() => ids.forEach((id) => this.store.deletePage(id)));
      stats.deleted += ids.length;
      log(`Đã xoá ${ids.length} trang của space ${key} (không còn trong cấu hình)`);
    }

    for (const space of this.cfg.confluence.spaces) {
      try {
        await this.syncSpace(space, mode, stats);
      } catch (e) {
        const msg = `Space ${space.key}: ${(e as Error).message}`;
        errors.push(msg);
        log('LỖI', msg);
      }
    }

    const status = errors.length === 0 ? 'SUCCESS' : errors.length < this.cfg.confluence.spaces.length ? 'PARTIAL' : 'FAILED';
    this.store.finishRun(runId, status, stats, errors.join('\n') || undefined);
    const durationMs = Date.now() - started;
    log(
      `Kết thúc #${runId}: ${status} – lấy ${stats.fetched}, cập nhật ${stats.upserted}, không đổi ${stats.unchanged}, xoá ${stats.deleted} (${durationMs}ms)`,
    );
    return { runId, mode, status, errors, durationMs, ...stats };
  }

  private async syncSpace(space: SpaceConfig, mode: SyncMode, stats: SyncStats) {
    const state = this.store.getState(space.key);
    const startedAt = new Date();
    if (this.cfg.confluence.excludeSpaceHomepage) {
      const home = await this.client.getSpaceHomepageId(space.key);
      if (home) this.excludedIds.add(home);
    }
    const needFull = mode === 'full' || (mode === 'auto' && (!state.lastFullAt || !state.lastIncrementalAt));

    if (mode === 'reconcile') {
      await this.reconcile(space, stats);
      this.store.setState(space.key, { lastReconcileAt: startedAt.toISOString() });
      return;
    }

    if (needFull) {
      log(`Space ${space.key}: quét toàn bộ`);
      // mode 'full' ghi lại mọi trang (kể cả cùng version) – dùng khi đổi cách chuyển đổi/lập chỉ mục
      const seen = await this.fetchAndStore(buildSpaceCql(space), space, stats, mode === 'full');
      // Quét toàn bộ cũng là đối soát: trang không còn thấy → xoá
      const removed = this.store.pageIdsOfSpace(space.key).filter((id) => !seen.has(id));
      this.store.transaction(() => removed.forEach((id) => this.store.deletePage(id)));
      stats.deleted += removed.length;
      const iso = startedAt.toISOString();
      this.store.setState(space.key, { lastFullAt: iso, lastIncrementalAt: iso, lastReconcileAt: iso });
      return;
    }

    const since = new Date(new Date(state.lastIncrementalAt!).getTime() - this.cfg.sync.overlapMinutes * 60_000);
    const sinceCql = cqlDate(since, this.cfg.confluence.timezone);
    log(`Space ${space.key}: quét thay đổi từ ${sinceCql} (${this.cfg.confluence.timezone})`);
    await this.fetchAndStore(buildSpaceCql(space, sinceCql), space, stats);
    this.store.setState(space.key, { lastIncrementalAt: startedAt.toISOString() });
  }

  /** Lấy trang theo CQL (kèm nội dung), chỉ ghi trang có version mới. Trả về tập id đã thấy. */
  private async fetchAndStore(cql: string, space: SpaceConfig, stats: SyncStats, force = false): Promise<Set<string>> {
    const seen = new Set<string>();
    const versions = this.store.versions(space.key);
    for await (const batch of this.client.search(cql, FULL_EXPAND)) {
      const records: PageRecord[] = [];
      const toDelete: string[] = [];
      for (const page of batch) {
        stats.fetched++;
        const id = String(page.id);
        if (page.type !== 'page' || (page.status && page.status !== 'current')) continue;
        if (this.isExcluded(page.title, page.id)) {
          if (versions.has(id)) toDelete.push(id);
          continue;
        }
        seen.add(id);
        if (!force && versions.get(id) === page.version?.number) {
          stats.unchanged++;
          continue;
        }
        const rec = toPageRecord(page, this.client, this.cfg.confluence.excludeTitlePrefixes);
        rec.spaceKey ||= space.key;
        records.push(rec);
      }
      this.store.transaction(() => {
        records.forEach((r) => this.store.upsertPage(r));
        toDelete.forEach((id) => this.store.deletePage(id));
      });
      records.forEach((r) => versions.set(r.id, r.version));
      stats.upserted += records.length;
      stats.deleted += toDelete.length;
      if (records.length) log(`  ${space.key}: +${records.length} trang (đã lấy ${stats.fetched})`);
    }
    return seen;
  }

  /** Đối soát: chỉ lấy id (không lấy nội dung) để phát hiện trang bị xoá, bổ sung trang còn thiếu */
  private async reconcile(space: SpaceConfig, stats: SyncStats) {
    log(`Space ${space.key}: đối soát danh sách trang`);
    const remote = new Map<string, string>();
    for await (const batch of this.client.search(buildSpaceCql(space), undefined, 200)) {
      for (const p of batch) if (!this.isExcluded(p.title, p.id)) remote.set(String(p.id), p.title);
    }
    const local = this.store.versions(space.key);
    const removed = [...local.keys()].filter((id) => !remote.has(id));
    this.store.transaction(() => removed.forEach((id) => this.store.deletePage(id)));
    stats.deleted += removed.length;
    const missing = [...remote.keys()].filter((id) => !local.has(id));
    for (const id of missing) {
      const rec = toPageRecord(await this.client.getPage(id), this.client, this.cfg.confluence.excludeTitlePrefixes);
      rec.spaceKey ||= space.key;
      this.store.transaction(() => this.store.upsertPage(rec));
      stats.fetched++;
      stats.upserted++;
    }
    log(`  ${space.key}: xoá ${removed.length}, bổ sung ${missing.length}`);
  }
}
