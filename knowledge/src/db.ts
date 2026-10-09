// Kho lưu trữ: SQLite (node:sqlite) + chỉ mục toàn văn FTS5 trên văn bản đã bỏ dấu.
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { lowerVi, normalize, Section } from './text';

export interface PageRecord {
  id: string;
  spaceKey: string;
  title: string;
  url: string;
  path: string[]; // breadcrumb: các trang cha
  labels: string[];
  properties: Record<string, string>;
  version: number;
  lastModified: string | null;
  lastModifiedBy: string | null;
  markdown: string;
  sections: Section[];
}

export interface SyncRun {
  id: number;
  mode: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  fetched: number;
  upserted: number;
  unchanged: number;
  deleted: number;
  message: string | null;
}

export interface SpaceState {
  spaceKey: string;
  lastIncrementalAt: string | null;
  lastFullAt: string | null;
  lastReconcileAt: string | null;
}

const SCHEMA_VERSION = 2;

const SCHEMA = `
create table if not exists pages (
  id text primary key,
  space_key text not null,
  title text not null,
  url text,
  path text not null default '[]',
  labels text not null default '[]',
  properties text not null default '{}',
  version integer not null,
  last_modified text,
  last_modified_by text,
  markdown text not null,
  synced_at text not null
);
create index if not exists idx_pages_space on pages(space_key);
create table if not exists sections (
  page_id text not null,
  ord integer not null,
  heading text not null,
  level integer not null,
  text text not null,
  primary key (page_id, ord)
);
-- 5 cột không dấu (tìm khi người dùng gõ không dấu) + 5 cột có dấu (so khớp chính xác: "mất" ≠ "mật", "nợ" ≠ "no")
create virtual table if not exists page_fts using fts5(
  title, path, labels, props, body,
  vtitle, vpath, vlabels, vprops, vbody,
  tokenize = 'unicode61 remove_diacritics 0'
);
create virtual table if not exists page_fts_vocab using fts5vocab(page_fts, 'row');
create table if not exists sync_state (
  space_key text primary key,
  last_incremental_at text,
  last_full_at text,
  last_reconcile_at text
);
create table if not exists sync_runs (
  id integer primary key autoincrement,
  mode text not null,
  started_at text not null,
  finished_at text,
  status text not null,
  fetched integer not null default 0,
  upserted integer not null default 0,
  unchanged integer not null default 0,
  deleted integer not null default 0,
  message text
);
`;

