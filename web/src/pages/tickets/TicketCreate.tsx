import { useState } from 'react';
import { App, Button, Card, Col, Form, Input, Row, Select, Space, Tag, Typography, Upload } from 'antd';
import { InboxOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { applyFieldErrors, errMsg, get, post, uploadFiles } from '@/api';
import { useAuth } from '@/auth';
import { PageHead, StaffSelect } from '@/components/common';
import { DynamicFields } from '@/components/DynamicForm';
import { CustomerSelect, formToItems, OperationSelect, ProductSelect, ServiceInfo, TicketSearchSelect, useServiceLookup } from '@/components/TicketParts';
import { CHANNELS, SEGMENT_LABEL, TASK_LIMITS } from '@shared/constants';
import { fmtSize } from '@/utils';

export function useFileList() {
  const [files, setFiles] = useState<any[]>([]);
  const { message } = App.useApp();
  const props = {
    multiple: true,
    fileList: files,
    beforeUpload: (f: File) => {
      if (f.size > TASK_LIMITS.maxFileSize) {
        message.error(`File "${f.name}" vượt quá 10MB`);
        return Upload.LIST_IGNORE;
      }
      return false;
    },
    onChange: ({ fileList }: any) => {
      if (fileList.length > TASK_LIMITS.maxFiles) message.warning(`Tối đa ${TASK_LIMITS.maxFiles} file`);
      setFiles(fileList.slice(0, TASK_LIMITS.maxFiles));
    },
  };
  return { files: files.map((f) => f.originFileObj as File).filter(Boolean), props, reset: () => setFiles([]) };
}

export default function TicketCreate() {
  const [form] = Form.useForm();
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [customer, setCustomer] = useState<any>(null);
  const productId = Form.useWatch('productId', form);
  const operationId = Form.useWatch('operationId', form);
  const { data: service } = useServiceLookup(productId, operationId);
  const { data: formDef } = useQuery({ queryKey: ['form', service?.formId], queryFn: () => get(`/forms/${service.formId}`), enabled: !!service?.formId });
  const items = service?.formId ? formToItems(formDef) : [];
  const upload = useFileList();

  const submit = async () => {
    let v;
    try {
      v = await form.validateFields();
    } catch (e: any) {
      if (e?.errorFields?.length) form.scrollToField(e.errorFields[0].name, { block: 'center' });
      return;
    }
    setSaving(true);
    try {
      const r = await post('/tickets', { ...v, dynamicValues: v.dyn || {} });
      if (upload.files.length) await uploadFiles(`/tickets/${r.id}/attachments`, upload.files);
      qc.invalidateQueries();
      message.success(`Tạo phiếu ${r.code} thành công`);
      nav(`/tickets/${r.id}`);
    } catch (e) {
      if (!applyFieldErrors(form, e)) modal.error({ title: 'Không tạo được phiếu', content: errMsg(e) });
      else message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Tạo phiếu"
        sub="Chọn Sản phẩm + Nghiệp vụ để hệ thống áp dụng dịch vụ, quy trình và mẫu nhập liệu tương ứng"
        extra={
          <>
            <Button onClick={() => nav(-1)}>Hủy</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={submit}>
              Tạo phiếu
            </Button>
          </>
        }
      />
      <Form form={form} layout="vertical" initialValues={{ channel: 'COUNTER', ownerId: user?.id, dyn: {} }} scrollToFirstError>
        <Row gutter={16}>
          <Col xs={24} xl={16}>
            <Card title="Thông tin chung" style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item name="customerId" label="Khách hàng">
                    <CustomerSelect onChange={(v, c) => (form.setFieldValue('customerId', v), setCustomer(c ?? null))} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="channel" label="Kênh" rules={[{ required: true, message: 'Vui lòng chọn kênh' }]}>
                    <Select options={CHANNELS} />
                  </Form.Item>
                </Col>
                {customer && (
                  <Col span={24} style={{ marginTop: -8, marginBottom: 12 }}>
                    <Space wrap size={[16, 4]} className="muted" style={{ fontSize: 13 }}>
                      <span>
                        Phân khúc: <Tag color="geekblue">{SEGMENT_LABEL[customer.segment]}</Tag>
                      </span>
                      <span>SĐT: {customer.phone}</span>
                      <span>Email: {customer.email}</span>
                      <span>Giấy tờ: {customer.idNumber}</span>
                    </Space>
                  </Col>
                )}
                <Col xs={24} md={12}>
                  <Form.Item name="productId" label="Sản phẩm" rules={[{ required: true, message: 'Vui lòng chọn sản phẩm' }]}>
                    <ProductSelect onChange={(v) => form.setFieldsValue({ productId: v, operationId: undefined })} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="operationId" label="Nghiệp vụ" rules={[{ required: true, message: 'Vui lòng chọn nghiệp vụ' }]}>
                    <OperationSelect productId={productId} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="ownerId" label="Người phụ trách phiếu" rules={[{ required: true, message: 'Vui lòng chọn người phụ trách' }]}>
                    <StaffSelect anyDepartment />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="linkedTicketIds" label="Mã phiếu liên kết">
                    <TicketSearchSelect />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item name="description" label="Mô tả / Nội dung yêu cầu">
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} placeholder="Mô tả nội dung cần xử lý" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
            {items.length > 0 && (
              <Card title={`Thông tin nhập liệu – ${service?.formName ?? ''}`} style={{ marginBottom: 16 }}>
                <DynamicFields items={items} form={form} ticketOnly customerId={customer?.id} />
              </Card>
            )}
            <Card title="Đính kèm file" style={{ marginBottom: 16 }}>
              <Upload.Dragger {...upload.props}>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">Kéo thả hoặc bấm để chọn file</p>
                <p className="ant-upload-hint">
                  Tối đa {TASK_LIMITS.maxFiles} file, mỗi file ≤ {fmtSize(TASK_LIMITS.maxFileSize)}
                </p>
              </Upload.Dragger>
            </Card>
          </Col>
          <Col xs={24} xl={8}>
            <Card title="Dịch vụ áp dụng" style={{ position: 'sticky', top: 80 }}>
              <ServiceInfo service={service} segment={customer?.segment} hasCustomer={!!customer} />
              {productId && operationId && service === null && (
                <Typography.Text type="danger">Chưa có dịch vụ đang sử dụng cho Sản phẩm + Nghiệp vụ này.</Typography.Text>
              )}
              <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12, marginBottom: 0 }}>
                Mã phiếu sinh tự động theo quy tắc P + yymmdd + xxxxx. Trạng thái: <b>Đang xử lý</b> nếu bạn là người phụ trách, ngược lại là <b>Mới</b>. Tác vụ của công việc đầu tiên
                được sinh tự động ngay khi tạo phiếu.
              </Typography.Paragraph>
            </Card>
          </Col>
        </Row>
      </Form>
    </div>
  );
}
