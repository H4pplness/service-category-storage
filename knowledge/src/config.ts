// Đọc cấu hình từ config/application.properties (+ application-local.properties nếu có).
import fs from 'fs';
import path from 'path';

export const ROOT_DIR = path.resolve(__dirname, '..');

/** Phân tích nội dung file .properties: hỗ trợ chú thích #/!, dấu = hoặc :, nối dòng bằng \ */
export function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    while (line.endsWith('\\') && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].trim();
    const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** Thay ${TEN_BIEN} / ${TEN_BIEN:mac_dinh} bằng biến môi trường */
export function resolvePlaceholders(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Za-z0-9_.-]+)(?::([^}]*))?\}/g, (_m, name: string, def?: string) => env[name] ?? def ?? '');
}

export function loadProperties(dir = path.join(ROOT_DIR, 'config')): Record<string, string> {
  const props: Record<string, string> = {};
  for (const file of ['application.properties', 'application-local.properties']) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) Object.assign(props, parseProperties(fs.readFileSync(p, 'utf8')));
  }
  for (const k of Object.keys(props)) props[k] = resolvePlaceholders(props[k]);
  return props;
}

export type ConfluenceType = 'cloud' | 'datacenter';

export interface SpaceConfig {
  key: string;
  rootPageId?: string;
  labels: string[];
}

export interface AppConfig {
  port: number;
  confluence: {
    type: ConfluenceType;
    baseUrl: string;
    username: string;
    token: string;
    timezone: string;
    pageSize: number;
    timeoutMs: number;
    maxRetries: number;
    spaces: SpaceConfig[];
    excludeTitlePrefixes: string[];
  };
  sync: { cron: string; reconcileCron: string; runOnStartup: boolean; overlapMinutes: number };
  storagePath: string;
  search: { defaultLimit: number; maxLimit: number };
  content: { guidanceHeadings: string[]; maxChars: number };
  mcp: { path: string; authToken: string };
  adminToken: string;
}

const list = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);
const bool = (v: string | undefined, def: boolean) => (v ? /^(true|1|yes)$/i.test(v) : def);

export function buildConfig(p: Record<string, string>): AppConfig {
  const type = (p['confluence.type'] || 'datacenter').toLowerCase();
  if (type !== 'cloud' && type !== 'datacenter') throw new Error(`confluence.type không hợp lệ: ${type} (cloud | datacenter)`);
  const spaces = list(p['confluence.spaces']).map((key) => ({
    key,
    rootPageId: p[`confluence.space.${key}.root-page-id`] || undefined,
    labels: list(p[`confluence.space.${key}.labels`]),
  }));
  const mcpToken = p['mcp.auth-token'] ?? '';
  return {
    port: num(p['server.port'], 4100),
    confluence: {
      type,
      baseUrl: (p['confluence.base-url'] || '').replace(/\/+$/, ''),
      username: p['confluence.username'] ?? '',
      token: p['confluence.token'] ?? '',
      timezone: p['confluence.timezone'] || 'Asia/Ho_Chi_Minh',
      pageSize: num(p['confluence.page-size'], 50),
      timeoutMs: num(p['confluence.request-timeout-ms'], 30000),
      maxRetries: num(p['confluence.max-retries'], 3),
      spaces,
      excludeTitlePrefixes: list(p['confluence.exclude-title-prefixes']),
    },
    sync: {
      cron: p['sync.cron'] || '0 * * * *',
      reconcileCron: p['sync.reconcile-cron'] || '30 2 * * *',
      runOnStartup: bool(p['sync.run-on-startup'], true),
      overlapMinutes: num(p['sync.overlap-minutes'], 60),
    },
    storagePath: path.resolve(ROOT_DIR, p['storage.path'] || 'data/knowledge.db'),
    search: { defaultLimit: num(p['search.default-limit'], 8), maxLimit: num(p['search.max-limit'], 20) },
    content: {
      guidanceHeadings: list(p['content.guidance-headings'] || 'Khi nào nên chọn'),
      maxChars: num(p['content.max-chars'], 12000),
    },
    mcp: { path: p['mcp.path'] || '/mcp', authToken: mcpToken },
    adminToken: p['admin.token'] || mcpToken,
  };
}

let cached: AppConfig | undefined;
export function getConfig(): AppConfig {
  return (cached ??= buildConfig(loadProperties()));
}
