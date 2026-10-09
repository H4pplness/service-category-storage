// Hiển thị phản hồi của agent – chuyển nguyên cấu trúc/class từ mindmate-web (message-list, markdown-content,
// agent-activity, agent-activity-group) để giao diện giống Mindmate.
import { memo, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { BrainCircuit, Check, ChevronRight, CircleX, Copy, LoaderCircle, Wrench } from 'lucide-react';
import type { AgentActivity as Activity, AgentActivityStatus, ChatMessage, TimelineItem } from './model';

const SW = 1.75;

const T = {
  thinking: 'Thinking',
  redactedThinking: 'Nội dung suy nghĩ này đã được mô hình ẩn.',
  running: 'Đang chạy',
  failed: 'Thất bại',
  completed: 'Hoàn tất',
  input: 'Input',
  result: 'Kết quả',
  usingTools: (n: number) => `Đang sử dụng ${n} công cụ`,
  usedTools: (n: number) => `Đã sử dụng ${n} công cụ`,
  someToolsFailed: 'Có công cụ thất bại',
  sending: 'Đang gửi…',
  interrupted: 'Bị gián đoạn',
  copy: 'Sao chép',
  copied: 'Đã sao chép',
  starting: 'Đang bắt đầu',
};

// Link trong câu trả lời mở tab mới (trang Confluence nguồn)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export const MarkdownContent = memo(function MarkdownContent({ content, className }: { content: string; className?: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(content, { async: false, breaks: true, gfm: true }) as string, { ADD_ATTR: ['target'] }),
    [content],
  );
  return (
    <div className={className}>
      <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

function StatusIcon({ status }: { status: AgentActivityStatus }) {
  if (status === 'running') return <LoaderCircle className="spin" size={15} strokeWidth={SW} />;
  if (status === 'failed') return <CircleX size={15} strokeWidth={SW} />;
  return <Check size={15} strokeWidth={SW} />;
}

/** <details> có trạng thái mở điều khiển được (mở khi đang chạy, đóng khi xong – người dùng vẫn tự bấm mở/đóng) */
function useAutoOpen(autoOpen: boolean) {
  const [manual, setManual] = useState<boolean | null>(null);
  const [lastAuto, setLastAuto] = useState(autoOpen);
  if (lastAuto !== autoOpen) {
    setLastAuto(autoOpen);
    setManual(null);
  }
  const open = manual ?? autoOpen;
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open;
    if (next !== open) setManual(next);
  };
  return { open, onToggle };
}

