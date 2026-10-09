import { useState } from 'react';
import { Alert, App, Form, Modal } from 'antd';
import { applyFieldErrors, errMsg } from '@/api';
import { DeptTreeSelect, StaffSelect } from './common';

export default function BatchUpdateModal({
  open,
  onClose,
  title,
  description,
  submit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  submit: (v: { departmentId: number; assigneeId: number }) => Promise<{ updated: number; skipped: string[]; total: number }>;
}) {
  const [form] = Form.useForm();
  const { message, modal } = App.useApp();
  const [loading, setLoading] = useState(false);
  const deptId = Form.useWatch('departmentId', form);

  const ok = async () => {
    const v = await form.validateFields();
    setLoading(true);
    try {
      const r = await submit(v);
      message.success(`Đã cập nhật ${r.updated}/${r.total} tác vụ`);
      if (r.skipped?.length)
        modal.info({ title: 'Một số tác vụ không được cập nhật', content: `Bỏ qua do trạng thái không cho phép: ${r.skipped.join(', ')}` });
      form.resetFields();
      onClose();
    } catch (e) {
      if (!applyFieldErrors(form, e)) message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title={title} onCancel={onClose} onOk={ok} okText="Cập nhật" cancelText="Hủy" confirmLoading={loading} destroyOnClose>
      <Alert type="info" showIcon message={description} style={{ marginBottom: 16 }} />
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="departmentId" label="Phòng ban chuyên xử lý" rules={[{ required: true, message: 'Vui lòng chọn phòng ban' }]}>
          <DeptTreeSelect onChange={(v) => form.setFieldsValue({ departmentId: v, assigneeId: null })} />
        </Form.Item>
        <Form.Item name="assigneeId" label="Nhân sự chuyên xử lý" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
          <StaffSelect departmentId={deptId} onChange={(v, u) => form.setFieldsValue({ assigneeId: v, ...(u ? { departmentId: u.departmentId } : {}) })} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
