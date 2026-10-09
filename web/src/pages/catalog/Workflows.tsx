import { App, Button, Card, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { del, errMsg, get } from '@/api';
import { useAuth } from '@/auth';
import { ActiveTag, PageHead } from '@/components/common';
import { WORK_HOURS_LABEL } from '@shared/constants';
import { formatSla, WorkHoursMode } from '@shared/sla';

export default function Workflows() {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: ['workflows'], queryFn: () => get('/workflows') });
  return (
    <div className="page">
      <PageHead
        title="Quy trình"
        sub="Chuỗi các công việc có thứ tự; mỗi công việc có SLA, phòng ban xử lý, kết quả và hướng rẽ nhánh"
        extra={
          isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/catalog/workflows/new')}>
              Thêm quy trình
            </Button>
          )
        }
      />
      <Card styles={{ body: { padding: 16 } }}>
        <Table
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={data}
          onRow={(r: any) => ({ onClick: () => nav(`/catalog/workflows/${r.id}`), className: 'clickable-row' })}
          columns={[
            { title: 'Mã', dataIndex: 'code', render: (v) => <b className="mono">{v}</b> },
            {
              title: 'Tên quy trình',
              dataIndex: 'name',
              render: (v, r: any) => (
                <div>
                  <div>{v}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {r.stepNames.join(' → ')}
                  </Typography.Text>
                </div>
              ),
            },
            { title: 'Giờ làm việc', dataIndex: 'workHoursMode', render: (v) => <Tag color={v === 'H24' ? 'magenta' : 'blue'}>{WORK_HOURS_LABEL[v]}</Tag> },
            { title: 'Số công việc', dataIndex: 'stepCount', align: 'center' },
            { title: 'SLA tổng', dataIndex: 'slaMinutes', render: (v, r: any) => formatSla(v, r.workHoursMode as WorkHoursMode) },
            { title: 'Dịch vụ áp dụng', dataIndex: 'serviceCount', align: 'center' },
            { title: 'Trạng thái', dataIndex: 'active', render: (v) => <ActiveTag active={v} /> },
            ...(isAdmin
              ? [
                  {
                    title: '',
                    width: 90,
                    render: (_: any, r: any) => (
                      <Space size={0} onClick={(e) => e.stopPropagation()}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => nav(`/catalog/workflows/${r.id}`)} />
                        <Popconfirm
                          title="Xóa quy trình?"
                          okText="Xóa"
                          cancelText="Hủy"
                          onConfirm={async () => {
                            try {
                              await del(`/workflows/${r.id}`);
                              qc.invalidateQueries({ queryKey: ['workflows'] });
                            } catch (e) {
                              message.error(errMsg(e));
                            }
                          }}
                        >
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
    </div>
  );
}
