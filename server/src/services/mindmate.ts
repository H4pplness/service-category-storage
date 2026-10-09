// Client Mindmate: xác thực Keycloak, chuẩn bị workspace "dcms" (AGENTS.md + MCP kho tri thức), hội thoại & stream trả lời.
import fs from 'fs';
import { randomUUID } from 'crypto';
import { HttpError, prisma } from '../core';
import { mindmateConfig as cfg } from '../appConfig';

const WORKSPACE_SETTING_KEY = 'mindmate.workspaceId';

const MCP_DESCRIPTION =
  'Kho tri thức Sản phẩm - Nghiệp vụ (SP-NV) của DCMS, đồng bộ hằng giờ từ Confluence. Mỗi SP-NV có mô tả "khi nào nên chọn". ' +
  'Dùng để xác định tình huống/nhu cầu của khách hàng ứng với sản phẩm - nghiệp vụ nào khi tạo phiếu. ' +
  'Tools: search_product_guidance(query, limit?), get_product_guidance(page_id), get_knowledge_status().';

export class MindmateError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
  }
}

// ───── Xác thực ─────

let token: { value: string; expiresAt: number } | null = null;

async function fetchToken(): Promise<string> {
  const { tokenUrl, clientId, clientSecret, username, password } = cfg.auth;
  if (!tokenUrl || !clientId) throw new MindmateError(500, 'Chưa cấu hình xác thực Mindmate (mindmate.auth.*)');
  const body = new URLSearchParams({ client_id: clientId });
  if (clientSecret) body.set('client_secret', clientSecret);
  if (username) {
    body.set('grant_type', 'password');
    body.set('username', username);
    body.set('password', password);
  } else body.set('grant_type', 'client_credentials');
  let res: Response;
  try {
    res = await fetch(tokenUrl, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new MindmateError(502, `Không kết nối được máy chủ xác thực Mindmate: ${(e as Error).message}`);
  }
  if (!res.ok) throw new MindmateError(502, `Xác thực Mindmate thất bại (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  token = { value: j.access_token, expiresAt: Date.now() + Math.max(30, (j.expires_in ?? 300) - 30) * 1000 };
  return token.value;
}

async function getToken(force = false): Promise<string> {
  if (!force && token && token.expiresAt > Date.now()) return token.value;
  return fetchToken();
}

/** Gọi API Mindmate, tự gắn token và thử lại 1 lần khi token hết hạn */
type MmInit = RequestInit & { timeoutMs?: number };

export async function mmFetch(path: string, init: MmInit = {}): Promise<Response> {
  const call = async (force: boolean) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await getToken(force)}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const signal = init.signal ?? (init.timeoutMs === 0 ? undefined : AbortSignal.timeout(init.timeoutMs ?? 60000));
    try {
      return await fetch(`${cfg.baseUrl}${path}`, { ...init, headers, signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError' && init.signal?.aborted) throw e;
      throw new MindmateError(502, `Không kết nối được Mindmate (${cfg.baseUrl}): ${(e as Error).message}`);
    }
  };
  let res = await call(false);
  if (res.status === 401) res = await call(true);
  return res;
}

/** Đọc thông báo lỗi từ phản hồi Mindmate (ErrorResponse hoặc lỗi kiểu Anthropic) */
export async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j.error?.message ?? j.message ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || res.statusText;
  }
}

async function mmJson<T>(path: string, init: MmInit = {}): Promise<T> {
  const res = await mmFetch(path, init);
  if (!res.ok) throw new MindmateError(res.status === 404 ? 404 : 502, `Mindmate ${init.method ?? 'GET'} ${path} lỗi ${res.status}: ${await readError(res)}`);
  const j = (await res.json()) as any;
  return (j && typeof j === 'object' && 'data' in j && 'status' in j ? j.data : j) as T;
}

// ───── Chuẩn bị workspace ─────

async function ensureWorkspace(): Promise<string> {
  const workspaces = await mmJson<{ id: string; name: string }[]>('/v1/workspaces');
  const saved = await prisma.setting.findUnique({ where: { key: WORKSPACE_SETTING_KEY } });
  let ws = workspaces.find((w) => w.id === saved?.value) ?? workspaces.find((w) => w.name === cfg.workspaceName);
  if (!ws) {
    ws = await mmJson<{ id: string; name: string }>('/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: cfg.workspaceName, description: cfg.workspaceDescription }),
    });
    console.log(`[mindmate] Đã tạo workspace "${cfg.workspaceName}" (${ws.id})`);
  }
  if (saved?.value !== ws.id) {
    await prisma.setting.upsert({ where: { key: WORKSPACE_SETTING_KEY }, create: { key: WORKSPACE_SETTING_KEY, value: ws.id }, update: { value: ws.id } });
  }
  return ws.id;
}

async function syncAgentsMd(workspaceId: string) {
  if (!fs.existsSync(cfg.agentsMdPath)) {
    console.warn(`[mindmate] Không thấy file chỉ dẫn ${cfg.agentsMdPath} – bỏ qua AGENTS.md`);
    return;
  }
  const content = fs.readFileSync(cfg.agentsMdPath, 'utf8');
  const current = await mmJson<{ content: string; exists: boolean }>(`/v1/workspaces/${workspaceId}/agents-md`);
  if (current.exists && current.content.trim() === content.trim()) return;
  await mmJson(`/v1/workspaces/${workspaceId}/agents-md`, { method: 'PUT', body: JSON.stringify({ content }), timeoutMs: 120000 });
  console.log('[mindmate] Đã cập nhật AGENTS.md cho workspace');
}

async function registerMcpServer() {
  if (!cfg.mcp.url) return;
  const body = {
    description: MCP_DESCRIPTION,
    url: cfg.mcp.url,
    transport: 'STREAMABLE_HTTP',
    authType: cfg.mcp.token ? 'BEARER' : 'NONE',
    authSecret: cfg.mcp.token || undefined,
    enabled: true,
  };
  const existing = await mmFetch(`/v1/mcp-servers/${cfg.mcp.name}`);
  if (existing.status === 404) {
    await mmJson('/v1/mcp-servers', { method: 'POST', body: JSON.stringify({ name: cfg.mcp.name, ...body }) });
    console.log(`[mindmate] Đã đăng ký MCP server "${cfg.mcp.name}" → ${cfg.mcp.url}`);
  } else if (existing.ok) {
    await mmJson(`/v1/mcp-servers/${cfg.mcp.name}`, { method: 'PUT', body: JSON.stringify(body) });
  } else throw new MindmateError(502, `Không kiểm tra được MCP server trên Mindmate: ${await readError(existing)}`);
}

let setup: Promise<string> | null = null;

/** Đảm bảo workspace "dcms", AGENTS.md và MCP kho tri thức đã sẵn sàng (chạy 1 lần/tiến trình, thử lại nếu lỗi) */
export function ensureSetup(): Promise<string> {
  if (!cfg.enabled) return Promise.reject(new MindmateError(503, 'Trợ lý Mindmate đang tắt (mindmate.enabled=false)'));
  setup ??= (async () => {
    const workspaceId = await ensureWorkspace();
    await registerMcpServer();
    await syncAgentsMd(workspaceId);
    return workspaceId;
  })().catch((e) => {
    setup = null;
    throw e;
  });
  return setup;
}

// ───── Model ─────

let defaultModel: string | null = null;

export async function resolveModel(): Promise<string> {
  if (cfg.model) return cfg.model;
  if (defaultModel) return defaultModel;
  const catalog = await mmJson<{ models: { id: string }[] }>('/v1/models');
  if (!catalog.models?.length) throw new MindmateError(503, 'Mindmate chưa cấu hình model nào khả dụng');
  return (defaultModel = catalog.models[0].id);
}

// ───── Hội thoại ─────

export async function createConversation(title: string): Promise<string> {
  const workspaceId = await ensureSetup();
  const id = randomUUID();
  await mmJson(`/v1/workspaces/${workspaceId}/conversations`, {
    method: 'POST',
    body: JSON.stringify({ conversation_id: id, title: title.slice(0, 255) }),
  });
  return id;
}

export async function getHistory(conversationId: string): Promise<unknown[]> {
  const res = await mmFetch(`/v1/conversations/anthropic/${encodeURIComponent(conversationId)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new MindmateError(502, `Không tải được lịch sử hội thoại: ${await readError(res)}`);
  const j = (await res.json()) as any;
  return (j.data ?? j).messages ?? [];
}

/** Gửi tin nhắn, trả về Response SSE của Mindmate (người gọi tự đọc body) */
export async function streamMessage(conversationId: string, text: string, signal: AbortSignal): Promise<Response> {
  await ensureSetup();
  const model = await resolveModel();
  const res = await mmFetch(`/v1/agents/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
    body: JSON.stringify({ model, message: { role: 'user', content: text }, temperature: cfg.temperature, stream: true }),
    signal,
    timeoutMs: 0,
  });
  if (!res.ok || !res.body) throw new MindmateError(502, `Mindmate từ chối yêu cầu (${res.status}): ${await readError(res)}`);
  return res;
}
