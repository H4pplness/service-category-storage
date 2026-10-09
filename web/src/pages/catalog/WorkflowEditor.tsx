import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Divider, Empty, Form, Input, InputNumber, Radio, Row, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, SaveOutlined, SubnodeOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { errMsg, get, post, put } from '@/api';
import { useAuth } from '@/auth';
import { DeptTreeSelect, PageHead, StaffSelect } from '@/components/common';
import { uid } from '@/utils';
import { WORK_HOURS_LABEL } from '@shared/constants';
import { formatSla, slaToMinutes, WorkHoursMode } from '@shared/sla';

interface Res {
  key: string;
  parentKey: string | null;
  code: string;
  name: string;
  routeType: 'NEXT' | 'GOTO' | 'END';
  gotoStepKey: string | null;
}
interface Step {
  key: string;
  name: string;
  description?: string;
  expectedResult?: string;
  slaDays: number;
  slaHours: number;
  slaMinutes: number;
  departmentId: number | null;
  assigneeId: number | null;
  formId: number | null;
  results: Res[];
}

const newStep = (n: number): Step => ({
  key: uid(),
  name: `Công việc ${n}`,
  slaDays: 0,
  slaHours: 4,
  slaMinutes: 0,
  departmentId: null,
  assigneeId: null,
  formId: null,
  results: [{ key: uid(), parentKey: null, code: 'HOAN_THANH', name: 'Hoàn thành', routeType: 'NEXT', gotoStepKey: null }],
});

function ResultsEditor({ step, steps, onChange, disabled }: { step: Step; steps: Step[]; onChange: (r: Res[]) => void; disabled: boolean }) {
  const rs = step.results;
  const ordered: { r: Res; depth: number }[] = [];
  const walk = (p: string | null, d: number) => rs.filter((r) => r.parentKey === p).forEach((r) => (ordered.push({ r, depth: d }), walk(r.key, d + 1)));
  walk(null, 0);
  const isLeaf = (k: string) => !rs.some((r) => r.parentKey === k);
  const set = (k: string, patch: Partial<Res>) => onChange(rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const removeRes = (k: string) => {
    const drop = new Set([k]);
    let g = true;
    while (g) {
      g = false;
      for (const r of rs) if (r.parentKey && drop.has(r.parentKey) && !drop.has(r.key)) (drop.add(r.key), (g = true));
    }
    onChange(rs.filter((r) => !drop.has(r.key)));
  };
  const addRes = (parentKey: string | null) =>
    onChange([...rs, { key: uid(), parentKey, code: `KQ${rs.length + 1}`, name: '', routeType: 'NEXT', gotoStepKey: null }]);

  return (
    <div>
      {ordered.map(({ r, depth }) => (
        <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, marginLeft: depth * 24, flexWrap: 'wrap' }}>
          <Input size="small" style={{ width: 120 }} value={r.code} onChange={(e) => set(r.key, { code: e.target.value })} placeholder="Mã" disabled={disabled} />
          <Input size="small" style={{ width: 240 }} value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="Tên kết quả" status={r.name ? undefined : 'error'} disabled={disabled} />
          {isLeaf(r.key) ? (
            <>
              <Select
                size="small"
                style={{ width: 200 }}
                value={r.routeType}
                disabled={disabled}
                onChange={(v) => set(r.key, { routeType: v, gotoStepKey: null })}
                options={[
                  { value: 'NEXT', label: '→ Công việc kế tiếp' },
                  { value: 'GOTO', label: '↪ Chuyển đến công việc…' },
                  { value: 'END', label: '■ Kết thúc quy trình' },
                ]}
              />
              {r.routeType === 'GOTO' && (
                <Select
                  size="small"
                  style={{ width: 220 }}
                  value={r.gotoStepKey ?? undefined}
                  placeholder="Chọn công việc"
                  status={r.gotoStepKey ? undefined : 'error'}
                  disabled={disabled}
                  onChange={(v) => set(r.key, { gotoStepKey: v })}
                  options={steps.filter((s) => s.key !== step.key).map((s) => ({ value: s.key, label: `${steps.indexOf(s) + 1}. ${s.name}` }))}
                />
              )}
            </>
          ) : (
            <Tag>Nhóm kết quả</Tag>
          )}
          {!disabled && (
            <>
              {depth < 2 && (
                <Tooltip title="Thêm kết quả con">
                  <Button size="small" type="text" icon={<SubnodeOutlined />} onClick={() => addRes(r.key)} />
                </Tooltip>
              )}
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeRes(r.key)} />
            </>
          )}
        </div>
      ))}
      {!disabled && (
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => addRes(null)}>
          Thêm kết quả
        </Button>
      )}
    </div>
  );
}

