import { useState } from 'react';
import { App, Button, Card, Col, Form, Input, Modal, Popconfirm, Radio, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { applyFieldErrors, del, errMsg, get, post, put } from '@/api';
import { useAuth } from '@/auth';
import { ActiveTag, PageHead } from '@/components/common';
import { CHOICE_TYPES, DATA_TYPES, DISPLAY_TYPE_LABELS, VIEW360_SOURCES } from '@shared/form';

const dtLabel = (v: string) => DATA_TYPES.find((d) => d.value === v)?.label ?? v;

export default function Fields() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<any>(null);
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: ['fields'], queryFn: () => get('/fields') });
  const dataType = Form.useWatch('dataType', form);
  const infoType = Form.useWatch('infoType', form);
  const displays = DATA_TYPES.find((d) => d.value === dataType)?.displays ?? [];

  const open = (rec: any) => {
    setEditing(rec);
    form.resetFields();
    form.setFieldsValue(
      rec.id ? { ...rec } : { infoType: 'INPUT', dataType: 'TEXT', displayType: 'TEXTBOX', required: false, showOnTicket: true, active: true, options: [] },
    );
  };

  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing.id) await put(`/fields/${editing.id}`, v);
      else await post('/fields', v);
      message.success('Đã lưu trường nhập liệu');
      qc.invalidateQueries({ queryKey: ['fields'] });
      setEditing(null);
    } catch (e) {
      if (!applyFieldErrors(form, e)) message.error(errMsg(e));
    }
  };

  const list = data.filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()) || f.code.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <PageHead
        title="Trường nhập liệu"
        sub="Đơn vị cấu hình nhỏ nhất mô tả một thông tin động trên phiếu"
        extra={
          isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => open({})}>
              Thêm trường
            </Button>
          )
        }
      />
      <Card styles={{ body: { padding: 16 } }}>
        <Input.Search placeholder="Tìm theo mã / tên" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 300, marginBottom: 16 }} />
        <Table
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={list}
          scroll={{ x: 1100 }}
          columns={[
            { title: 'Mã trường', dataIndex: 'code', render: (v) => <span className="mono">{v}</span> },
            { title: 'Tên trường', dataIndex: 'name', render: (v) => <b>{v}</b> },
            {
              title: 'Loại thông tin',
              dataIndex: 'infoType',
              render: (v, r: any) =>
                v === 'VIEW360' ? (
                  <Space direction="vertical" size={0}>
                    <Tag color="cyan">360 view</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {VIEW360_SOURCES.find((s) => s.value === r.view360Source)?.label}
                    </Typography.Text>
                  </Space>
                ) : (
                  <Tag>Nhập</Tag>
                ),
            },
            { title: 'Kiểu dữ liệu', dataIndex: 'dataType', render: dtLabel },
            { title: 'Kiểu hiển thị', dataIndex: 'displayType', render: (v) => (DISPLAY_TYPE_LABELS as any)[v] },
            { title: 'Bắt buộc', dataIndex: 'required', align: 'center', render: (v) => (v ? <Tag color="red">Có</Tag> : 'Không') },
            { title: 'Hiển thị trên Phiếu', dataIndex: 'showOnTicket', align: 'center', render: (v) => (v ? <Tag color="blue">Có</Tag> : 'Không') },
            { title: 'Trạng thái', dataIndex: 'active', render: (v) => <ActiveTag active={v} /> },
            { title: 'Dùng ở', dataIndex: 'formCount', render: (v) => `${v} mẫu` },
            ...(isAdmin
              ? [
                  {
                    title: '',
                    width: 90,
                    render: (_: any, r: any) => (
                      <Space size={0}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => open(r)} />
                        <Popconfirm
                          title="Xóa trường này?"
                          okText="Xóa"
                          cancelText="Hủy"
                          onConfirm={async () => {
                            try {
                              await del(`/fields/${r.id}`);
                              qc.invalidateQueries({ queryKey: ['fields'] });
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

      <Modal open={!!editing} title={editing?.id ? 'Sửa trường nhập liệu' : 'Thêm trường nhập liệu'} width={720} onCancel={() => setEditing(null)} onOk={save} okText="Lưu" cancelText="Hủy" destroyOnClose>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={10}>
              <Form.Item name="code" label="Mã trường" rules={[{ required: true, message: 'Nhập mã trường' }]}>
                <Input disabled={!!editing?.id} placeholder="VD: SO_THE" style={{ textTransform: 'uppercase' }} />
              </Form.Item>
            </Col>
            <Col span={14}>
              <Form.Item name="name" label="Tên trường" rules={[{ required: true, message: 'Nhập tên trường' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="infoType" label="Loại thông tin" extra="360 view: cho phép copy dữ liệu từ trường ánh xạ (tài khoản / thẻ / giao dịch / thông tin KH) khi tạo phiếu">
                <Radio.Group
                  options={[
                    { value: 'INPUT', label: 'Nhập' },
                    { value: 'VIEW360', label: '360 view' },
                  ]}
                  onChange={(e) => e.target.value === 'VIEW360' && form.setFieldsValue({ dataType: 'TEXT', displayType: 'TEXTBOX' })}
                />
              </Form.Item>
            </Col>
            {infoType === 'VIEW360' && (
              <Col span={24}>
                <Form.Item name="view360Source" label="Trường ánh xạ 360 view" rules={[{ required: true, message: 'Chọn trường ánh xạ' }]}>
                  <Select options={VIEW360_SOURCES} />
                </Form.Item>
              </Col>
            )}
            <Col span={12}>
              <Form.Item name="dataType" label="Kiểu dữ liệu" rules={[{ required: true }]}>
                <Select
                  disabled={!!editing?.formCount}
                  options={DATA_TYPES.filter((d) => infoType !== 'VIEW360' || ['TEXT', 'NUMBER'].includes(d.value)).map((d) => ({ value: d.value, label: d.label }))}
                  onChange={(v) => form.setFieldsValue({ displayType: DATA_TYPES.find((d) => d.value === v)!.displays[0] })}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="displayType" label="Kiểu hiển thị" rules={[{ required: true }]}>
                <Select options={displays.map((d) => ({ value: d, label: DISPLAY_TYPE_LABELS[d] }))} />
              </Form.Item>
            </Col>
            {CHOICE_TYPES.includes(dataType) && (
              <Col span={24}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>Danh sách giá trị lựa chọn</div>
                <Form.List name="options">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map((f) => (
                        <Space key={f.key} align="baseline" style={{ display: 'flex' }}>
                          <Form.Item name={[f.name, 'value']} rules={[{ required: true, message: 'Nhập mã' }]}>
                            <Input placeholder="Mã giá trị" style={{ width: 200 }} />
                          </Form.Item>
                          <Form.Item name={[f.name, 'label']} rules={[{ required: true, message: 'Nhập nhãn' }]}>
                            <Input placeholder="Nhãn hiển thị" style={{ width: 320 }} />
                          </Form.Item>
                          <MinusCircleOutlined onClick={() => remove(f.name)} />
                        </Space>
                      ))}
                      <Form.Item name="__opt" style={{ marginBottom: 8 }}>
                        <Button type="dashed" onClick={() => add({ value: '', label: '' })} icon={<PlusOutlined />}>
                          Thêm giá trị
                        </Button>
                      </Form.Item>
                    </>
                  )}
                </Form.List>
              </Col>
            )}
            <Col span={24}>
              <Form.Item name="placeholder" label="Gợi ý nhập (placeholder)">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="required" label="Trường bắt buộc" valuePropName="checked">
                <Switch checkedChildren="Có" unCheckedChildren="Không" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="showOnTicket" label="Hiển thị trên Phiếu" valuePropName="checked">
                <Switch checkedChildren="Có" unCheckedChildren="Không" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="active" label="Sử dụng" valuePropName="checked">
                <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
