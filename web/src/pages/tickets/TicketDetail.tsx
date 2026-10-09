import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Col, Collapse, Descriptions, Dropdown, Empty, Popconfirm, Result, Row, Space, Spin, Table, Tabs, Tag, Tooltip, Typography, Upload } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SwapOutlined,
  UploadOutlined,
  ApartmentOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { del, errMsg, get, post, uploadFiles } from '@/api';
import { useAuth } from '@/auth';
import { AttachmentList, HistoryList, SlaDue, SlaInfo, StepStatusTag, TaskStatusTag, TicketStatusTag } from '@/components/common';
import { DynamicValuesView } from '@/components/DynamicForm';
import { TaskCreateModal, TaskProcessModal } from '@/components/TaskModals';
import TicketEditDrawer from './TicketEditDrawer';
import { fmtDateTime } from '@/utils';
import { CHANNEL_LABEL, SEGMENT_LABEL, TASK_LIMITS, TICKET_STATUS, WORK_HOURS_LABEL } from '@shared/constants';
import { formatSla, slaToMinutes, WorkHoursMode } from '@shared/sla';

function StepCard({ step, ticket, onCreate, onOpenTask, onDeleteTask }: any) {
  const old = step.isOld;
  const canCreate = !old && step.status !== 'CANCELLED' && ticket.status !== 'DONE';
  const leaves = step.results.filter((r: any) => !step.results.some((c: any) => c.parentKey === r.key));
  const cls = step.status === 'DONE' ? 'done' : step.status === 'CANCELLED' ? 'cancelled' : '';
  return (
    <div className={`step-card ${step.status === 'ACTIVE' ? 'active' : ''}`}>
      <div className="step-card-head">
        <Space size={12} wrap>
          <span className={`step-no ${cls}`}>{step.sortOrder}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {step.name} <StepStatusTag status={step.status} />
            </div>
            <Space size={[12, 0]} wrap className="muted" style={{ fontSize: 12 }}>
              <span>SLA {formatSla(slaToMinutes(step.slaDays, step.slaHours, step.slaMinutes, ticket.workHoursMode), ticket.workHoursMode)}</span>
              <span>
                <ApartmentOutlined /> {step.departmentName ?? 'Chưa cấu hình phòng ban'}
              </span>
              {step.assigneeName && (
                <span>
                  <UserOutlined /> {step.assigneeName}
                </span>
              )}
              {step.form && <span>Mẫu: {step.form.name}</span>}
              <Tooltip
                title={
                  <div>
                    {leaves.map((r: any) => (
                      <div key={r.key}>
                        • {r.name} →{' '}
                        {r.routeType === 'END' ? 'Kết thúc' : r.routeType === 'GOTO' ? `chuyển đến "${ticket.steps.find((s: any) => s.stepKey === r.gotoStepKey && !s.isOld)?.name ?? '?'}"` : 'công việc kế tiếp'}
                      </div>
                    ))}
                  </div>
                }
              >
                <a>{leaves.length} kết quả</a>
              </Tooltip>
            </Space>
          </div>
        </Space>
        {canCreate && (
          <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => onCreate(step)}>
            Tạo tác vụ
          </Button>
        )}
      </div>
      {step.tasks.length ? (
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={step.tasks}
          scroll={{ x: 860 }}
          columns={[
            {
              title: 'Mã tác vụ',
              dataIndex: 'code',
              render: (v, r: any) => (
                <a className="mono" onClick={() => onOpenTask(r.id)}>
                  {v}
                </a>
              ),
            },
            { title: 'Nhân sự xử lý', dataIndex: 'assigneeName' },
            { title: 'Phòng ban xử lý', dataIndex: 'departmentName' },
            { title: 'Trạng thái', dataIndex: 'status', render: (s) => <TaskStatusTag status={s} /> },
            { title: 'Thời hạn', dataIndex: 'dueAt', render: fmtDateTime },
            {
              title: 'Sớm / Trễ',
              render: (_, r: any) => <SlaInfo mode={r.workHoursMode} startAt={r.createdAt} dueAt={r.dueAt} completedAt={r.completedAt} slaMinutes={r.slaMinutes} compact />,
            },
            { title: 'Kết quả', dataIndex: 'resultLabel', render: (v) => v ?? '—' },
            {
              title: '',
              width: 48,
              render: (_, r: any) =>
                !old &&
                ['NEW', 'IN_PROGRESS'].includes(r.status) && (
                  <Popconfirm title={`Xóa tác vụ ${r.code}?`} description="Thao tác không thể hoàn tác." okText="Xóa" okButtonProps={{ danger: true }} cancelText="Hủy" onConfirm={() => onDeleteTask(r)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                ),
            },
          ]}
        />
      ) : (
        <div style={{ padding: '14px 16px' }} className="muted">
          Chưa có tác vụ
        </div>
      )}
    </div>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();
  const { message, modal } = App.useApp();
  const [tab, setTab] = useState(sp.get('task') ? 'steps' : 'info');
  const [createStep, setCreateStep] = useState<any>(null);
  const [taskId, setTaskId] = useState<number | null>(sp.get('task') ? Number(sp.get('task')) : null);
  const [editOpen, setEditOpen] = useState(false);
  const [alertErr, setAlertErr] = useState<any>(null);
  const seenRef = useRef<string | null>(null);

  const { data: t, isLoading, error, refetch } = useQuery({ queryKey: ['ticket', id], queryFn: () => get(`/tickets/${id}`, { open: 1 }) });
  const { data: history = [] } = useQuery({
    queryKey: ['ticket-history', id, t?.status, t?.steps?.length],
    queryFn: () => get(`/tickets/${id}/history`),
    enabled: tab === 'history',
  });

  useEffect(() => {
    const q = sp.get('task');
    if (q) {
      setTaskId(Number(q));
      setTab('steps');
    }
  }, [sp]);

  // Cảnh báo sinh tác vụ tự động thất bại – hiển thị lần đầu mở phiếu sau khi phát hiện lỗi
  useEffect(() => {
    const err = t?.autoGenError;
    if (err && !err.seen && seenRef.current !== err.at) {
      seenRef.current = err.at;
      setAlertErr(err);
      post(`/tickets/${id}/alert-seen`).catch(() => undefined);
    }
    if (!err) setAlertErr(null);
  }, [t, id]);

  if (isLoading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  if (error || !t) return <Result status="404" title="Không tìm thấy phiếu" subTitle={errMsg(error)} extra={<Button onClick={() => nav('/tickets')}>Về danh sách</Button>} />;

  const canChangeStatus = isAdmin || t.ownerId === user?.id;
  const curSteps = t.steps.filter((s: any) => !s.isOld);
  const oldSteps = t.steps.filter((s: any) => s.isOld);
  const totalTasks = t.steps.reduce((n: number, s: any) => n + s.tasks.length, 0);

  const changeStatus = (status: string) =>
    modal.confirm({
      title: `Chuyển phiếu sang "${(TICKET_STATUS as any)[status].label}"?`,
      okText: 'Xác nhận',
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          await post(`/tickets/${id}/status`, { status });
          message.success('Đã cập nhật trạng thái phiếu');
          qc.invalidateQueries();
        } catch (e) {
          message.error(errMsg(e));
        }
      },
    });

  const retry = async () => {
    try {
      await post(`/tickets/${id}/retry-autogen`);
      message.success('Đã sinh tác vụ tự động thành công');
      setAlertErr(null);
      refetch();
    } catch (e) {
      message.error(errMsg(e));
      refetch();
    }
  };

  const snap = t.snapshot;
  const linkedTags = t.linkedTickets.length
    ? t.linkedTickets.map((l: any) => (
        <Tag key={l.id} color="blue" style={{ cursor: 'pointer' }} onClick={() => nav(`/tickets/${l.id}`)}>
          {l.code}
        </Tag>
      ))
    : '—';

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Space size={12} align="center" wrap>
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => nav('/tickets')} />
            <h1 className="mono">{t.code}</h1>
            <TicketStatusTag status={t.status} />
            <SlaInfo mode={t.workHoursMode} startAt={t.slaStartAt} dueAt={t.dueAt} completedAt={t.completedAt} slaMinutes={t.slaMinutes} compact />
          </Space>
          <div className="sub" style={{ marginLeft: 44 }}>
            {t.productName} · {t.operationName} {t.customerName ? `· ${t.customerName}` : ''}
          </div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
            Sửa phiếu
          </Button>
          {canChangeStatus && (
            <Dropdown
              menu={{
                items: [
                  { key: 'IN_PROGRESS', label: 'Đang xử lý', disabled: t.status === 'IN_PROGRESS' },
                  { key: 'RETURNED', label: 'Trả lại xử lý', disabled: t.status === 'RETURNED' },
                  { key: 'DONE', label: 'Hoàn thành', disabled: t.status === 'DONE' },
                ],
                onClick: (e) => changeStatus(e.key),
              }}
            >
              <Button type="primary" icon={<SwapOutlined />}>
                Đổi trạng thái <DownOutlined />
              </Button>
            </Dropdown>
          )}
        </Space>
      </div>

      {alertErr && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setAlertErr(null)}
          style={{ marginBottom: 16 }}
          message={`Sinh tự động tác vụ cho công việc "${alertErr.stepName}" thất bại`}
          description={
            <span>
              {alertErr.message}. Vui lòng kiểm tra cấu hình hoặc tạo tác vụ thủ công tại tab Công việc. (Phát hiện lúc {fmtDateTime(alertErr.at)})
            </span>
          }
          action={
            <Space direction="vertical">
              <Button size="small" onClick={retry}>
                Thử lại
              </Button>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  setTab('steps');
                  setCreateStep(t.steps.find((s: any) => s.id === alertErr.stepId));
                }}
              >
                Tạo thủ công
              </Button>
            </Space>
          }
        />
      )}
      {!alertErr && t.autoGenError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Công việc "${t.autoGenError.stepName}" chưa có tác vụ do sinh tự động thất bại`}
          action={
            <Button size="small" onClick={retry}>
              Thử lại
            </Button>
          }
        />
      )}

      <Card styles={{ body: { paddingTop: 4 } }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'info',
              label: 'Thông tin phiếu',
              children: (
                <Row gutter={[24, 16]}>
                  <Col span={24}>
                    <div className="section-title">Thông tin chung</div>
                    <Descriptions
                      bordered
                      size="small"
                      column={{ xs: 1, md: 2, xl: 3 }}
                      items={[
                        { key: 'code', label: 'Mã phiếu', children: <b className="mono">{t.code}</b> },
                        { key: 'ch', label: 'Kênh', children: CHANNEL_LABEL[t.channel] },
                        { key: 'ca', label: 'Thời gian tạo', children: fmtDateTime(t.createdAt) },
                        { key: 'cr', label: 'Người tạo', children: t.creatorName },
                        { key: 'p', label: 'Sản phẩm', children: t.productName },
                        { key: 'o', label: 'Nghiệp vụ', children: t.operationName },
                        { key: 'hx', label: 'Hướng xử lý', children: snap?.workflow?.name ?? '—' },
                        { key: 'ow', label: 'Người phụ trách', children: t.ownerName },
                        { key: 'du', label: 'Thời hạn hoàn thành', children: <SlaDue dueAt={t.dueAt} slaMinutes={t.slaMinutes} mode={t.workHoursMode} /> },
                        { key: 'st', label: 'Trạng thái', children: <TicketStatusTag status={t.status} /> },
                        {
                          key: 'ct',
                          label: 'Thời gian hoàn thành',
                          children: (
                            <Space direction="vertical" size={0}>
                              <SlaInfo mode={t.workHoursMode} startAt={t.slaStartAt} dueAt={t.dueAt} completedAt={t.completedAt} slaMinutes={t.slaMinutes} />
                              {t.completedAt && <Typography.Text type="secondary">{fmtDateTime(t.completedAt)}</Typography.Text>}
                            </Space>
                          ),
                        },
                        { key: 'lk', label: 'Mã phiếu liên kết', children: linkedTags },
                        {
                          key: 'kh',
                          label: 'Khách hàng',
                          children: t.customer ? (
                            <span>
                              {t.customer.fullName} · CIF {t.customer.cif} <Tag color="geekblue">{SEGMENT_LABEL[t.segment]}</Tag>
                            </span>
                          ) : (
                            '—'
                          ),
                        },
                        { key: 'sv', label: 'Dịch vụ', children: <span className="mono">{snap?.service?.code}</span> },
                        { key: 'wh', label: 'Giờ làm việc', children: WORK_HOURS_LABEL[t.workHoursMode] },
                      ]}
                    />
                  </Col>
                  <Col span={24}>
                    <div className="section-title">Thông tin nhập liệu{snap?.form ? ` – ${snap.form.name} (${snap.form.code})` : ''}</div>
                    {snap?.form ? <DynamicValuesView items={snap.form.items} values={t.dynamicValues} ticketOnly /> : <Typography.Text type="secondary">Dịch vụ không cấu hình mẫu nhập liệu</Typography.Text>}
                  </Col>
                  <Col xs={24} lg={12}>
                    <div className="section-title">Mô tả / Nội dung yêu cầu</div>
                    <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{t.description || <span className="muted">—</span>}</Typography.Paragraph>
                    <div className="section-title">Nội dung trao đổi</div>
                    <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{t.exchangeContent || <span className="muted">—</span>}</Typography.Paragraph>
                    <div className="section-title">Tóm tắt cách xử lý</div>
                    <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{t.resolutionSummary || <span className="muted">—</span>}</Typography.Paragraph>
                  </Col>
                  <Col xs={24} lg={12}>
                    <div className="section-title">Đính kèm file ({t.attachments.length})</div>
                    <AttachmentList
                      items={t.attachments}
                      onDelete={async (aid) => {
                        try {
                          await del(`/attachments/${aid}`);
                          refetch();
                        } catch (e) {
                          message.error(errMsg(e));
                        }
                      }}
                      canDelete={(a) => a.uploadedById === user?.id || isAdmin}
                    />
                    <Upload
                      multiple
                      showUploadList={false}
                      beforeUpload={(f, list) => {
                        if (f.size > TASK_LIMITS.maxFileSize) {
                          message.error(`File "${f.name}" vượt quá 10MB`);
                          return Upload.LIST_IGNORE;
                        }
                        if (f === list[list.length - 1])
                          uploadFiles(`/tickets/${id}/attachments`, list.filter((x) => x.size <= TASK_LIMITS.maxFileSize))
                            .then(() => (message.success('Đã đính kèm file'), refetch()))
                            .catch((e) => message.error(errMsg(e)));
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />} style={{ marginTop: 8 }}>
                        Thêm file
                      </Button>
                    </Upload>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'steps',
              label: (
                <span>
                  Công việc <Tag style={{ marginLeft: 4 }}>{totalTasks} tác vụ</Tag>
                </span>
              ),
              children: (
                <>
                  <div style={{ marginBottom: 12 }} className="muted">
                    Quy trình: <b style={{ color: '#111827' }}>{snap?.workflow?.name}</b> ({snap?.workflow?.code}) · Tổng SLA {formatSla(t.slaMinutes, t.workHoursMode as WorkHoursMode)}
                  </div>
                  {curSteps.map((s: any) => (
                    <StepCard
                      key={s.id}
                      step={s}
                      ticket={t}
                      onCreate={setCreateStep}
                      onOpenTask={(tid: number) => setTaskId(tid)}
                      onDeleteTask={async (r: any) => {
                        try {
                          await del(`/tasks/${r.id}`);
                          message.success(`Đã xóa tác vụ ${r.code}`);
                          qc.invalidateQueries();
                        } catch (e) {
                          message.error(errMsg(e));
                        }
                      }}
                    />
                  ))}
                  {!curSteps.length && <Empty />}
                  {oldSteps.length > 0 && (
                    <Collapse
                      style={{ marginTop: 16 }}
                      items={[
                        {
                          key: 'old',
                          label: (
                            <span>
                              Công việc thuộc dịch vụ cũ <Tag color="red">{oldSteps.length} công việc đã Hủy</Tag>
                            </span>
                          ),
                          children: oldSteps.map((s: any) => <StepCard key={s.id} step={s} ticket={t} onOpenTask={(tid: number) => setTaskId(tid)} />),
                        },
                      ]}
                    />
                  )}
                </>
              ),
            },
            { key: 'history', label: 'Lịch sử phiếu', children: <HistoryList items={history} /> },
          ]}
        />
      </Card>

      <TaskCreateModal ticket={t} step={createStep} open={!!createStep} onClose={() => setCreateStep(null)} />
      <TaskProcessModal
        taskId={taskId}
        open={!!taskId}
        onClose={() => {
          setTaskId(null);
          if (sp.get('task')) {
            sp.delete('task');
            setSp(sp, { replace: true });
          }
        }}
      />
      <TicketEditDrawer ticket={t} open={editOpen} onClose={() => setEditOpen(false)} />
    </div>
  );
}