export default function WorkflowEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { message } = App.useApp();
  const [meta] = Form.useForm();
  const [steps, setSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);
  const mode: WorkHoursMode = Form.useWatch('workHoursMode', meta) ?? 'OFFICE';
  const { data: wf } = useQuery({ queryKey: ['workflow', id], queryFn: () => get(`/workflows/${id}`), enabled: !isNew });
  const { data: forms = [] } = useQuery<any[]>({ queryKey: ['forms'], queryFn: () => get('/forms') });

  useEffect(() => {
    if (wf) {
      meta.setFieldsValue({ code: wf.code, name: wf.name, description: wf.description, workHoursMode: wf.workHoursMode, active: wf.active });
      setSteps(
        wf.steps.map((s: any) => ({
          key: s.key,
          name: s.name,
          description: s.description,
          expectedResult: s.expectedResult,
          slaDays: s.slaDays,
          slaHours: s.slaHours,
          slaMinutes: s.slaMinutes,
          departmentId: s.departmentId,
          assigneeId: s.assigneeId,
          formId: s.formId,
          results: s.results.map((r: any) => ({ key: r.key, parentKey: r.parentKey, code: r.code, name: r.name, routeType: r.routeType, gotoStepKey: r.gotoStepKey })),
        })),
      );
    } else if (isNew) {
      meta.setFieldsValue({ workHoursMode: 'OFFICE', active: true });
      setSteps([newStep(1)]);
    }
  }, [wf, isNew, meta]);

  const upd = (k: string, patch: Partial<Step>) => setSteps((l) => l.map((s) => (s.key === k ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) =>
    setSteps((l) => {
      const n = [...l];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const total = steps.reduce((t, s) => t + slaToMinutes(s.slaDays, s.slaHours, s.slaMinutes, mode), 0);
  const readonly = !isAdmin;

  const save = async () => {
    const v = await meta.validateFields();
    setSaving(true);
    try {
      const body = { ...v, steps };
      if (isNew) {
        const r = await post('/workflows', body);
        message.success('Đã tạo quy trình');
        nav(`/catalog/workflows/${r.id}`, { replace: true });
      } else {
        await put(`/workflows/${id}`, body);
        message.success('Đã lưu quy trình');
      }
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['workflow'] });
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHead
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/catalog/workflows')} />
            {isNew ? 'Thêm quy trình' : wf?.name}
          </Space>
        }
        sub={
          <span>
            Tổng SLA tham chiếu: <b>{formatSla(total, mode)}</b> ({WORK_HOURS_LABEL[mode]}, 1 ngày = {mode === 'H24' ? '24' : '8'} giờ). Thay đổi chỉ áp dụng cho phiếu tạo sau khi cập nhật.
          </span>
        }
        extra={
          isAdmin && (
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              Lưu quy trình
            </Button>
          )
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <Form form={meta} layout="vertical" disabled={readonly}>
          <Row gutter={16}>
            <Col xs={24} md={6}>
              <Form.Item name="code" label="Mã quy trình" rules={[{ required: true, message: 'Nhập mã' }]}>
                <Input style={{ textTransform: 'uppercase' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="name" label="Tên quy trình" rules={[{ required: true, message: 'Nhập tên' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item name="workHoursMode" label="Giờ làm việc">
                <Radio.Group
                  disabled={!!wf?.serviceCount}
                  optionType="button"
                  options={[
                    { value: 'OFFICE', label: 'Giờ hành chính' },
                    { value: 'H24', label: '24/7' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="active" label="Sử dụng" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="Mô tả" style={{ marginBottom: 0 }}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Tác vụ tự sinh được giao cho nhân sự cụ thể (nếu cấu hình) hoặc nhân sự đầu mối của phòng ban xử lý. Kết quả lá quyết định công việc tiếp theo khi toàn bộ tác vụ của công việc Hoàn thành."
      />

      {steps.map((s, i) => (
        <Card
          key={s.key}
          style={{ marginBottom: 12 }}
          title={
            <Space>
              <span className="step-no">{i + 1}</span>
              <Input value={s.name} onChange={(e) => upd(s.key, { name: e.target.value })} style={{ width: 360, fontWeight: 600 }} disabled={readonly} status={s.name ? undefined : 'error'} />
            </Space>
          }
          extra={
            !readonly && (
              <Space size={0}>
                <Button type="text" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} />
                <Button type="text" icon={<ArrowDownOutlined />} disabled={i === steps.length - 1} onClick={() => move(i, 1)} />
                <Button type="text" danger icon={<DeleteOutlined />} disabled={steps.length === 1} onClick={() => setSteps((l) => l.filter((x) => x.key !== s.key))} />
              </Space>
            )
          }
        >
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <div className="muted" style={{ marginBottom: 4 }}>
                SLA công việc
              </div>
              <Space.Compact>
                <InputNumber min={0} value={s.slaDays} onChange={(v) => upd(s.key, { slaDays: v ?? 0 })} addonAfter="ngày" style={{ width: 120 }} disabled={readonly} />
                <InputNumber min={0} max={23} value={s.slaHours} onChange={(v) => upd(s.key, { slaHours: v ?? 0 })} addonAfter="giờ" style={{ width: 110 }} disabled={readonly} />
                <InputNumber min={0} max={59} value={s.slaMinutes} onChange={(v) => upd(s.key, { slaMinutes: v ?? 0 })} addonAfter="phút" style={{ width: 120 }} disabled={readonly} />
              </Space.Compact>
            </Col>
            <Col xs={24} md={8}>
              <div className="muted" style={{ marginBottom: 4 }}>
                Phòng ban xử lý mặc định
              </div>
              <DeptTreeSelect value={s.departmentId} onChange={(v) => upd(s.key, { departmentId: v, assigneeId: null })} disabled={readonly} />
            </Col>
            <Col xs={24} md={8}>
              <div className="muted" style={{ marginBottom: 4 }}>
                Nhân sự nhận tác vụ (tùy chọn)
              </div>
              <StaffSelect
                departmentId={s.departmentId}
                value={s.assigneeId}
                onChange={(v, u) => upd(s.key, { assigneeId: v, ...(u ? { departmentId: u.departmentId } : {}) })}
                disabled={readonly}
                placeholder="Mặc định: đầu mối phòng ban"
              />
            </Col>
            <Col xs={24} md={8} style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 4 }}>
                Mẫu nhập liệu của công việc
              </div>
              <Select
                allowClear
                style={{ width: '100%' }}
                value={s.formId ?? undefined}
                onChange={(v) => upd(s.key, { formId: v ?? null })}
                options={forms.filter((f) => f.active || f.id === s.formId).map((f) => ({ value: f.id, label: `${f.name} (${f.code})` }))}
                placeholder="Không có"
                disabled={readonly}
              />
            </Col>
            <Col xs={24} md={16} style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 4 }}>
                Kết quả mong đợi
              </div>
              <Input value={s.expectedResult} onChange={(e) => upd(s.key, { expectedResult: e.target.value })} disabled={readonly} />
            </Col>
            <Col span={24} style={{ marginTop: 12 }}>
              <div className="muted" style={{ marginBottom: 4 }}>
                Mô tả công việc (mặc định cho tác vụ)
              </div>
              <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} value={s.description} onChange={(e) => upd(s.key, { description: e.target.value })} disabled={readonly} />
            </Col>
          </Row>
          <Divider orientation="left" plain style={{ margin: '16px 0 12px' }}>
            Kết quả công việc & rẽ nhánh
          </Divider>
          <ResultsEditor step={s} steps={steps} disabled={readonly} onChange={(results) => upd(s.key, { results })} />
        </Card>
      ))}
      {!steps.length && <Empty />}
      {!readonly && (
        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setSteps((l) => [...l, newStep(l.length + 1)])} style={{ height: 44 }}>
          Thêm công việc
        </Button>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        Kết quả có cấu trúc phân cấp; người xử lý phải chọn tới kết quả level cuối cùng. Chỉ kết quả lá mới cấu hình hướng đi tiếp theo.
      </Typography.Paragraph>
    </div>
  );
}
