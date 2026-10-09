import { useMemo, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Switch, Table, Tag, Tooltip, TreeSelect, Typography } from 'antd';
import { CloudSyncOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { applyFieldErrors, del, errMsg, get, post, put } from '@/api';
import { useAuth } from '@/auth';
import { ActiveTag, PageHead } from '@/components/common';
import { buildTree } from '@/utils';

const LABEL = { products: 'Sản phẩm', operations: 'Nghiệp vụ' };

export default function CatalogTree({ kind }: { kind: 'products' | 'operations' }) {
  const label = LABEL[kind];
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: [kind], queryFn: () => get(`/${kind}`) });

  const tree = useMemo(() => {
    if (!q) return buildTree(data);
    const s = q.toLowerCase();
    const hit = new Set<number>();
    for (const r of data)
      if (r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s)) {
        let cur: any = r;
        while (cur) {
          hit.add(cur.id);
          cur = data.find((x) => x.id === cur.parentId);
        }
      }
    return buildTree(data.filter((r) => hit.has(r.id)));
  }, [data, q]);

  const parentTree = useMemo(() => {
    const conv = (n: any): any => ({ value: n.id, title: `${n.name} (${n.code})`, disabled: n.level >= 3 || n.serviceCount > 0, children: n.children?.map(conv) });
    return buildTree(data).map(conv);
  }, [data]);

  const open = (rec: any) => {
    setEditing(rec);
    form.resetFields();
    form.setFieldsValue(rec.id ? rec : { active: true, sortOrder: 0, parentId: rec.parentId ?? undefined });
  };

  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing.id) await put(`/${kind}/${editing.id}`, v);
      else await post(`/${kind}`, v);
      message.success('Đã lưu');
      qc.invalidateQueries({ queryKey: [kind] });
      setEditing(null);
    } catch (e) {
      if (!applyFieldErrors(form, e)) message.error(errMsg(e));
    }
  };

  const sync = async () => {
    try {
      const r = await post('/products/sync-t24');
      modal.success({ title: 'Đồng bộ T24 hoàn tất', content: `Bảng MB.TBL.SANPHAM.KEY: thêm mới ${r.created}, cập nhật ${r.updated} / ${r.total} bản ghi.` });
      qc.invalidateQueries({ queryKey: [kind] });
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div className="page">
      <PageHead
        title={`Danh mục ${label}`}
        sub={
          kind === 'products'
            ? 'Cấu trúc phân cấp cha – con (level 1 → 3), đồng bộ từ hệ thống lõi T24. Khi tạo phiếu phải chọn tới level cuối cùng.'
            : 'Các thao tác/nghiệp vụ cụ thể, phân cấp cha – con. Khi tạo phiếu phải chọn tới level cuối cùng.'
        }
        extra={
          isAdmin && (
            <>
              {kind === 'products' && (
                <Button icon={<CloudSyncOutlined />} onClick={sync}>
                  Đồng bộ T24
                </Button>
              )}
              <Button type="primary" icon={<PlusOutlined />} onClick={() => open({})}>
                Thêm {label.toLowerCase()}
              </Button>
            </>
          )
        }
      />
      <Card styles={{ body: { padding: 16 } }}>
        <Input.Search placeholder="Tìm theo mã hoặc tên" allowClear onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} style={{ width: 300, marginBottom: 16 }} />
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={tree}
          pagination={false}
          size="middle"
          expandable={{ defaultExpandAllRows: true }}
          key={`${q}-${data.length}`}
          columns={[
            { title: 'Tên', dataIndex: 'name', render: (v, r: any) => <span style={{ fontWeight: r.level === 1 ? 600 : 400 }}>{v}</span> },
            { title: 'Mã', dataIndex: 'code', render: (v) => <span className="mono">{v}</span> },
            { title: 'Level', dataIndex: 'level', width: 80, align: 'center' },
            ...(kind === 'products' ? [{ title: 'Nguồn', dataIndex: 'source', width: 100, render: (v: string) => (v === 'T24' ? <Tag color="cyan">T24</Tag> : <Tag>Thủ công</Tag>) }] : []),
            { title: 'Trạng thái', dataIndex: 'active', width: 140, render: (v) => <ActiveTag active={v} /> },
            {
              title: 'Sử dụng',
              width: 160,
              render: (_, r: any) => (
                <Typography.Text type="secondary">
                  {r.serviceCount} dịch vụ · {r.ticketCount} phiếu
                </Typography.Text>
              ),
            },
            ...(isAdmin
              ? [
                  {
                    title: '',
                    width: 130,
                    render: (_: any, r: any) => (
                      <Space size={0}>
                        {r.level < 3 && r.serviceCount === 0 && (
                          <Tooltip title="Thêm cấp con">
                            <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => open({ parentId: r.id })} />
                          </Tooltip>
                        )}
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => open(r)} />
                        <Popconfirm
                          title={`Xóa ${label.toLowerCase()} "${r.name}"?`}
                          okText="Xóa"
                          cancelText="Hủy"
                          onConfirm={async () => {
                            try {
                              await del(`/${kind}/${r.id}`);
                              qc.invalidateQueries({ queryKey: [kind] });
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
      <Modal open={!!editing} title={editing?.id ? `Sửa ${label.toLowerCase()}` : `Thêm ${label.toLowerCase()}`} onCancel={() => setEditing(null)} onOk={save} okText="Lưu" cancelText="Hủy" destroyOnClose>
        <Form form={form} layout="vertical">
          {!editing?.id && (
            <Form.Item name="parentId" label={`${label} cha`} extra="Để trống nếu là level 1">
              <TreeSelect treeData={parentTree} allowClear treeDefaultExpandAll showSearch treeNodeFilterProp="title" placeholder="Chọn cấp cha" />
            </Form.Item>
          )}
          <Form.Item name="code" label="Mã" rules={[{ required: true, message: 'Vui lòng nhập mã' }]}>
            <Input disabled={!!editing?.id} placeholder="VD: THE.TD.VISA" style={{ textTransform: 'uppercase' }} />
          </Form.Item>
          <Form.Item name="name" label="Tên" rules={[{ required: true, message: 'Vui lòng nhập tên' }]}>
            <Input />
          </Form.Item>
          <Space size={32}>
            <Form.Item name="sortOrder" label="Thứ tự">
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item name="active" label="Sử dụng" valuePropName="checked">
              <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
