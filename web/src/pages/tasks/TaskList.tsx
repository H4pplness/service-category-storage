import { useState } from 'react';
import { Button, Card, Input, Segmented, Select, Space, Switch, Table, Typography } from 'antd';
import { EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '@/api';
import { PageHead, SlaInfo, TaskStatusTag } from '@/components/common';
import BatchUpdateModal from '@/components/BatchUpdateModal';
import { TaskProcessModal } from '@/components/TaskModals';
import { fmtDateTime } from '@/utils';
import { TASK_STATUS } from '@shared/constants';

export default function TaskList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const [f, setF] = useState<any>({ scope: 'assigned', status: [], q: '', overdue: sp.get('overdue') === 'true', open: true, page: 1, pageSize: 20 });
  const [selected, setSelected] = useState<number[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const set = (p: any) => setF((x: any) => ({ ...x, ...p, page: 1 }));
  const params = {
    scope: f.scope,
    status: f.status.length ? f.status.join(',') : undefined,
    q: f.q || undefined,
    overdue: f.overdue ? 'true' : undefined,
    open: f.open ? 'true' : undefined,
    page: f.page,
    pageSize: f.pageSize,
  };
  const { data, isFetching, refetch } = useQuery({ queryKey: ['tasks', params], queryFn: () => get('/tasks', params) });

  return (
    <div className="page">
      <PageHead
        title="Tác vụ"
        sub="Tác vụ được phân giao, xử lý trực tiếp hoặc cập nhật theo lô"
        extra={
          <Button icon={<EditOutlined />} disabled={!selected.length} onClick={() => setBatchOpen(true)}>
            Cập nhật theo lô {selected.length ? `(${selected.length})` : ''}
          </Button>
        }
      />
      <Card styles={{ body: { padding: 16 } }}>
        <Space wrap style={{ marginBottom: 16 }} size={[12, 12]}>
          <Segmented
            value={f.scope}
            onChange={(v) => set({ scope: v })}
            options={[
              { value: 'assigned', label: 'Giao cho tôi' },
              { value: 'created', label: 'Tôi tạo' },
              { value: 'department', label: 'Phòng ban của tôi' },
              { value: 'all', label: 'Tất cả' },
            ]}
          />
          <Input.Search placeholder="Mã tác vụ, mã phiếu, công việc" allowClear style={{ width: 260 }} onSearch={(v) => set({ q: v })} />
          <Select
            mode="multiple"
            placeholder="Trạng thái"
            style={{ minWidth: 220 }}
            value={f.status}
            onChange={(v) => set({ status: v })}
            options={Object.entries(TASK_STATUS).map(([k, s]) => ({ value: k, label: s.label }))}
            allowClear
          />
          <Space>
            <Switch checked={f.open} onChange={(v) => set({ open: v })} /> Chưa hoàn thành
          </Space>
          <Space>
            <Switch checked={f.overdue} onChange={(v) => set({ overdue: v })} /> Quá hạn
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
        </Space>
        <Table
          rowKey="id"
          size="middle"
          loading={isFetching}
          dataSource={data?.items ?? []}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (k) => setSelected(k as number[]),
            getCheckboxProps: (r: any) => ({ disabled: !['NEW', 'IN_PROGRESS', 'RETURNED'].includes(r.status) }),
            preserveSelectedRowKeys: true,
          }}
          onRow={(r: any) => ({ onClick: () => setTaskId(r.id), className: 'clickable-row' })}
          scroll={{ x: 1500 }}
          pagination={{
            current: f.page,
            pageSize: f.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (t) => `${t} tác vụ`,
            onChange: (page, pageSize) => setF((x: any) => ({ ...x, page, pageSize })),
          }}
          columns={[
            { title: 'Mã tác vụ', dataIndex: 'code', width: 150, render: (v) => <b className="mono">{v}</b> },
            {
              title: 'Công việc',
              dataIndex: 'stepName',
              render: (v, r: any) => (
                <div>
                  <div>{v}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Phiếu{' '}
                    <a
                      onClick={(e) => {
                        e.stopPropagation();
                        nav(`/tickets/${r.ticketId}`);
                      }}
                    >
                      {r.ticketCode}
                    </a>{' '}
                    · {r.customerName ?? '—'}
                  </Typography.Text>
                </div>
              ),
            },
            { title: 'Nhân sự xử lý', dataIndex: 'assigneeName' },
            { title: 'Phòng ban xử lý', dataIndex: 'departmentName' },
            { title: 'Trạng thái', dataIndex: 'status', render: (s) => <TaskStatusTag status={s} /> },
            { title: 'Người tạo', dataIndex: 'creatorName' },
            { title: 'Thời hạn', dataIndex: 'dueAt', render: fmtDateTime },
            {
              title: 'Sớm / Trễ',
              width: 210,
              render: (_, r: any) => <SlaInfo mode={r.workHoursMode} startAt={r.createdAt} dueAt={r.dueAt} completedAt={r.completedAt} slaMinutes={r.slaMinutes} compact />,
            },
          ]}
        />
      </Card>
      <BatchUpdateModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title={`Cập nhật theo lô – ${selected.length} tác vụ`}
        description="Các tác vụ đã chọn sẽ được chuyển cho phòng ban/nhân sự mới. Tác vụ đổi người xử lý sẽ trở về trạng thái Mới."
        submit={async (v) => {
          const r = await post('/tasks/batch-update', { taskIds: selected, ...v });
          setSelected([]);
          qc.invalidateQueries();
          return r;
        }}
      />
      <TaskProcessModal taskId={taskId} open={!!taskId} onClose={() => setTaskId(null)} />
    </div>
  );
}
