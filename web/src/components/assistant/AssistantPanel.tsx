// Ô chat trợ lý Mindmate: chọn hội thoại, xem lịch sử, gửi câu hỏi và hiển thị phản hồi stream.
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Dropdown, Popconfirm, Tooltip } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ChevronDown, History, LoaderCircle, Maximize2, Minimize2, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { del, errMsg, get, post, TOKEN_KEY } from '@/api';
import { MessageList } from './MessageList';
import {
  applyStreamEvent,
  completeRunningActivities,
  failRunningActivities,
  historyToTimeline,
  newAssistantNotice,
  newStreamState,
  newUserMessage,
  readEventStream,
  TimelineItem,
} from './model';

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

const SUGGESTIONS = [
  'Khách hàng bị trừ tiền 2 lần khi thanh toán bằng thẻ Visa thì chọn nghiệp vụ nào?',
  'Khách báo mất thẻ ghi nợ nội địa, tôi nên tạo phiếu gì?',
  'Khách quên mật khẩu đăng nhập Mobile Banking thì chọn sản phẩm - nghiệp vụ nào?',
];

const ACTIVE_KEY = 'dcms_assistant_conversation';

async function readHttpError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j.message ?? j.error?.message ?? `Yêu cầu thất bại (${res.status})`;
  } catch {
    return `Yêu cầu thất bại (${res.status})`;
  }
}

