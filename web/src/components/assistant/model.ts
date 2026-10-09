// Mô hình hiển thị hội thoại trợ lý – chuyển từ mindmate-web (conversation.models.ts, conversation-store, history mapper).
// Timeline là danh sách phẳng: tin nhắn và hoạt động (thinking / tool) theo thứ tự phát sinh; nhóm lại khi hiển thị.

export type MessageRole = 'user' | 'assistant';
export type MessageDeliveryStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  kind: 'message';
  id: string;
  role: MessageRole;
  text: string;
  createdAt: string;
  status: MessageDeliveryStatus;
}

export type AgentActivityType = 'thinking' | 'tool';
export type AgentActivityStatus = 'running' | 'completed' | 'failed';

export interface AgentActivity {
  kind: 'activity';
  id: string;
  activityType: AgentActivityType;
  status: AgentActivityStatus;
  title: string;
  detail?: string;
  redacted?: boolean;
  result?: string;
  toolName?: string;
  toolUseId?: string;
  streamIndex?: number;
}

export type TimelineItem = ChatMessage | AgentActivity;

// ───── Dữ liệu từ Mindmate ─────

export interface ContentBlockTransport {
  type: string;
  text?: string;
  thinking?: string;
  data?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown> | string;
  tool_use_id?: string;
  content?: string | { type: string; text?: string }[];
  is_error?: boolean;
}

export interface ModelMessageTransport {
  role: string;
  content: string | ContentBlockTransport[];
}

export interface StreamEvent {
  event: string;
  data: {
    type: string;
    index?: number;
    content_block?: ContentBlockTransport;
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
    error?: { type: string; message: string };
  };
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

export const THINKING_TITLE = 'Thinking';

/** Tiêu đề hoạt động công cụ: tên tool, kèm tên tool MCP con nếu gọi qua gateway "mcp" */
export function toolTitle(name: string | undefined, input: unknown): string {
  const base = name ?? 'unknown';
  let obj: any = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      obj = null;
    }
  }
  const sub = obj && typeof obj === 'object' ? (obj.tool ?? (obj.action && obj.action !== 'call_tool' ? obj.action : undefined)) : undefined;
  return sub ? `${base} · ${sub}` : base;
}

function formatToolInput(input?: Record<string, unknown> | string): string | undefined {
  if (typeof input === 'string') return input || undefined;
  return input && Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : undefined;
}

function blockContentText(content: ContentBlockTransport['content']): string | undefined {
  if (content == null) return undefined;
  if (typeof content === 'string') return content;
  return content.map((c) => c.text ?? '').join('\n');
}

// ───── Áp dụng sự kiện stream ─────

export interface StreamState {
  currentAssistantMessageId: string;
  assistantMessageIds: Set<string>;
  activitiesByIndex: Map<number, string>;
  receivedAssistantText: boolean;
  receivedEvent: boolean;
  modelTurn: number;
}

export const newStreamState = (): StreamState => ({
  currentAssistantMessageId: uid(),
  assistantMessageIds: new Set(),
  activitiesByIndex: new Map(),
  receivedAssistantText: false,
  receivedEvent: false,
  modelTurn: 0,
});

const completeRunningTools = (t: TimelineItem[]): TimelineItem[] =>
  t.map((i) => (i.kind === 'activity' && i.activityType === 'tool' && i.status === 'running' ? { ...i, status: 'completed' } : i));

export const completeRunningActivities = (t: TimelineItem[]): TimelineItem[] =>
  t.map((i) => (i.kind === 'activity' && i.status === 'running' ? { ...i, status: 'completed' } : i));

export const failRunningActivities = (t: TimelineItem[]): TimelineItem[] =>
  t.map((i) => (i.kind === 'activity' && i.status === 'running' ? { ...i, status: 'failed' } : i));

function appendAssistantText(t: TimelineItem[], s: StreamState, text: string): TimelineItem[] {
  if (!text) return t;
  s.receivedAssistantText = true;
  s.assistantMessageIds.add(s.currentAssistantMessageId);
  if (!t.some((i) => i.kind === 'message' && i.id === s.currentAssistantMessageId)) {
    return [...t, { kind: 'message', id: s.currentAssistantMessageId, role: 'assistant', text, createdAt: new Date().toISOString(), status: 'sending' }];
  }
  return t.map((i) => (i.kind === 'message' && i.id === s.currentAssistantMessageId ? { ...i, text: i.text + text } : i));
}

function appendActivityDetail(t: TimelineItem[], id: string, detail: string, retitle: boolean): TimelineItem[] {
  if (!detail) return t;
  return t.map((i) => {
    if (i.kind !== 'activity' || i.id !== id) return i;
    const next = (i.detail ?? '') + detail;
    return { ...i, detail: next, title: retitle ? toolTitle(i.toolName, next) : i.title };
  });
}

