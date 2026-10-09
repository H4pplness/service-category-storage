// Đọc cấu hình từ server/config/application.properties (+ application-local.properties nếu có).
import fs from 'fs';
import path from 'path';

export const SERVER_DIR = path.resolve(__dirname, '..');

function parseProperties(text: string): Record<string, string> {
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
const resolve = (v: string) => v.replace(/\$\{([A-Za-z0-9_.-]+)(?::([^}]*))?\}/g, (_m, n: string, d?: string) => process.env[n] ?? d ?? '');

function load(): Record<string, string> {
  const props: Record<string, string> = {};
  for (const f of ['application.properties', 'application-local.properties']) {
    const p = path.join(SERVER_DIR, 'config', f);
    if (fs.existsSync(p)) Object.assign(props, parseProperties(fs.readFileSync(p, 'utf8')));
  }
  for (const k of Object.keys(props)) props[k] = resolve(props[k]);
  return props;
}

const p = load();

export const mindmateConfig = {
  enabled: /^(true|1|yes)$/i.test(p['mindmate.enabled'] ?? 'true'),
  baseUrl: (p['mindmate.base-url'] || 'http://localhost:8080').replace(/\/+$/, ''),
  workspaceName: p['mindmate.workspace-name'] || 'dcms',
  workspaceDescription: p['mindmate.workspace-description'] || '',
  agentsMdPath: path.resolve(SERVER_DIR, p['mindmate.agents-md.path'] || 'mindmate/AGENTS.md'),
  model: p['mindmate.model'] || '',
  temperature: Number(p['mindmate.temperature'] ?? 0.3),
  auth: {
    tokenUrl: p['mindmate.auth.token-url'] || '',
    clientId: p['mindmate.auth.client-id'] || '',
    clientSecret: p['mindmate.auth.client-secret'] || '',
    username: p['mindmate.auth.username'] || '',
    password: p['mindmate.auth.password'] || '',
  },
  mcp: {
    name: p['mindmate.mcp.name'] || 'dcms-knowledge',
    url: p['mindmate.mcp.url'] || '',
    token: p['mindmate.mcp.token'] || '',
  },
};
