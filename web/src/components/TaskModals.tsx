import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Col, Descriptions, Form, Input, Modal, Row, Space, Spin, Tabs, Tag, TreeSelect, Typography, Upload } from 'antd';
import { CheckCircleOutlined, InboxOutlined, RollbackOutlined, SaveOutlined, SendOutlined, UploadOutlined, UserAddOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { applyFieldErrors, del, errMsg, get, post, uploadFiles } from '@/api';
import { useAuth } from '@/auth';
import { useCalendar, useNow } from '@/hooks';
import { buildTree, fmtDateTime, fmtSize } from '@/utils';
import { NOTIFY_CHANNELS, NOTIFY_LABEL, TASK_LIMITS } from '@shared/constants';
import { addDuration, formatSla, slaToMinutes, WorkHoursMode } from '@shared/sla';
import { AttachmentList, DeptTreeSelect, HistoryList, SlaDue, SlaInfo, StaffSelect, TaskStatusTag } from './common';
import { DynamicFields } from './DynamicForm';
import { useFileList } from '@/pages/tickets/TicketCreate';

// ───── Popup tạo tác vụ ─────

export function TaskCreateModal({ ticket, step, open, onClose }: { ticket: any; step: any; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const cal = useCalendar();
  const now = useNow(30000);
  const deptId = Form.useWatch('departmentId', form);
  const upload = useFileList();
  const items = step?.form?.items ?? [];
  const mode = ticket?.workHoursMode as WorkHoursMode;
  const slaMin = step ? slaToMinutes(step.slaDays, step.slaHours, step.slaMinutes, mode) : 0;
  const due = cal && step ? addDuration(mode, cal, now, slaMin) : null;

  useEffect(() => {
    if (open && step) {
      const dyn: any = {};
      for (const it of items) if (ticket.dynamicValues?.[it.code] !== undefined) dyn[it.code] = ticket.dynamicValues[it.code];
      form.resetFields();
      form.setFieldsValue({ departmentId: step.departmentId ?? undefined, assigneeId: undefined, notifyChannels: ['EMAIL'], description: step.description ?? '', dyn });
      upload.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step?.id]);

  const submit = async () => {
    let v;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const r = await post(`/tickets/${ticket.id}/steps/${step.id}/tasks`, { ...v, dynamicValues: v.dyn || {} });
      if (upload.files.length) await uploadFiles(`/tasks/${r.id}/attachments`, upload.files);
      message.success(`Tạo tác vụ ${r.code} thành công`);
      qc.invalidateQueries({ queryKey: ['ticket', String(ticket.id)] });
      qc.invalidateQueries({ queryKey: ['ticket-history'] });
      onClose();
    } catch (e) {
      if (!applyFieldErrors(form, e)) message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Tạo tác vụ"
      width={820}
      okText="Tạo tác vụ"
      cancelText="Hủy"
      onOk={submit}
      confirmLoading={saving}
      destroyOnClose
      styles={{ body: { maxHeight: '70vh', overflow: 'auto', paddingRight: 8 } }}
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="Tên công việc" required>
          <Input value={step?.name} disabled />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="departmentId" label="Phòng ban chuyên xử lý" rules={[{ required: true, message: 'Vui lòng chọn phòng ban' }]}>
              <DeptTreeSelect onChange={(v) => form.setFieldsValue({ departmentId: v ?? undefined, assigneeId: undefined })} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="assigneeId" label="Nhân sự chuyên xử lý" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
              <StaffSelect
                departmentId={deptId}
                onChange={(v, u) => form.setFieldsValue({ assigneeId: v ?? undefined, ...(u ? { departmentId: u.departmentId } : {}) })}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="description" label="Mô tả công việc">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="Thời hạn hoàn thành">
              <div style={{ paddingTop: 4 }}>
                {due ? <b>{fmtDateTime(due)}</b> : '—'}{' '}
                <Typography.Text type="secondary">
                  (SLA {formatSla(slaMin, mode)}, {mode === 'H24' ? '24/7' : 'giờ hành chính'})
                </Typography.Text>
              </div>
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="notifyChannels"
              label="Hình thức thông báo"
              rules={[{ validator: (_, v) => (v?.length ? Promise.resolve() : Promise.reject(new Error('Chọn ít nhất 1 hình thức thông báo'))) }]}
              required
            >
              <Checkbox.Group options={NOTIFY_CHANNELS} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="Đính kèm file">
          <Upload.Dragger {...upload.props} style={{ padding: 4 }}>
            <p style={{ margin: 0 }}>
              <InboxOutlined /> Kéo thả hoặc bấm để chọn file{' '}
              <Typography.Text type="secondary">
                (tối đa {TASK_LIMITS.maxFiles} file, ≤ {fmtSize(TASK_LIMITS.maxFileSize)}/file)
              </Typography.Text>
            </p>
          </Upload.Dragger>
        </Form.Item>
        {items.length > 0 && (
          <>
            <div className="section-title">Thông tin động – {step.form.name}</div>
            <DynamicFields items={items} form={form} customerId={ticket.customerId} />
          </>
        )}
      </Form>
    </Modal>
  );
}

// ───── Popup xử lý tác vụ ─────

function resultTree(results: any[]) {
  const rows = results.map((r) => ({ ...r, id: r.key, parentId: r.parentKey }));
  const conv = (n: any): any => ({
    value: n.key,
    title: n.name,
    key: n.key,
    selectable: !n.children?.length,
    children: n.children?.map(conv),
  });
  return buildTree(rows as any).map(conv);
}

export function TaskProcessModal({ taskId, open, onClose }: { taskId: number | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { message } = App.useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState('process');
  const deptId = Form.useWatch('departmentId', form);
  const { data: t, isLoading, refetch } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => get(`/tasks/${taskId}`, { open: 1 }),
    enabled: open && !!taskId,
    gcTime: 0,
  });
  const { data: history = [] } = useQuery({
    queryKey: ['task-history', taskId, t?.status, t?.resultKey],
    queryFn: () => get(`/tasks/${taskId}/history`),
    enabled: open && !!taskId && tab === 'history',
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['ticket'] });
    qc.invalidateQueries({ queryKey: ['ticket-history'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['task-history'] });
  };

  useEffect(() => {
    if (t) {
      form.setFieldsValue({ departmentId: t.departmentId, assigneeId: t.assigneeId, resultKey: t.resultKey ?? undefined, note: t.note ?? '', dyn: t.dynamicValues || {} });
      qc.invalidateQueries({ queryKey: ['ticket'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => {
    if (open) setTab('process');
  }, [open, taskId]);

  const tree = useMemo(() => resultTree(t?.step?.results ?? []), [t]);
  const items = t?.step?.form?.items ?? [];
  const done = t?.status === 'DONE';
  const readonly = done || t?.step?.cancelled;
  const locked = readonly || t?.status === 'REPORTED_DONE';

  const act = async (action: string) => {
    if (action !== 'RECEIVE') {
      form.setFields([{ name: 'resultKey', errors: [] }]);
      try {
        await form.validateFields(action === 'UPDATE' ? ['departmentId', 'assigneeId'] : undefined);
      } catch {
        return;
      }
      if (['RETURN', 'REPORT_DONE', 'DONE'].includes(action) && !form.getFieldValue('resultKey')) {
        form.setFields([{ name: 'resultKey', errors: ['Vui lòng chọn Kết quả'] }]);
        return;
      }
    }
    const v = form.getFieldsValue(true);
    setBusy(action);
    try {
      await post(`/tasks/${taskId}/action`, {
        action,
        departmentId: v.departmentId,
        assigneeId: v.assigneeId,
        resultKey: v.resultKey ?? null,
        note: v.note,
        dynamicValues: v.dyn || {},
      });
      const labels: Record<string, string> = {
        RECEIVE: 'Nhận tác vụ thành công',
        UPDATE: 'Cập nhật thành công',
        RETURN: 'Đã trả lại xử lý',
        REPORT_DONE: 'Đã báo hoàn thành',
        DONE: 'Tác vụ đã hoàn thành',
      };
      message.success(labels[action]);
      refreshAll();
      if (action === 'RECEIVE') await refetch();
      else onClose();
    } catch (e) {
      if (!applyFieldErrors(form, e)) message.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const addFiles = async (files: File[]) => {
    try {
      await uploadFiles(`/tasks/${taskId}/attachments`, files);
      message.success('Đã bổ sung file');
      refetch();
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const canReceive = !readonly && t && (t.assigneeId !== user?.id || ['NEW', 'RETURNED'].includes(t.status));

  const footer = readonly
    ? [
        <Button key="close" onClick={onClose}>
          Đóng
        </Button>,
      ]
    : [
        <Button key="cancel" onClick={onClose}>
          Hủy
        </Button>,
        canReceive && (
          <Button key="receive" icon={<UserAddOutlined />} loading={busy === 'RECEIVE'} onClick={() => act('RECEIVE')}>
            Nhận tác vụ
          </Button>
        ),
        <Button key="update" icon={<SaveOutlined />} loading={busy === 'UPDATE'} onClick={() => act('UPDATE')}>
          Cập nhật
        </Button>,
        <Button key="return" icon={<RollbackOutlined />} loading={busy === 'RETURN'} onClick={() => act('RETURN')} style={{ color: '#d97706', borderColor: '#fcd34d' }}>
          Trả lại xử lý
        </Button>,
        t?.status !== 'REPORTED_DONE' && (
          <Button key="report" icon={<SendOutlined />} loading={busy === 'REPORT_DONE'} onClick={() => act('REPORT_DONE')}>
            Báo hoàn thành
          </Button>
        ),
        <Button key="done" type="primary" icon={<CheckCircleOutlined />} loading={busy === 'DONE'} onClick={() => act('DONE')}>
          Hoàn thành
        </Button>,
      ].filter(Boolean);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={980}
      footer={tab === 'process' ? footer : null}
      destroyOnClose
      title={
        t ? (
          <Space wrap>
            <span>Xử lý tác vụ</span>
            <b className="mono">{t.code}</b>
            <TaskStatusTag status={t.status} />
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              Phiếu {t.ticket.code}
            </Typography.Text>
          </Space>
        ) : (
          'Xử lý tác vụ'
        )
      }
      styles={{ body: { maxHeight: '72vh', overflow: 'auto', paddingRight: 8 } }}
    >
      {isLoading || !t ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'process',
              label: 'Thông tin xử lý',
              children: (
                <>
                  {t.step.cancelled && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Công việc của tác vụ đã bị Hủy do phiếu thay đổi dịch vụ – tác vụ chỉ còn xem." />}
                  <Descriptions
                    size="small"
                    bordered
                    column={{ xs: 1, md: 2 }}
                    style={{ marginBottom: 16 }}
                    items={[
                      { key: 'n', label: 'Tên công việc', children: <b>{t.step.name}</b>, span: 2 },
                      { key: 'd', label: 'Mô tả công việc', children: t.description || '—', span: 2 },
                      ...(t.step.expectedResult ? [{ key: 'e', label: 'Kết quả mong đợi', children: t.step.expectedResult, span: 2 }] : []),
                      { key: 'due', label: 'Thời hạn hoàn thành', children: <SlaDue dueAt={t.dueAt} slaMinutes={t.slaMinutes} mode={t.workHoursMode} /> },
                      {
                        key: 'sla',
                        label: 'Thời gian hoàn thành',
                        children: (
                          <Space direction="vertical" size={0}>
                            <SlaInfo mode={t.workHoursMode} startAt={t.createdAt} dueAt={t.dueAt} completedAt={t.completedAt} slaMinutes={t.slaMinutes} />
                            {t.completedAt && <Typography.Text type="secondary">Hoàn thành lúc {fmtDateTime(t.completedAt)}</Typography.Text>}
                          </Space>
                        ),
                      },
                      { key: 'st', label: 'Trạng thái', children: <TaskStatusTag status={t.status} /> },
                      { key: 'cr', label: 'Người tạo', children: `${t.creatorName ?? 'Hệ thống'} · ${fmtDateTime(t.createdAt)}` },
                      { key: 'nt', label: 'Hình thức thông báo', children: t.notifyChannels.map((c: string) => <Tag key={c}>{NOTIFY_LABEL[c]}</Tag>) },
                      { key: 'kh', label: 'Khách hàng', children: t.ticket.customerName ?? '—' },
                    ]}
                  />
                  <Form form={form} layout="vertical" disabled={readonly}>
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item name="departmentId" label="Phòng ban chuyên xử lý" rules={[{ required: true, message: 'Vui lòng chọn phòng ban' }]}>
                          <DeptTreeSelect disabled={locked} onChange={(v) => form.setFieldsValue({ departmentId: v ?? undefined, assigneeId: undefined })} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="assigneeId" label="Nhân sự chuyên xử lý" rules={[{ required: true, message: 'Vui lòng chọn nhân sự' }]}>
                          <StaffSelect
                            disabled={locked}
                            departmentId={deptId}
                            onChange={(v, u) => form.setFieldsValue({ assigneeId: v ?? undefined, ...(u ? { departmentId: u.departmentId } : {}) })}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name="resultKey" label="Kết quả" required extra="Chọn tới level cuối cùng. Bắt buộc khi Trả lại xử lý / Báo hoàn thành / Hoàn thành.">
                          <TreeSelect treeData={tree} treeDefaultExpandAll allowClear placeholder="Chọn kết quả công việc" disabled={locked} showSearch treeNodeFilterProp="title" />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name="note" label="Ghi chú xử lý">
                          <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} placeholder="Nhập nội dung xử lý" />
                        </Form.Item>
                      </Col>
                    </Row>
                    {items.length > 0 && (
                      <>
                        <div className="section-title">Thông tin động – {t.step.form.name}</div>
                        <DynamicFields items={items} form={form} customerId={t.ticket.customerId} disabled={readonly} />
                      </>
                    )}
                  </Form>
                  <div className="section-title" style={{ marginTop: 8 }}>
                    Đính kèm file của tác vụ ({t.attachments.length}/{TASK_LIMITS.maxFiles})
                  </div>
                  <AttachmentList
                    items={t.attachments}
                    onDelete={readonly ? undefined : async (id) => (await del(`/attachments/${id}`), refetch())}
                    canDelete={(a) => a.uploadedById === user?.id || user?.role === 'ADMIN'}
                  />
                  {!readonly && (
                    <Upload
                      multiple
                      showUploadList={false}
                      beforeUpload={(f, list) => {
                        if (f.size > TASK_LIMITS.maxFileSize) {
                          message.error(`File "${f.name}" vượt quá 10MB`);
                          return Upload.LIST_IGNORE;
                        }
                        if (f === list[list.length - 1]) addFiles(list.filter((x) => x.size <= TASK_LIMITS.maxFileSize));
                        return false;
                      }}
                    >
                      <Button icon={<UploadOutlined />} style={{ marginTop: 8 }} disabled={t.attachments.length >= TASK_LIMITS.maxFiles}>
                        Bổ sung file
                      </Button>
                    </Upload>
                  )}
                </>
              ),
            },
            { key: 'history', label: 'Lịch sử tác vụ', children: <HistoryList items={history} /> },
          ]}
        />
      )}
    </Modal>
  );
}
