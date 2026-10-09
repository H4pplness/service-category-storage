import { useEffect, useState } from 'react';
import { Alert, App, Button, Col, Drawer, Form, Input, Row, Select, Space } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { applyFieldErrors, errMsg, get, put } from '@/api';
import { StaffSelect } from '@/components/common';
import { DynamicFields } from '@/components/DynamicForm';
import { CustomerSelect, formToItems, OperationSelect, ProductSelect, ServiceInfo, TicketSearchSelect, useServiceLookup } from '@/components/TicketParts';
import { CHANNELS } from '@shared/constants';

export default function TicketEditDrawer({ ticket, open, onClose }: { ticket: any; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [segment, setSegment] = useState<string | null>(ticket.segment);
  const productId = Form.useWatch('productId', form);
  const operationId = Form.useWatch('operationId', form);
  const customerId = Form.useWatch('customerId', form);
  const changed = open && !!productId && !!operationId && (productId !== ticket.productId || operationId !== ticket.operationId);
  const { data: service } = useServiceLookup(changed ? productId : undefined, changed ? operationId : undefined);
  const { data: newForm } = useQuery({ queryKey: ['form', service?.formId], queryFn: () => get(`/forms/${service.formId}`), enabled: changed && !!service?.formId });
  const items = changed ? (service?.formId ? formToItems(newForm) : []) : ticket.snapshot?.form?.items ?? [];
  const isDone = ticket.status === 'DONE';

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        channel: ticket.channel,
        customerId: ticket.customerId,
        productId: ticket.productId,
        operationId: ticket.operationId,
        ownerId: ticket.ownerId,
        linkedTicketIds: ticket.linkedTicketIds,
        description: ticket.description,
        exchangeContent: ticket.exchangeContent,
        resolutionSummary: ticket.resolutionSummary,
        dyn: ticket.dynamicValues || {},
      });
      setSegment(ticket.segment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    let v;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    const doSave = async () => {
      setSaving(true);
      try {
        await put(`/tickets/${ticket.id}`, { ...v, customerId: v.customerId ?? null, dynamicValues: v.dyn || {} });
        message.success('Cập nhật phiếu thành công');
        qc.invalidateQueries();
        onClose();
      } catch (e) {
        if (!applyFieldErrors(form, e)) message.error(errMsg(e));
      } finally {
        setSaving(false);
      }
    };
    if (changed)
      modal.confirm({
        title: 'Đổi dịch vụ của phiếu?',
        content: 'Các công việc thuộc dịch vụ cũ sẽ tự động chuyển trạng thái "Hủy" và được hiển thị trong box "Công việc thuộc dịch vụ cũ". Quy trình mới sẽ được áp dụng và sinh tác vụ công việc đầu tiên.',
        okText: 'Đồng ý đổi',
        cancelText: 'Hủy',
        onOk: doSave,
      });
    else doSave();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={880}
      title={`Sửa phiếu ${ticket.code}`}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="primary" loading={saving} onClick={save}>
            Lưu
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical">
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="customerId" label="Khách hàng">
              <CustomerSelect onChange={(v, c) => (form.setFieldValue('customerId', v), setSegment(c?.segment ?? null))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="channel" label="Kênh" rules={[{ required: true }]}>
              <Select options={CHANNELS} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="productId" label="Sản phẩm" rules={[{ required: true, message: 'Vui lòng chọn sản phẩm' }]}>
              <ProductSelect disabled={isDone} onChange={(v) => form.setFieldsValue({ productId: v, operationId: undefined })} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="operationId" label="Nghiệp vụ" rules={[{ required: true, message: 'Vui lòng chọn nghiệp vụ' }]}>
              <OperationSelect productId={productId} disabled={isDone} />
            </Form.Item>
          </Col>
          {changed && (
            <Col span={24}>
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="Bạn đang đổi dịch vụ của phiếu"
                description={<ServiceInfo service={service} segment={segment} hasCustomer={!!customerId} />}
              />
            </Col>
          )}
          <Col xs={24} md={12}>
            <Form.Item name="ownerId" label="Người phụ trách phiếu" rules={[{ required: true, message: 'Vui lòng chọn người phụ trách' }]}>
              <StaffSelect anyDepartment />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="linkedTicketIds" label="Mã phiếu liên kết">
              <TicketSearchSelect excludeId={ticket.id} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item name="description" label="Mô tả / Nội dung yêu cầu">
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
            </Form.Item>
          </Col>
        </Row>
        {items.length > 0 && (
          <>
            <div className="section-title">Thông tin nhập liệu</div>
            <DynamicFields items={items} form={form} ticketOnly customerId={customerId} />
          </>
        )}
        <Form.Item name="exchangeContent" label="Nội dung trao đổi">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
        </Form.Item>
        <Form.Item name="resolutionSummary" label="Tóm tắt cách xử lý">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