export class KnowledgeStore {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on;');
    this.migrate();
    this.db.exec(SCHEMA);
  }

  /** Kho là bản sao của Confluence: khi đổi cấu trúc chỉ mục thì xoá và đồng bộ lại toàn bộ */
  private migrate() {
    const version = Number((this.db.prepare('pragma user_version').get() as any).user_version);
    if (version === SCHEMA_VERSION) return;
    if (version !== 0) console.log(`[store] Cấu trúc kho thay đổi (v${version} → v${SCHEMA_VERSION}): xoá chỉ mục cũ, sẽ đồng bộ lại toàn bộ`);
    this.db.exec(
      'drop table if exists page_fts_vocab; drop table if exists page_fts; drop table if exists sections; drop table if exists pages; drop table if exists sync_state;',
    );
    this.db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
  }

  close() {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('begin');
    try {
      const r = fn();
      this.db.exec('commit');
      return r;
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }

  // ───── Trang ─────

  /** id Confluence luôn là số → dùng làm rowid của bảng FTS */
  private rowid(id: string): number {
    const n = Number(id);
    if (!Number.isSafeInteger(n)) throw new Error(`Page id không hợp lệ: ${id}`);
    return n;
  }

  upsertPage(p: PageRecord) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `insert into pages (id, space_key, title, url, path, labels, properties, version, last_modified, last_modified_by, markdown, synced_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set space_key = excluded.space_key, title = excluded.title, url = excluded.url, path = excluded.path,
           labels = excluded.labels, properties = excluded.properties, version = excluded.version, last_modified = excluded.last_modified,
           last_modified_by = excluded.last_modified_by, markdown = excluded.markdown, synced_at = excluded.synced_at`,
      )
      .run(
        p.id,
        p.spaceKey,
        p.title,
        p.url,
        JSON.stringify(p.path),
        JSON.stringify(p.labels),
        JSON.stringify(p.properties),
        p.version,
        p.lastModified,
        p.lastModifiedBy,
        p.markdown,
        now,
      );
    this.db.prepare('delete from sections where page_id = ?').run(p.id);
    const ins = this.db.prepare('insert into sections (page_id, ord, heading, level, text) values (?, ?, ?, ?, ?)');
    p.sections.forEach((s, i) => ins.run(p.id, i, s.heading, s.level, s.text));
    const rowid = this.rowid(p.id);
    const fields = [
      p.title,
      p.path.join(' '),
      p.labels.join(' ').replace(/[-_]/g, ' '),
      Object.entries(p.properties)
        .map(([k, v]) => `${k} ${v}`)
        .join(' '),
      p.markdown,
    ];
    this.db.prepare('delete from page_fts where rowid = ?').run(rowid);
    this.db
      .prepare(
        'insert into page_fts (rowid, title, path, labels, props, body, vtitle, vpath, vlabels, vprops, vbody) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(rowid, ...fields.map(normalize), ...fields.map(lowerVi));
  }

  deletePage(id: string) {
    this.db.prepare('delete from sections where page_id = ?').run(id);
    this.db.prepare('delete from page_fts where rowid = ?').run(this.rowid(id));
    this.db.prepare('delete from pages where id = ?').run(id);
  }

  getPage(id: string): PageRecord | null {
    const r = this.db.prepare('select * from pages where id = ?').get(id) as any;
    if (!r) return null;
    const sections = this.db.prepare('select heading, level, text from sections where page_id = ? order by ord').all(id) as any[];
    return {
      id: r.id,
      spaceKey: r.space_key,
      title: r.title,
      url: r.url,
      path: JSON.parse(r.path),
      labels: JSON.parse(r.labels),
      properties: JSON.parse(r.properties),
      version: r.version,
      lastModified: r.last_modified,
      lastModifiedBy: r.last_modified_by,
      markdown: r.markdown,
      sections: sections.map((s) => ({ heading: s.heading, level: s.level, text: s.text })),
    };
  }

  getSections(id: string): Section[] {
    return (this.db.prepare('select heading, level, text from sections where page_id = ? order by ord').all(id) as any[]).map((s) => ({
      heading: s.heading,
      level: s.level,
      text: s.text,
    }));
  }

  /** id → version của các trang trong space */
  versions(spaceKey: string): Map<string, number> {
    const rows = this.db.prepare('select id, version from pages where space_key = ?').all(spaceKey) as any[];
    return new Map(rows.map((r) => [String(r.id), Number(r.version)]));
  }

  spaceKeys(): string[] {
    return (this.db.prepare('select distinct space_key from pages').all() as any[]).map((r) => r.space_key);
  }

  pageIdsOfSpace(spaceKey: string): string[] {
    return (this.db.prepare('select id from pages where space_key = ?').all(spaceKey) as any[]).map((r) => String(r.id));
  }

  countBySpace(): Record<string, number> {
    const rows = this.db.prepare('select space_key, count(*) n from pages group by space_key').all() as any[];
    return Object.fromEntries(rows.map((r) => [r.space_key, Number(r.n)]));
  }

  // ───── Trạng thái đồng bộ ─────

  getState(spaceKey: string): SpaceState {
    const r = this.db.prepare('select * from sync_state where space_key = ?').get(spaceKey) as any;
    return {
      spaceKey,
      lastIncrementalAt: r?.last_incremental_at ?? null,
      lastFullAt: r?.last_full_at ?? null,
      lastReconcileAt: r?.last_reconcile_at ?? null,
    };
  }

  setState(spaceKey: string, patch: Partial<Omit<SpaceState, 'spaceKey'>>) {
    const s = { ...this.getState(spaceKey), ...patch };
    this.db
      .prepare(
        `insert into sync_state (space_key, last_incremental_at, last_full_at, last_reconcile_at) values (?, ?, ?, ?)
         on conflict(space_key) do update set last_incremental_at = excluded.last_incremental_at,
           last_full_at = excluded.last_full_at, last_reconcile_at = excluded.last_reconcile_at`,
      )
      .run(spaceKey, s.lastIncrementalAt, s.lastFullAt, s.lastReconcileAt);
  }

  startRun(mode: string): number {
    const r = this.db
      .prepare(`insert into sync_runs (mode, started_at, status) values (?, ?, 'RUNNING')`)
      .run(mode, new Date().toISOString());
    return Number(r.lastInsertRowid);
  }

  finishRun(id: number, status: 'SUCCESS' | 'FAILED' | 'PARTIAL', stats: { fetched: number; upserted: number; unchanged: number; deleted: number }, message?: string) {
    this.db
      .prepare(
        `update sync_runs set finished_at = ?, status = ?, fetched = ?, upserted = ?, unchanged = ?, deleted = ?, message = ? where id = ?`,
      )
      .run(new Date().toISOString(), status, stats.fetched, stats.upserted, stats.unchanged, stats.deleted, message ?? null, id);
  }

  /** Đánh dấu các lần chạy dở dang (do service bị tắt giữa chừng) */
  abandonRunningRuns() {
    this.db
      .prepare(`update sync_runs set status = 'FAILED', finished_at = ?, message = 'Service dừng khi đang đồng bộ' where status = 'RUNNING'`)
      .run(new Date().toISOString());
  }

  recentRuns(limit = 10): SyncRun[] {
    return (this.db.prepare('select * from sync_runs order by id desc limit ?').all(limit) as any[]).map((r) => ({
      id: Number(r.id),
      mode: r.mode,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      fetched: Number(r.fetched),
      upserted: Number(r.upserted),
      unchanged: Number(r.unchanged),
      deleted: Number(r.deleted),
      message: r.message,
    }));
  }
}
