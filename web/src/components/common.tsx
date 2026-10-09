import { ReactNode, useMemo } from 'react';
import { Button, Collapse, Empty, Popconfirm, Space, Table, Tag, Tooltip, TreeSelect, Select, Typography } from 'antd';
import { DeleteOutlined, DownloadOutlined, PaperClipOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { STEP_STATUS, TASK_STATUS, TICKET_STATUS } from '@shared/constants';
import { computeSla, formatSla, WorkHoursMode } from '@shared/sla';
import { useCalendar, useDepartments, useNow, useUsers } from '@/hooks';
import { descendants, fmtDateTime, fmtSize, toTreeSelect } from '@/utils';
import { downloadUrl } from '@/api';

export function PageHead({ title, sub, extra }: { title: ReactNode; sub?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
}

export const TicketStatusTag = ({ status }: { status: string }) => {
  const s = (TICKET_STATUS as any)[status];
  return <Tag color={s?.color}>{s?.label ?? status}</Tag>;
};
export const TaskStatusTag = ({ status }: { status: string }) => {
  const s = (TASK_STATUS as any)[status];
  return <Tag color={s?.color}>{s?.label ?? status}</Tag>;
};
export const StepStatusTag = ({ status }: { status: string }) => {
  const s = (STEP_STATUS as any)[status];
  return <Tag color={s?.color}>{s?.label ?? status}</Tag>;
};

export const ActiveTag = ({ active }: { active: boolean }) =>
  active ? <Tag color="green">Đang sử dụng</Tag> : <Tag>Ngừng sử dụng</Tag>;

interface SlaProps {
  mode: string;
  startAt: string;
  dueAt: string;
  completedAt?: string | null;
  slaMinutes: number;
  compact?: boolean;
}

/** Sớm/trễ đếm ngược theo thời gian thực + tag Sắp đến hạn / Quá hạn. */
export function SlaInfo({ mode, startAt, dueAt, completedAt, slaMinutes, compact }: SlaProps) {
  const cal = useCalendar();
  const now = useNow(1000);
  if (!cal) return null;
  const s = computeSla({
    mode: mode as WorkHoursMode,
    cal,
    startAt: new Date(startAt).getTime(),
    dueAt: new Date(dueAt).getTime(),
    completedAt: completedAt ? new Date(completedAt).getTime() : null,
    slaMinutes,
    now,
  });
  const color = s.kind === 'LATE' ? '#dc2626' : s.kind === 'ON_TIME' ? '#2563eb' : '#16a34a';
  return (
    <Space size={4} wrap>
      <span style={{ color, fontWeight: 600, whiteSpace: 'nowrap' }}>{s.text}</span>
      {s.tag === 'NEAR_DUE' && <Tag color="orange">Sắp đến hạn</Tag>}
      {s.tag === 'OVERDUE' && <Tag color="red">Quá hạn</Tag>}
      {!compact && s.done && <Tag color="default">Đã hoàn thành</Tag>}
    </Space>
  );
}

export function SlaDue({ dueAt, slaMinutes, mode }: { dueAt: string; slaMinutes: number; mode: string }) {
  return (
    <span>
      {fmtDateTime(dueAt)}{' '}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        (SLA {formatSla(slaMinutes, mode as WorkHoursMode)}
        {mode === 'H24' ? ', 24/7' : ', giờ hành chính'})
      </Typography.Text>
    </span>
  );
}

// ───── Phòng ban / Nhân sự ─────

export function DeptTreeSelect(props: { id?: string; value?: number | null; onChange?: (v: number | null) => void; disabled?: boolean; placeholder?: string; allowClear?: boolean }) {
  const { data = [] } = useDepartments();
  const tree = useMemo(() => toTreeSelect(data, { activeOnly: true }), [data]);
  return (
    <TreeSelect
      id={props.id}
      value={props.value ?? undefined}
      onChange={(v) => props.onChange?.(v ?? null)}
      treeData={tree}
      showSearch
      treeNodeFilterProp="title"
      allowClear={props.allowClear ?? true}
      disabled={props.disabled}
      placeholder={props.placeholder ?? 'Chọn phòng ban'}
      style={{ width: '100%' }}
      popupMatchSelectWidth={false}
      listHeight={360}
    />
  );
}

/** Chỉ hiển thị nhân sự đang active thuộc phòng ban đã chọn (gồm phòng ban con). */
export function StaffSelect(props: {
  id?: string;
  departmentId?: number | null;
  value?: number | null;
  onChange?: (v: number | null, user?: any) => void;
  disabled?: boolean;
  placeholder?: string;
  anyDepartment?: boolean;
}) {
  const { data: users = [] } = useUsers({ active: 'true' });
  const { data: depts = [] } = useDepartments();
  const options = useMemo(() => {
    let list = users;
    if (!props.anyDepartment) {
      if (!props.departmentId) return [];
      const ids = new Set(descendants(depts, props.departmentId));
      list = users.filter((u) => u.departmentId && ids.has(u.departmentId));
    }
    return list.map((u) => ({ value: u.id, label: `${u.fullName} – ${u.departmentName ?? ''}`, user: u }));
  }, [users, depts, props.departmentId, props.anyDepartment]);
  return (
    <Select
      id={props.id}
      value={props.value ?? undefined}
      onChange={(v, o: any) => props.onChange?.(v ?? null, o?.user)}
      options={options}
      showSearch
      optionFilterProp="label"
      allowClear
      disabled={props.disabled || (!props.anyDepartment && !props.departmentId)}
      placeholder={props.placeholder ?? (props.anyDepartment || props.departmentId ? 'Chọn nhân sự' : 'Chọn phòng ban trước')}
      style={{ width: '100%' }}
    />
  );
}

// ───── File đính kèm ─────

export function AttachmentList({ items, onDelete, canDelete }: { items: any[]; onDelete?: (id: number) => void; canDelete?: (a: any) => boolean }) {
  if (!items?.length) return <Typography.Text type="secondary">Chưa có file đính kèm</Typography.Text>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid #eceef4', borderRadius: 8 }}>
          <PaperClipOutlined style={{ color: '#6366f1' }} />
          <a href={downloadUrl(a.id, true)} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {a.fileName}
          </a>
          <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {fmtSize(a.size)} · {a.uploadedByName}
          </Typography.Text>
          <Tooltip title="Tải về">
            <Button size="small" type="text" icon={<DownloadOutlined />} href={downloadUrl(a.id)} />
          </Tooltip>
          {onDelete && (!canDelete || canDelete(a)) && (
            <Popconfirm title="Xóa file này?" onConfirm={() => onDelete(a.id)} okText="Xóa" cancelText="Hủy">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </div>
      ))}
    </div>
  );
}

