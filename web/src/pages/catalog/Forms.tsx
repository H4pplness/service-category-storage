import { App, Button, Card, Popconfirm, Space, Table, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { del, errMsg, get } from '@/api';
import { useAuth } from '@/auth';
import { ActiveTag, PageHead } from '@/components/common';
import { fmtDateTime } from '@/utils';

export default function Forms() {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: ['forms'], queryFn: () => get('/forms') });
  return (
    <div className="page">
      <PageHead
        title="Mẫu nhập liệu"
        sub="Kho form ghép từ các trường nhập liệu, quy định các trường thông tin động của phiếu / công việc"
        extra={
          isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/catalog/forms/new')}>
              Thêm mẫu nhập liệu
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
          onRow={(r: any) => ({ onClick: () => nav(`/catalog/forms/${r.id}`), className: 'clickable-row' })}
          columns={[
            { title: 'Mã mẫu', dataIndex: 'code', render: (v) => <b className="mono">{v}</b> },
            { title: 'Tên mẫu nhập liệu', dataIndex: 'name' },
            { title: 'Mô tả', dataIndex: 'description', render: (v) => <Typography.Text type="secondary">{v}</Typography.Text> },
            { title: 'Số trường', dataIndex: 'itemCount', align: 'center' },
            { title: 'Sử dụng', render: (_, r: any) => `${r.serviceCount} dịch vụ · ${r.stepCount} công việc` },
            { title: 'Trạng thái', dataIndex: 'active', render: (v) => <ActiveTag active={v} /> },
            { title: 'Cập nhật', dataIndex: 'updatedAt', render: fmtDateTime },
            ...(isAdmin
              ? [
                  {
                    title: '',
                    width: 90,
                    render: (_: any, r: any) => (
                      <Space size={0} onClick={(e) => e.stopPropagation()}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => nav(`/catalog/forms/${r.id}`)} />
                        <Popconfirm
                          title="Xóa mẫu nhập liệu?"
                          description="Chỉ xóa được khi mẫu không nằm trong dịch vụ/công việc đang hoạt động."
                          okText="Xóa"
                          cancelText="Hủy"
                          onConfirm={async () => {
                            try {
                              await del(`/forms/${r.id}`);
                              message.success('Đã xóa');
                              qc.invalidateQueries({ queryKey: ['forms'] });
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
