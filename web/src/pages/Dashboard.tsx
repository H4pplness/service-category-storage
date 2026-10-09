import { Button, Card, Col, Empty, Row, Table, Typography } from 'antd';
import { AlertOutlined, ClockCircleOutlined, FileTextOutlined, InboxOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { get } from '@/api';
import { useAuth } from '@/auth';
import { PageHead, SlaInfo, TaskStatusTag, TicketStatusTag } from '@/components/common';
import { fmtDateTime } from '@/utils';
import { TICKET_STATUS } from '@shared/constants';

function Stat({ icon, value, label, bg, fg, onClick }: any) {
  return (
    <div className="card stat-card" style={{ cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <div className="stat-icon" style={{ background: bg, color: fg }}>
        {icon}
      </div>
      <div>
        <div className="stat-value">{value ?? '–'}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => get('/dashboard'), refetchInterval: 30000 });
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';

  return (
    <div className="page">
      <PageHead
        title={`${greet}, ${user?.fullName}`}
        sub="Tổng quan công việc của bạn hôm nay"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/tickets/new')}>
            Tạo phiếu
          </Button>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Stat icon={<InboxOutlined />} value={data?.myOpenTasks} label="Tác vụ đang chờ tôi xử lý" bg="#eef2ff" fg="#4f46e5" onClick={() => nav('/tasks')} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Stat icon={<ClockCircleOutlined />} value={data?.myNearDueTasks} label="Tác vụ sắp đến hạn" bg="#fff7ed" fg="#ea580c" onClick={() => nav('/tasks')} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Stat icon={<WarningOutlined />} value={data?.myOverdueTasks} label="Tác vụ quá hạn" bg="#fef2f2" fg="#dc2626" onClick={() => nav('/tasks?overdue=true')} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Stat icon={<FileTextOutlined />} value={data?.myOwnedOpenTickets} label="Phiếu tôi phụ trách chưa hoàn thành" bg="#f0fdf4" fg="#16a34a" onClick={() => nav('/tickets?scope=owner')} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={15}>
          <Card title="Tác vụ cần xử lý" extra={<a onClick={() => nav('/tasks')}>Xem tất cả</a>} styles={{ body: { padding: 0 } }}>
            <Table
              size="middle"
              loading={isLoading}
              rowKey="id"
              dataSource={data?.tasks ?? []}
              pagination={false}
              locale={{ emptyText: <Empty description="Không có tác vụ nào đang chờ" /> }}
              onRow={(r: any) => ({ onClick: () => nav(`/tickets/${r.ticketId}?task=${r.id}`), className: 'clickable-row' })}
              columns={[
                { title: 'Mã tác vụ', dataIndex: 'code', render: (v) => <b className="mono">{v}</b> },
                {
                  title: 'Công việc',
                  dataIndex: 'stepName',
                  render: (v, r: any) => (
                    <div>
                      <div>{v}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {r.ticketCode} · {r.customerName ?? '—'}
                      </Typography.Text>
                    </div>
                  ),
                },
                { title: 'Trạng thái', dataIndex: 'status', render: (s) => <TaskStatusTag status={s} /> },
                {
                  title: 'Sớm / Trễ',
                  render: (_, r: any) => <SlaInfo mode={r.workHoursMode} startAt={r.createdAt} dueAt={r.dueAt} completedAt={r.completedAt} slaMinutes={r.slaMinutes} compact />,
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="Phiếu toàn hệ thống theo trạng thái" style={{ marginBottom: 16 }}>
            <Row gutter={[12, 12]}>
              {Object.entries(TICKET_STATUS).map(([k, s]) => (
                <Col span={12} key={k}>
                  <div className="card" style={{ padding: '12px 14px', cursor: 'pointer' }} onClick={() => nav(`/tickets?status=${k}`)}>
                    <TicketStatusTag status={k} />
                    <div className="stat-value" style={{ fontSize: 22, marginTop: 6 }}>
                      {data?.ticketsByStatus?.[k] ?? 0}
                    </div>
                    <div className="stat-label">phiếu {s.label.toLowerCase()}</div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
          <Card title="Phiếu gần đây của tôi" styles={{ body: { padding: '8px 16px' } }}>
            {(data?.recentTickets ?? []).length ? (
              (data?.recentTickets ?? []).map((t: any) => (
                <div
                  key={t.id}
                  onClick={() => nav(`/tickets/${t.id}`)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f2f6', cursor: 'pointer' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div>
                      <b className="mono">{t.code}</b> {t.hasAutoGenError && <AlertOutlined style={{ color: '#dc2626' }} title="Có lỗi sinh tác vụ tự động" />}
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t.operationName} · {fmtDateTime(t.createdAt)}
                    </Typography.Text>
                  </div>
                  <TicketStatusTag status={t.status} />
                </div>
              ))
            ) : (
              <Empty description="Chưa có phiếu" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