// ───── Lịch sử thay đổi ─────

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const showVal = (v: string | null) => (v === null || v === '' ? <Typography.Text type="secondary">—</Typography.Text> : ISO.test(v) ? fmtDateTime(v) : v);

export function HistoryList({ items }: { items: any[] }) {
  if (!items?.length) return <Empty description="Chưa có lịch sử" />;
  return (
    <Collapse
      bordered={false}
      style={{ background: 'transparent' }}
      items={items.map((h) => ({
        key: h.id,
        className: 'history-item',
        label: (
          <Space direction="vertical" size={0}>
            <span>
              {h.actorId ? <UserOutlined style={{ color: '#6366f1' }} /> : <RobotOutlined style={{ color: '#9333ea' }} />}{' '}
              <b>{h.actorId ? h.actorName : 'Hệ thống'}</b> đã cập nhật lúc {fmtDateTime(h.createdAt)}
            </span>
            {h.summary && <Typography.Text type="secondary">{h.summary}</Typography.Text>}
          </Space>
        ),
        collapsible: h.changes?.length ? undefined : 'icon',
        showArrow: !!h.changes?.length,
        children: (
          <Table
            size="small"
            pagination={false}
            rowKey={(r: any) => r.field}
            dataSource={h.changes}
            columns={[
              { title: 'Thông tin', dataIndex: 'label', width: '28%' },
              { title: 'Giá trị mới', dataIndex: 'newValue', render: showVal },
              { title: 'Giá trị cũ', dataIndex: 'oldValue', render: showVal },
            ]}
          />
        ),
      }))}
    />
  );
}