export function AgentActivityView({ activity }: { activity: Activity }) {
  const detail = activity.redacted ? T.redactedThinking : activity.detail;
  const title = activity.activityType === 'thinking' ? T.thinking : activity.title;
  const hasBody = !!detail || !!activity.result;
  const { open, onToggle } = useAutoOpen(activity.status === 'running' && !!detail);
  const cls = ['agent-activity', activity.status === 'running' && 'agent-activity--running', activity.status === 'failed' && 'agent-activity--failed']
    .filter(Boolean)
    .join(' ');
  return (
    <details className={cls} open={open} onToggle={onToggle}>
      <summary>
        <span className="agent-activity__type" aria-hidden="true">
          {activity.activityType === 'thinking' ? <BrainCircuit size={17} strokeWidth={SW} /> : <Wrench size={17} strokeWidth={SW} />}
        </span>
        <span className="agent-activity__title">{title}</span>
        <span className="agent-activity__status" aria-hidden="true">
          <StatusIcon status={activity.status} />
        </span>
        <span className="sr-only">{activity.status === 'running' ? T.running : activity.status === 'failed' ? T.failed : T.completed}</span>
        {hasBody && <ChevronRight className="agent-activity__chevron" size={15} strokeWidth={SW} />}
      </summary>
      {hasBody && (
        <div className="agent-activity__details">
          {detail && (
            <div className="agent-activity__section">
              {activity.activityType === 'tool' ? (
                <>
                  <span>{T.input}</span>
                  <pre>{detail}</pre>
                </>
              ) : (
                <p>{detail}</p>
              )}
            </div>
          )}
          {activity.result && (
            <div className="agent-activity__section">
              <span>{T.result}</span>
              <pre>{activity.result}</pre>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

interface ActivityGroup {
  kind: 'activity-group';
  id: string;
  entries: (Activity | ChatMessage)[];
  toolCount: number;
  status: AgentActivityStatus;
}

function AgentActivityGroupView({ group }: { group: ActivityGroup }) {
  const { open, onToggle } = useAutoOpen(group.status === 'running');
  const cls = [
    'agent-activity-group',
    group.status === 'running' && 'agent-activity-group--running',
    group.status === 'failed' && 'agent-activity-group--failed',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <details className={cls} open={open} onToggle={onToggle}>
      <summary>
        <span className="agent-activity-group__type" aria-hidden="true">
          <Wrench size={17} strokeWidth={SW} />
        </span>
        <span className="agent-activity-group__title">{group.status === 'running' ? T.usingTools(group.toolCount) : T.usedTools(group.toolCount)}</span>
        <span className="agent-activity-group__status" aria-hidden="true">
          <StatusIcon status={group.status} />
        </span>
        <span className="sr-only">{group.status === 'running' ? T.running : group.status === 'failed' ? T.someToolsFailed : T.completed}</span>
        <ChevronRight className="agent-activity-group__chevron" size={15} strokeWidth={SW} aria-hidden="true" />
      </summary>
      <div className="agent-activity-group__items">
        {group.entries.map((e) =>
          e.kind === 'activity' ? (
            <AgentActivityView key={e.id} activity={e} />
          ) : (
            <MarkdownContent key={e.id} className="agent-activity-group__text" content={e.text} />
          ),
        )}
      </div>
    </details>
  );
}

type DisplayItem = TimelineItem | ActivityGroup;

/** Văn bản của assistant mà sau đó còn hoạt động khác trong cùng lượt là ghi chú tiến trình → gộp vào nhóm công cụ */
function intermediateAssistantTextIds(items: TimelineItem[]): Set<string> {
  const ids = new Set<string>();
  let activityFollows = false;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'activity') activityFollows = true;
    else if (it.role === 'user') activityFollows = false;
    else if (activityFollows) ids.add(it.id);
  }
  return ids;
}

function groupStatus(acts: Activity[]): AgentActivityStatus {
  if (acts.some((a) => a.status === 'running')) return 'running';
  if (acts.some((a) => a.status === 'failed')) return 'failed';
  return 'completed';
}

function groupToolActivities(items: TimelineItem[]): DisplayItem[] {
  const inter = intermediateAssistantTextIds(items);
  const out: DisplayItem[] = [];
  for (let i = 0; i < items.length; ) {
    const item = items[i];
    if (item.kind !== 'activity' && !inter.has(item.id)) {
      out.push(item);
      i++;
      continue;
    }
    const entries: (Activity | ChatMessage)[] = [];
    while (i < items.length) {
      const c = items[i];
      if (c.kind !== 'activity' && !inter.has(c.id)) break;
      entries.push(c);
      i++;
    }
    const acts = entries.filter((e): e is Activity => e.kind === 'activity');
    const toolCount = acts.filter((a) => a.activityType === 'tool').length;
    if (toolCount === 0) {
      out.push(...entries);
      continue;
    }
    out.push({ kind: 'activity-group', id: `activity-group-${entries[0].id}`, entries, toolCount, status: groupStatus(acts) });
  }
  return out;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="message-action"
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check size={15} strokeWidth={SW} /> : <Copy size={15} strokeWidth={SW} />}
      <span>{copied ? T.copied : T.copy}</span>
    </button>
  );
}

export function MessageList({ items, isSending }: { items: TimelineItem[]; isSending: boolean }) {
  const display = useMemo(() => groupToolActivities(items), [items]);
  const last = items[items.length - 1];
  const showThinking = isSending && (!last || (last.kind === 'message' && last.role === 'user'));

  return (
    <div className="messages" aria-live="polite">
      {display.map((item) => {
        if (item.kind === 'activity-group') return <AgentActivityGroupView key={item.id} group={item} />;
        if (item.kind === 'activity') return <AgentActivityView key={item.id} activity={item} />;
        if (item.role === 'user') {
          return (
            <article key={item.id} className="message message--user">
              <div className="message__body">
                <div className="message__bubble">
                  <div className="message__content">{item.text}</div>
                </div>
                {item.status !== 'sent' && (
                  <div className={'message__delivery' + (item.status === 'failed' ? ' message__failed' : '')}>
                    {item.status === 'sending' ? T.sending : T.interrupted}
                  </div>
                )}
                <div className="message__actions">
                  <CopyButton text={item.text} />
                </div>
              </div>
            </article>
          );
        }
        return (
          <article key={item.id} className="message message--assistant">
            <MarkdownContent content={item.text} />
            {item.status === 'failed' && <div className="message__delivery message__failed">{T.interrupted}</div>}
            {item.status !== 'sending' && (
              <div className="message__actions">
                <CopyButton text={item.text} />
              </div>
            )}
          </article>
        );
      })}
      {showThinking && (
        <div className="thinking" role="status">
          <span className="thinking__dots" aria-label={T.starting}>
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
    </div>
  );
}