export default function AssistantPanel({ expanded, onToggleExpand, onClose }: { expanded: boolean; onToggleExpand: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const stageRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const status = useQuery({ queryKey: ['assistant-status'], queryFn: () => get('/assistant/status'), staleTime: 60_000 });
  const conversations = useQuery({ queryKey: ['assistant-conversations'], queryFn: () => get<Conversation[]>('/assistant/conversations') });
  const active = conversations.data?.find((c) => c.id === activeId);

  const scrollToBottom = useCallback(() => {
    queueMicrotask(() => {
      const s = stageRef.current;
      if (s) s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  // Tải lịch sử khi chọn hội thoại
  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
    if (!activeId || sending) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    get(`/assistant/conversations/${activeId}/messages`)
      .then((r) => {
        if (cancelled) return;
        setTimeline(historyToTimeline(r.messages));
        scrollToBottom();
      })
      .catch((e) => {
        if (cancelled) return;
        if (e?.response?.status === 404) setActiveId(null);
        else setError(errMsg(e));
        setTimeline([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const resizeTextarea = () => {
    const t = textareaRef.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 144) + 'px';
  };
  useEffect(resizeTextarea, [draft]);

  const newConversation = () => {
    if (sending) return;
    setActiveId(null);
    setTimeline([]);
    setError(null);
    textareaRef.current?.focus();
  };

  const removeConversation = async (id: string) => {
    try {
      await del(`/assistant/conversations/${id}`);
      if (id === activeId) newConversation();
      qc.invalidateQueries({ queryKey: ['assistant-conversations'] });
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    setError(null);
    setDraft('');
    const userMsg = newUserMessage(content);
    setTimeline((t) => [...t, userMsg]);
    setSending(true);
    scrollToBottom();

    const state = newStreamState();
    const abort = new AbortController();
    abortRef.current = abort;
    let convId = activeId;
    try {
      if (!convId) {
        const c = await post<Conversation>('/assistant/conversations', { title: content });
        convId = c.id;
        setActiveId(c.id);
        qc.invalidateQueries({ queryKey: ['assistant-conversations'] });
      }
      const res = await fetch(`/api/assistant/conversations/${convId}/messages`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ''}`,
        },
        body: JSON.stringify({ content }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(await readHttpError(res));
      if (!res.body) throw new Error('Máy chủ không trả về nội dung streaming.');
      await readEventStream(res.body, (ev) => setTimeline((t) => applyStreamEvent(t, ev, state)));
      setTimeline((t) => {
        const done = completeRunningActivities(t).map((i) =>
          i.kind === 'message' && (i.id === userMsg.id || state.assistantMessageIds.has(i.id)) ? { ...i, status: 'sent' as const } : i,
        );
        return state.receivedAssistantText ? done : [...done, newAssistantNotice('Mindmate đã hoàn thành lượt xử lý này.')];
      });
    } catch (e: any) {
      const aborted = abort.signal.aborted;
      setTimeline((t) =>
        failRunningActivities(t).map((i) => {
          if (i.kind !== 'message') return i;
          if (i.id === userMsg.id) return { ...i, status: state.receivedEvent || aborted ? 'sent' : 'failed' };
          if (state.assistantMessageIds.has(i.id)) return { ...i, status: 'failed' };
          return i;
        }),
      );
      if (!aborted) setError(e?.message || 'Mindmate chưa thể phản hồi.');
      if (!state.receivedEvent && !aborted) setDraft(content);
    } finally {
      abortRef.current = null;
      setSending(false);
      qc.invalidateQueries({ queryKey: ['assistant-conversations'] });
      scrollToBottom();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  const notReady = status.data && (!status.data.enabled || !status.data.ready);
  const hasContent = timeline.length > 0;

  const historyItems = (conversations.data ?? []).map((c) => ({
    key: c.id,
    label: (
      <div className="mm-history-item">
        <span className="mm-history-item__title">{c.title}</span>
        <Popconfirm title="Xoá hội thoại này khỏi danh sách?" okText="Xoá" cancelText="Huỷ" onConfirm={() => removeConversation(c.id)}>
          <button className="icon-button icon-button--small" type="button" onClick={(e) => e.stopPropagation()} aria-label="Xoá hội thoại">
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        </Popconfirm>
      </div>
    ),
  }));

  return (
    <div className="mm-chat">
      <header className="mm-chat__header">
        <div className="mm-chat__brand">
          <span className="mm-chat__logo">
            <Sparkles size={16} strokeWidth={2} />
          </span>
          <div className="mm-chat__heading">
            <strong>Trợ lý SP-NV</strong>
            <Dropdown
              trigger={['click']}
              disabled={sending || !historyItems.length}
              menu={{ items: historyItems, selectable: true, selectedKeys: activeId ? [activeId] : [], onClick: (e) => setActiveId(e.key) }}
              overlayClassName="mm-history-menu"
            >
              <button className="mm-chat__conversation" type="button" title={active?.title}>
                <span>{active?.title ?? 'Hội thoại mới'}</span>
                {historyItems.length > 0 && <ChevronDown size={14} strokeWidth={1.75} />}
              </button>
            </Dropdown>
          </div>
        </div>
        <div className="mm-chat__header-actions">
          <Tooltip title="Hội thoại mới">
            <button className="icon-button" type="button" onClick={newConversation} disabled={sending} aria-label="Hội thoại mới">
              <Plus size={18} strokeWidth={1.75} />
            </button>
          </Tooltip>
          <Tooltip title={expanded ? 'Thu nhỏ' : 'Mở rộng'}>
            <button className="icon-button" type="button" onClick={onToggleExpand} aria-label={expanded ? 'Thu nhỏ' : 'Mở rộng'}>
              {expanded ? <Minimize2 size={17} strokeWidth={1.75} /> : <Maximize2 size={17} strokeWidth={1.75} />}
            </button>
          </Tooltip>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Đóng">
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <section ref={stageRef} className="conversation-stage" aria-label="Hội thoại">
        {notReady && (
          <div className="error-banner error-banner--soft" role="status">
            <span>
              {status.data.enabled ? `Chưa kết nối được Mindmate: ${status.data.message ?? ''}` : 'Trợ lý Mindmate đang tắt trong cấu hình hệ thống.'}
            </span>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="icon-button icon-button--small" type="button" aria-label="Đóng thông báo lỗi" onClick={() => setError(null)}>
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading-state" role="status">
            <LoaderCircle className="spin" size={22} strokeWidth={1.75} />
            <span>Đang mở hội thoại…</span>
          </div>
        ) : hasContent ? (
          <MessageList items={timeline} isSending={sending} />
        ) : (
          <div className="mm-empty">
            <span className="mm-empty__mark">
              <History size={22} strokeWidth={1.75} />
            </span>
            <h3>Hỏi nhanh về Sản phẩm - Nghiệp vụ</h3>
            <p>Mô tả tình huống của khách hàng, trợ lý sẽ tra cứu sổ tay trên Confluence và gợi ý SP-NV nên chọn khi tạo phiếu.</p>
            <div className="mm-empty__suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="mm-suggestion" onClick={() => void send(s)} disabled={sending}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            placeholder="Mô tả tình huống của khách hàng…"
            aria-label="Nhắn tin cho trợ lý"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="composer__toolbar">
            <div className="composer__tools">
              <span className="model-pill" aria-hidden="true">
                <Sparkles size={14} strokeWidth={1.75} />
                <span>Mindmate · workspace dcms</span>
              </span>
            </div>
            {sending ? (
              <button className="send-button send-button--stop" type="button" aria-label="Dừng" onClick={() => abortRef.current?.abort()}>
                <Square size={14} strokeWidth={2} fill="currentColor" />
              </button>
            ) : (
              <button className="send-button" type="button" aria-label="Gửi tin nhắn" disabled={!draft.trim()} onClick={() => void send(draft)}>
                <ArrowUp size={19} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
        <p className="composer-hint">Mindmate có thể mắc lỗi. Hãy kiểm tra những thông tin quan trọng.</p>
      </div>
    </div>
  );
}
