import { useMemo, useState } from 'react';
import { Button, Card, Input, Segmented, Select, Space, Switch, Table, Tooltip, TreeSelect, Typography } from 'antd';
import { AlertOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post } from '@/api';
import { PageHead, SlaInfo, TicketStatusTag } from '@/components/common';
import BatchUpdateModal from '@/components/BatchUpdateModal';
import { useProducts } from '@/hooks';
import { fmtDateTime, toTreeSelect } from '@/utils';
import { CHANNEL_LABEL, SEGMENT_LABEL, TICKET_STATUS } from '@shared/constants';

export default function TicketList() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const [filters, setFilters] = useState<any>({
    q: '',
    status: sp.get('status') ? sp.get('status')!.split(',') : [],
    scope: sp.get('scope') ?? 'all',
    overdue: sp.get('overdue') === 'true',
    productId: undefined,
    page: 1,
    pageSize: 20,
  });
  const [selected, setSelected] = useState<number[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const { data: products = [] } = useProducts();
  const productTree = useMemo(() => toTreeSelect(products), [products]);

  const params = {
    q: filters.q || undefined,
    status: filters.status.length ? filters.status.join(',') : undefined,
    scope: filters.scope !== 'all' ? filters.scope : undefined,
    overdue: filters.overdue ? 'true' : undefined,
    productId: filters.productId,
    page: filters.page,
    pageSize: filters.pageSize,
  };
  const { data, isFetching, refetch } = useQuery({ queryKey: ['tickets', params], queryFn: () => get('/tickets', params) });
  const set = (p: any) => setFilters((f: any) => ({ ...f, ...p, page: p.page ?? 1 }));

  return (
    <div className="page">
      <PageHead
        title="Danh sách phiếu"
        sub="Tìm kiếm, theo dõi SLA và cập nhật tác vụ theo lô"
        extra={
          <>
            <Button icon={<EditOutlined />} disabled={!selected.length} onClick={() => setBatchOpen(true)}>
              Cập nhật tác vụ theo lô {selected.length ? `(${selected.length})` : ''}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/tickets/new')}>
              Tạo phiếu
            </Button>
          </>
        }
      />
      <Card styles={{ body: { padding: 16 } }}>
        <Space wrap style={{ marginBottom: 16 }} size={[12, 12]}>
          <Segmented
            value={filters.scope}
            onChange={(v) => set({ scope: v })}
            options={[
              { value: 'all', label: 'Tất cả' },
              { value: 'owner', label: 'Tôi phụ trách' },
              { value: 'created', label: 'Tôi tạo' },
              { value: 'assigned', label: 'Có tác vụ của tôi' },
            ]}
          />
          <Input.Search placeholder="Mã phiếu, tên KH, CIF" allowClear style={{ width: 240 }} onSearch={(v) => set({ q: v })} />
          <Select
            mode="multiple"
            placeholder="Trạng thái"
            style={{ minWidth: 200 }}
            value={filters.status}
            onChange={(v) => set({ status: v })}
            options={Object.entries(TICKET_STATUS).map(([k, s]) => ({ value: k, label: s.label }))}
            allowClear
          />
          <TreeSelect
            placeholder="Sản phẩm"
            style={{ width: 220 }}
            treeData={productTree}
            allowClear
            showSearch
            treeNodeFilterProp="title"
            value={filters.productId}
            onChange={(v) => set({ productId: v })}
            popupMatchSelectWidth={false}
          />
          <Space>
            <Switch checked={filters.overdue} onChange={(v) => set({ overdue: v })} /> Chỉ phiếu quá hạn
          </Space>
          <Tooltip title="Tải lại">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          </Tooltip>
        </Space>
        <Table
          rowKey="id"
          size="middle"
          loading={isFetching}
          dataSource={data?.items ?? []}
          rowSelection={{ selectedRowKeys: selected, onChange: (k) => setSelected(k as number[]), preserveSelectedRowKeys: true }}
          onRow={(r: any) => ({ onClick: () => nav(`/tickets/${r.id}`), className: 'clickable-row' })}
          scroll={{ x: 1650 }}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (t) => `${t} phiếu`,
            onChange: (page, pageSize) => setFilters((f: any) => ({ ...f, page, pageSize })),
          }}
          columns={[
            {
              title: 'Mã phiếu',
              dataIndex: 'code',
              fixed: 'left',
              width: 160,
              render: (v, r: any) => (
                <Space size={4}>
                  <b className="mono">{v}</b>
                  {r.hasAutoGenError && (
                    <Tooltip title="Sinh tác vụ tự động thất bại">
                      <AlertOutlined style={{ color: '#dc2626' }} />
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: 'Sản phẩm / Nghiệp vụ',
              width: 260,
              render: (_, r: any) => (
                <div>
                  <div>{r.productName}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.operationName}
                  </Typography.Text>
                </div>
              ),
            },
            {
              title: 'Khách hàng',
              width: 220,
              render: (_, r: any) =>
                r.customerName ? (
                  <div>
                    <div>{r.customerName}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      CIF {r.customerCif} · {SEGMENT_LABEL[r.segment] ?? ''}
                    </Typography.Text>
                  </div>
                ) : (
                  '—'
                ),
            },
            { title: 'Kênh', dataIndex: 'channel', width: 150, render: (v) => CHANNEL_LABEL[v] ?? v },
            { title: 'Người phụ trách', dataIndex: 'ownerName', width: 160 },
            { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (s) => <TicketStatusTag status={s} /> },
            { title: 'Thời gian tạo', dataIndex: 'createdAt', width: 150, render: fmtDateTime },
            { title: 'Thời hạn', dataIndex: 'dueAt', width: 150, render: fmtDateTime },
            {
              title: 'Sớm / Trễ',
              width: 210,
              render: (_, r: any) => <SlaInfo mode={r.workHoursMode} startAt={r.slaStartAt} dueAt={r.dueAt} completedAt={r.completedAt} slaMinutes={r.slaMinutes} compact />,
            },
            { title: 'Tác vụ', dataIndex: 'taskCount', align: 'center', width: 80 },
          ]}
        />
      </Card>
      <BatchUpdateModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title={`Cập nhật tác vụ theo lô – ${selected.length} phiếu`}
        description="Toàn bộ tác vụ đang mở (Mới / Đang xử lý / Trả lại xử lý) của các phiếu đã chọn sẽ được chuyển cho phòng ban/nhân sự mới. Tác vụ đổi người xử lý sẽ trở về trạng thái Mới."
        submit={async (v) => {
          const r = await post('/tickets/batch-update-tasks', { ticketIds: selected, ...v });
          setSelected([]);
          qc.invalidateQueries();
          return r;
        }}
      />
    </div>
  );
}