/** Áp dụng một sự kiện SSE vào timeline (ném lỗi với sự kiện "error") */
export function applyStreamEvent(t: TimelineItem[], ev: StreamEvent, s: StreamState): TimelineItem[] {
  s.receivedEvent = true;
  const d = ev.data;
  switch (ev.event) {
    case 'error':
      throw new Error(d.error?.message ?? 'Luồng phản hồi từ Mindmate gặp lỗi.');
    case 'message_start': {
      const next = s.modelTurn > 0 ? completeRunningTools(t) : t;
      s.modelTurn += 1;
      s.currentAssistantMessageId = uid();
      s.activitiesByIndex.clear();
      return next;
    }
    case 'content_block_start': {
      const b = d.content_block;
      if (!b || d.index === undefined) return t;
      if (b.type === 'text') return appendAssistantText(t, s, b.text ?? '');
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        const a: AgentActivity = {
          kind: 'activity',
          id: uid(),
          activityType: 'thinking',
          status: 'running',
          title: THINKING_TITLE,
          detail: b.type === 'redacted_thinking' ? undefined : b.thinking || undefined,
          redacted: b.type === 'redacted_thinking',
          streamIndex: d.index,
        };
        s.activitiesByIndex.set(d.index, a.id);
        return [...t, a];
      }
      if (b.type === 'tool_use') {
        const detail = formatToolInput(b.input);
        const a: AgentActivity = {
          kind: 'activity',
          id: uid(),
          activityType: 'tool',
          status: 'running',
          title: toolTitle(b.name, b.input),
          detail,
          toolName: b.name,
          toolUseId: b.id,
          streamIndex: d.index,
        };
        s.activitiesByIndex.set(d.index, a.id);
        return [...t, a];
      }
      return t;
    }
    case 'content_block_delta': {
      const delta = d.delta;
      if (!delta) return t;
      if (delta.type === 'text_delta') return appendAssistantText(t, s, delta.text ?? '');
      const id = d.index !== undefined ? s.activitiesByIndex.get(d.index) : undefined;
      if (!id) return t;
      if (delta.type === 'thinking_delta') return appendActivityDetail(t, id, delta.thinking ?? '', false);
      if (delta.type === 'input_json_delta') return appendActivityDetail(t, id, delta.partial_json ?? '', true);
      return t;
    }
    case 'content_block_stop': {
      const id = d.index !== undefined ? s.activitiesByIndex.get(d.index) : undefined;
      if (!id) return t;
      return t.map((i) => (i.kind === 'activity' && i.id === id && i.activityType === 'thinking' ? { ...i, status: 'completed' } : i));
    }
    case 'tool_result': {
      const r = d.content_block;
      if (r?.type !== 'tool_result' || !r.tool_use_id) return t;
      return t.map((i) =>
        i.kind === 'activity' && i.activityType === 'tool' && i.toolUseId === r.tool_use_id
          ? { ...i, status: r.is_error ? 'failed' : 'completed', result: blockContentText(r.content) }
          : i,
      );
    }
    default:
      return t;
  }
}

// ───── Lịch sử hội thoại (định dạng Anthropic) → timeline ─────

export function historyToTimeline(messages: ModelMessageTransport[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  const now = new Date().toISOString();
  const pushText = (role: MessageRole, text: string) => {
    if (text.trim()) out.push({ kind: 'message', id: uid(), role, text, createdAt: now, status: 'sent' });
  };
  for (const m of messages) {
    const role: MessageRole = m.role === 'assistant' ? 'assistant' : 'user';
    if (typeof m.content === 'string') {
      pushText(role, m.content);
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'text') pushText(role, b.text ?? '');
      else if (b.type === 'thinking' && b.thinking?.trim()) {
        out.push({ kind: 'activity', id: uid(), activityType: 'thinking', status: 'completed', title: THINKING_TITLE, detail: b.thinking });
      } else if (b.type === 'redacted_thinking') {
        out.push({ kind: 'activity', id: uid(), activityType: 'thinking', status: 'completed', title: THINKING_TITLE, redacted: true });
      } else if (b.type === 'tool_use') {
        out.push({
          kind: 'activity',
          id: uid(),
          activityType: 'tool',
          status: 'completed',
          title: toolTitle(b.name, b.input),
          detail: formatToolInput(b.input),
          toolName: b.name,
          toolUseId: b.id,
        });
      } else if (b.type === 'tool_result') {
        for (let k = out.length - 1; k >= 0; k--) {
          const it = out[k];
          if (it.kind === 'activity' && it.activityType === 'tool' && it.toolUseId === b.tool_use_id) {
            out[k] = { ...it, status: b.is_error ? 'failed' : 'completed', result: blockContentText(b.content) };
            break;
          }
        }
      }
    }
  }
  return out;
}

export const newUserMessage = (text: string): ChatMessage => ({
  kind: 'message',
  id: uid(),
  role: 'user',
  text,
  createdAt: new Date().toISOString(),
  status: 'sending',
});

export const newAssistantNotice = (text: string): ChatMessage => ({
  kind: 'message',
  id: uid(),
  role: 'assistant',
  text,
  createdAt: new Date().toISOString(),
  status: 'sent',
});

// ───── Đọc luồng SSE (fetch POST) ─────

function parseEventBlock(block: string): StreamEvent | null {
  if (!block || block.startsWith(':')) return null;
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null;
  }
}

export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, '\n');
    let i = buffer.indexOf('\n\n');
    while (i >= 0) {
      const ev = parseEventBlock(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
      if (ev) onEvent(ev);
      i = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  const tail = parseEventBlock(buffer.trim());
  if (tail) onEvent(tail);
}
