import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, Col, Form, Input, Modal, Popconfirm, Radio, Row, Select, Space, Switch, Table, Tag, TreeSelect, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { del, errMsg, get, post, put } from '@/api';
import { useAuth } from '@/auth';
import { ActiveTag, PageHead } from '@/components/common';
import { useOperations, useProducts } from '@/hooks';
import { pathName, toTreeSelect } from '@/utils';
import { SEGMENTS, SEGMENT_LABEL, WORK_HOURS_LABEL } from '@shared/constants';
import { formatSla, WorkHoursMode } from '@shared/sla';

const SEG_KEYS = ['ALL', ...SEGMENTS.map((s) => s.value)];

function ServiceModal({ editing, onClose }: { editing: any; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { data: products = [] } = useProducts();
  const { data: operations = [] } = useOperations();
  const { data: forms = [] } = useQuery<any[]>({ queryKey: ['forms'], queryFn: () => get('/forms') });
  const { data: workflows = [] } = useQuery<any[]>({ queryKey: ['workflows'], queryFn: () => get('/workflows') });
  const productId = Form.useWatch('productId', form);
  const operationId = Form.useWatch('operationId', form);
  const mode: WorkHoursMode = Form.useWatch('workHoursMode', form) ?? 'OFFICE';
  const segmentMode = Form.useWatch('segmentMode', form) ?? 'ALL';
  const wfs = Form.useWatch('workflows', form) || {};
  const { data: mapped = [] } = useQuery<number[]>({
    queryKey: ['mapped-ops', productId, editing?.id],
    queryFn: () => get('/services/mapped-operations', { productId, excludeServiceId: editing?.id }),
    enabled: !!productId,
  });
  const used = !!editing?.used;

  const productTree = useMemo(() => toTreeSelect(products, { leafOnly: true, activeOnly: true, label: (r) => `${r.name} (${r.code})` }), [products]);
  const opTree = useMemo(
    () => toTreeSelect(operations, { leafOnly: true, activeOnly: true, allow: (r) => !mapped.includes(r.id), label: (r) => `${r.name} (${r.code})` }),
    [operations, mapped],
  );
  const code = (() => {
    const p = products.find((x) => x.id === productId);
    const o = operations.find((x) => x.id === operationId);
    return p && o ? `${p.code}-${o.code}` : '';
  })();
  const wfOptions = workflows.filter((w) => w.active && w.workHoursMode === mode).map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }));
  const slaOf = (wid?: number) => {
    const w = workflows.find((x) => x.id === wid);
    return w ? formatSla(w.slaMinutes, w.workHoursMode) : '';
  };

  const init = editing?.id
    ? {
        productId: editing.productId,
        operationId: editing.operationId,
        formId: editing.formId ?? undefined,
        workHoursMode: editing.workHoursMode,
        active: editing.active,
        segmentMode: editing.segmentMode,
        workflows: Object.fromEntries(editing.workflows.map((w: any) => [w.segment, w.workflowId])),
      }
    : { workHoursMode: 'OFFICE', active: true, segmentMode: 'ALL', workflows: {} };

  const onModeChange = (v: WorkHoursMode) => {
    const hasWf = Object.values(form.getFieldValue('workflows') || {}).some(Boolean);
    if (!hasWf) return form.setFieldsValue({ workHoursMode: v });
    modal.confirm({
      title: `Đổi giờ làm việc sang ${WORK_HOURS_LABEL[v]}?`,
      content: 'Các quy trình và SLA đã chọn sẽ bị xóa do không cùng chế độ giờ làm việc.',
      okText: 'Đồng ý',
      cancelText: 'Hủy',
      onOk: () => form.setFieldsValue({ workHoursMode: v, workflows: Object.fromEntries(SEG_KEYS.map((k) => [k, undefined])) }),
    });
  };

  const save = async () => {
    const v = await form.validateFields();
    try {
      if (editing.id) await put(`/services/${editing.id}`, v);
      else await post('/services', v);
      message.success('Đã lưu dịch vụ');
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['operations'] });
      onClose();
    } catch (e) {
      const fe = (e as any)?.response?.data?.fieldErrors || {};
      const mappedFe = Object.entries(fe).map(([k, m]) => ({ name: k.startsWith('wf_') ? ['workflows', k.slice(3)] : k, errors: [m as string] }));
      if (mappedFe.length) form.setFields(mappedFe as any);
      message.error(errMsg(e));
    }
  };

  return (
    <Modal open title={editing?.id ? `Sửa dịch vụ ${editing.code}` : 'Khai báo dịch vụ'} width={760} onCancel={onClose} onOk={save} okText="Lưu" cancelText="Hủy" destroyOnClose>
      {used && <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Dịch vụ đã được sử dụng tại phiếu: không được đổi Sản phẩm/Nghiệp vụ. Thay đổi cấu hình chỉ áp dụng cho phiếu tạo sau." />}
      <Form form={form} layout="vertical" initialValues={init} preserve={false}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="productId" label="Sản phẩm" rules={[{ required: true, message: 'Chọn sản phẩm' }]}>
              <TreeSelect
                treeData={productTree}
                treeDefaultExpandAll
                showSearch
                treeNodeFilterProp="title"
                disabled={used}
                onChange={(v) => form.setFieldsValue({ productId: v, operationId: undefined })}
                popupMatchSelectWidth={false}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="operationId" label="Nghiệp vụ" rules={[{ required: true, message: 'Chọn nghiệp vụ' }]} extra="Chỉ hiển thị nghiệp vụ chưa được map với sản phẩm đã chọn">
              <TreeSelect treeData={opTree} treeDefaultExpandAll showSearch treeNodeFilterProp="title" disabled={used || !productId} placeholder={productId ? '' : 'Chọn sản phẩm trước'} popupMatchSelectWidth={false} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Mã dịch vụ">
              <Input value={code} disabled placeholder="<mã Sản phẩm>-<mã Nghiệp vụ>" className="mono" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="formId" label="Mẫu nhập liệu">
              <Select allowClear placeholder="Không dùng mẫu nhập liệu" options={forms.filter((f) => f.active).map((f) => ({ value: f.id, label: `${f.name} (${f.code})` }))} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="workHoursMode" label="Giờ làm việc" rules={[{ required: true }]}>
              <Radio.Group
                optionType="button"
                options={[
                  { value: 'OFFICE', label: 'Giờ hành chính' },
                  { value: 'H24', label: '24/7' },
                ]}
                onChange={(e) => {
                  const v = e.target.value;
                  const prev = form.getFieldValue('workHoursMode');
                  form.setFieldsValue({ workHoursMode: prev });
                  onModeChange(v);
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="active" label="Sử dụng" valuePropName="checked">
              <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng sử dụng" />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="segmentMode" label="Quy trình áp dụng theo phân khúc">
              <Radio.Group
                options={[
                  { value: 'ALL', label: 'Tất cả phân khúc' },
                  { value: 'BY_SEGMENT', label: 'Chọn phân khúc' },
                ]}
              />
            </Form.Item>
          </Col>
          {(segmentMode === 'ALL' ? ['ALL'] : SEGMENTS.map((s) => s.value)).map((seg) => (
            <Col span={24} key={seg}>
              <Row gutter={12} align="bottom">
                <Col span={16}>
                  <Form.Item name={['workflows', seg]} label={`Quy trình – ${SEGMENT_LABEL[seg]}`} rules={[{ required: true, message: 'Chọn quy trình' }]}>
                    <Select options={wfOptions} placeholder={`Quy trình ${WORK_HOURS_LABEL[mode]}`} showSearch optionFilterProp="label" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="SLA tham chiếu">
                    <Input value={slaOf(wfs[seg])} disabled />
                  </Form.Item>
                </Col>
              </Row>
            </Col>
          ))}
        </Row>
      </Form>
    </Modal>
  );
}

export default function Services() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [editing, setEditing] = useState<any>(null);
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery<any[]>({ queryKey: ['services'], queryFn: () => get('/services') });
  const { data: products = [] } = useProducts();
  const { data: operations = [] } = useOperations();
  const list = data.filter((s) => !q || `${s.code} ${s.productName} ${s.operationName}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <PageHead
        title="Dịch vụ"
        sub="Liên kết Sản phẩm + Nghiệp vụ với quy trình, SLA, mẫu nhập liệu, giờ làm việc. Phiếu tạo trước khi cập nhật giữ nguyên cấu hình cũ."
        extra={
          isAdmin && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>
              Khai báo dịch vụ
            </Button>
          )
        }
      />
      <Card styles={{ body: { padding: 16 } }}>
        <Input.Search placeholder="Tìm mã dịch vụ, sản phẩm, nghiệp vụ" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 340, marginBottom: 16 }} />
        <Table
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={list}
          scroll={{ x: 1600 }}
          columns={[
            { title: 'Mã dịch vụ', dataIndex: 'code', width: 220, render: (v) => <b className="mono">{v}</b> },
            {
              title: 'Sản phẩm',
              width: 230,
              render: (_, r: any) => (
                <Tooltipish main={r.productName} sub={pathName(products, r.productId)} />
              ),
            },
            { title: 'Nghiệp vụ', width: 230, render: (_, r: any) => <Tooltipish main={r.operationName} sub={pathName(operations, r.operationId)} /> },
            { title: 'Mẫu nhập liệu', dataIndex: 'formName', width: 200, render: (v, r: any) => (v ? `${v} (${r.formCode})` : '—') },
            { title: 'Giờ làm việc', dataIndex: 'workHoursMode', width: 130, render: (v) => <Tag color={v === 'H24' ? 'magenta' : 'blue'}>{WORK_HOURS_LABEL[v]}</Tag> },
            {
              title: 'Quy trình theo phân khúc',
              render: (_, r: any) => (
                <Space direction="vertical" size={2}>
                  {r.workflows
                    .sort((a: any, b: any) => SEG_KEYS.indexOf(a.segment) - SEG_KEYS.indexOf(b.segment))
                    .map((w: any) => (
                      <span key={w.segment} style={{ fontSize: 13 }}>
                        <Tag>{SEGMENT_LABEL[w.segment]}</Tag>
                        {w.workflowName} <Typography.Text type="secondary">· {formatSla(w.slaMinutes, r.workHoursMode)}</Typography.Text>
                      </span>
                    ))}
                </Space>
              ),
            },
            { title: 'Trạng thái', dataIndex: 'active', width: 140, render: (v) => <ActiveTag active={v} /> },
            { title: 'Phiếu', dataIndex: 'ticketCount', align: 'center', width: 70 },
            ...(isAdmin
              ? [
                  {
                    title: '',
                    width: 90,
                    render: (_: any, r: any) => (
                      <Space size={0}>
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditing(r)} />
                        {!r.used && (
                          <Popconfirm
                            title="Xóa dịch vụ?"
                            okText="Xóa"
                            cancelText="Hủy"
                            onConfirm={async () => {
                              try {
                                await del(`/services/${r.id}`);
                                qc.invalidateQueries({ queryKey: ['services'] });
                              } catch (e) {
                                message.error(errMsg(e));
                              }
                            }}
                          >
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        )}
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      {editing && <ServiceModal editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Tooltipish({ main, sub }: { main: string; sub: string }) {
  return (
    <div>
      <div>{main}</div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {sub}
      </Typography.Text>
    </div>
  );
}
