import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Col, Empty, Form, Input, Row, Select, Space, Switch, Tabs, Tag, Tooltip, Typography } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, HolderOutlined, LinkOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { errMsg, get, post, put } from '@/api';
import { useAuth } from '@/auth';
import { PageHead } from '@/components/common';
import { DynamicFields } from '@/components/DynamicForm';
import { DATA_TYPES, DEPENDABLE_TYPES, FormItemDef, MAX_DEPENDENCY_DEPTH, optionsOf, orderItems } from '@shared/form';
import { uid } from '@/utils';

interface Item {
  key: string;
  fieldId: number;
  sortOrder: number;
  parentKey: string | null;
  parentValues: string[];
}

function Sortable({ id, children }: { id: string; children: (handle: any) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 5 : undefined, position: 'relative' }}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

const STATIC_TOP = ['Mã phiếu', 'Kênh', 'Thời gian tạo', 'Người tạo', 'Sản phẩm', 'Nghiệp vụ', 'Hướng xử lý', 'Người phụ trách', 'Thời hạn hoàn thành', 'Trạng thái', 'Mã phiếu liên kết', 'Đính kèm file'];
const STATIC_BOTTOM = ['Nội dung trao đổi', 'Tóm tắt cách xử lý'];

export default function FormBuilder() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { message } = App.useApp();
  const [meta] = Form.useForm();
  const [preview] = Form.useForm();
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  const { data: fields = [] } = useQuery<any[]>({ queryKey: ['fields'], queryFn: () => get('/fields') });
  const { data: form } = useQuery({ queryKey: ['form', Number(id)], queryFn: () => get(`/forms/${id}`), enabled: !isNew });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (form) {
      meta.setFieldsValue({ name: form.name, description: form.description, active: form.active });
      setItems(form.items.map((i: any) => ({ key: i.key, fieldId: i.fieldId, sortOrder: i.sortOrder, parentKey: i.parentKey, parentValues: i.parentValues })));
    } else if (isNew) meta.setFieldsValue({ active: true });
  }, [form, isNew, meta]);

  const fm = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const defs: FormItemDef[] = useMemo(
    () =>
      items
        .filter((i) => fm.has(i.fieldId))
        .map((i) => {
          const f = fm.get(i.fieldId);
          return {
            itemId: i.key,
            fieldId: i.fieldId,
            code: f.code,
            name: f.name,
            infoType: f.infoType,
            view360Source: f.view360Source,
            dataType: f.dataType,
            displayType: f.displayType,
            options: f.options,
            required: f.required,
            showOnTicket: f.showOnTicket,
            placeholder: f.placeholder,
            sortOrder: i.sortOrder,
            parentItemId: i.parentKey,
            parentValues: i.parentValues,
          };
        }),
    [items, fm],
  );
  const ordered = useMemo(() => orderItems(defs), [defs]);
  const depth = (key: string): number => {
    let d = 0;
    let cur = items.find((i) => i.key === key);
    while (cur?.parentKey && d < 10) {
      cur = items.find((i) => i.key === cur!.parentKey);
      d++;
    }
    return d;
  };
  const isDescendant = (key: string, ofKey: string): boolean => {
    let cur = items.find((i) => i.key === key);
    let g = 0;
    while (cur?.parentKey && g++ < 10) {
      if (cur.parentKey === ofKey) return true;
      cur = items.find((i) => i.key === cur!.parentKey);
    }
    return false;
  };

  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const remove = (key: string) =>
    setItems((list) => {
      const drop = new Set([key]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const i of list) if (i.parentKey && drop.has(i.parentKey) && !drop.has(i.key)) (drop.add(i.key), (grew = true));
      }
      return list.filter((i) => !drop.has(i.key));
    });
  const add = (fieldIds: number[]) =>
    setItems((list) => [...list, ...fieldIds.map((fid, n) => ({ key: uid(), fieldId: fid, sortOrder: list.length + n + 1, parentKey: null, parentValues: [] }))]);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const keys = ordered.map((d) => String(d.itemId));
    const moved = arrayMove(keys, keys.indexOf(String(e.active.id)), keys.indexOf(String(e.over.id)));
    setItems((list) => list.map((i) => ({ ...i, sortOrder: moved.indexOf(i.key) + 1 })));
  };

  const save = async () => {
    const v = await meta.validateFields();
    for (const i of items)
      if (i.parentKey && !i.parentValues.length) {
        message.error(`Trường "${fm.get(i.fieldId)?.name}": chọn giá trị kích hoạt cho cấu hình phụ thuộc`);
        return;
      }
    setSaving(true);
    try {
      const body = { ...v, items };
      if (isNew) {
        const r = await post('/forms', body);
        message.success(`Đã tạo mẫu ${r.code}`);
        nav(`/catalog/forms/${r.id}`, { replace: true });
      } else {
        await put(`/forms/${id}`, body);
        message.success('Đã lưu mẫu nhập liệu');
      }
      qc.invalidateQueries({ queryKey: ['forms'] });
      qc.invalidateQueries({ queryKey: ['form'] });
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const available = fields.filter((f) => f.active && !items.some((i) => i.fieldId === f.id));
  const ticketVisible = ordered.filter((d) => d.showOnTicket);

  const sortableList = (list: FormItemDef[], compact: boolean) => (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={list.map((d) => String(d.itemId))} strategy={verticalListSortingStrategy}>
        {list.map((d) => {
          const it = items.find((i) => i.key === d.itemId)!;
          const dp = depth(it.key);
          const f = fm.get(it.fieldId);
          const parentChoices = ordered.filter(
            (p) => p.itemId !== it.key && DEPENDABLE_TYPES.includes(p.dataType) && depth(String(p.itemId)) < MAX_DEPENDENCY_DEPTH && !isDescendant(String(p.itemId), it.key),
          );
          const parent = defs.find((p) => p.itemId === it.parentKey);
          return (
            <Sortable key={it.key} id={it.key}>
              {(handle) => (
                <div className="drag-row" style={{ marginLeft: dp * 24, borderLeft: dp ? '3px solid #a5b4fc' : undefined }}>
                  {isAdmin && (
                    <span className="drag-handle" {...handle}>
                      <HolderOutlined />
                    </span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={6} wrap>
                      <b>{f?.name}</b>
                      <span className="mono muted" style={{ fontSize: 12 }}>
                        {f?.code}
                      </span>
                      <Tag>{DATA_TYPES.find((x) => x.value === f?.dataType)?.label}</Tag>
                      {f?.required && <Tag color="red">Bắt buộc</Tag>}
                      {!f?.showOnTicket && <Tag>Không hiển thị trên Phiếu</Tag>}
                      {f?.infoType === 'VIEW360' && <Tag color="cyan">360 view</Tag>}
                      {parent && (
                        <Tag icon={<LinkOutlined />} color="geekblue">
                          phụ thuộc "{parent.name}"
                        </Tag>
                      )}
                    </Space>
                    {!compact && isAdmin && (
                      <Space wrap style={{ marginTop: 8 }}>
                        <Select
                          size="small"
                          style={{ width: 240 }}
                          allowClear
                          placeholder="Phụ thuộc trường gốc (tùy chọn)"
                          value={it.parentKey ?? undefined}
                          options={parentChoices.map((p) => ({ value: String(p.itemId), label: p.name }))}
                          onChange={(v) => update(it.key, { parentKey: v ?? null, parentValues: [] })}
                        />
                        {parent && (
                          <Select
                            size="small"
                            mode="multiple"
                            style={{ minWidth: 240 }}
                            placeholder="Hiển thị khi trường gốc ="
                            value={it.parentValues}
                            options={optionsOf(parent)}
                            onChange={(v) => update(it.key, { parentValues: v })}
                            status={it.parentValues.length ? undefined : 'error'}
                          />
                        )}
                      </Space>
                    )}
                  </div>
                  {isAdmin && !compact && (
                    <Tooltip title="Bỏ khỏi mẫu (kèm các trường phụ thuộc)">
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(it.key)} />
                    </Tooltip>
                  )}
                </div>
              )}
            </Sortable>
          );
        })}
      </SortableContext>
    </DndContext>
  );

  return (
    <div className="page">
      <PageHead
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/catalog/forms')} />
            {isNew ? 'Thêm mẫu nhập liệu' : `${form?.code ?? ''} · ${form?.name ?? ''}`}
          </Space>
        }
        sub="Mã mẫu sinh tự động theo quy tắc F + mmyy + xxxx. Cập nhật mẫu chỉ áp dụng cho phiếu tạo sau thời điểm cập nhật."
        extra={
          isAdmin && (
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              Lưu mẫu
            </Button>
          )
        }
      />
      <Row gutter={16}>
        <Col xs={24} xl={9}>
          <Card title="Thông tin mẫu" style={{ marginBottom: 16 }}>
            <Form form={meta} layout="vertical" disabled={!isAdmin}>
              <Form.Item name="name" label="Tên mẫu nhập liệu" rules={[{ required: true, message: 'Nhập tên mẫu' }]} extra="Không được trùng tên">
                <Input />
              </Form.Item>
              <Form.Item name="description" label="Mô tả">
                <Input.TextArea autoSize={{ minRows: 2 }} />
              </Form.Item>
              <Form.Item name="active" label="Sử dụng" valuePropName="checked">
                <Switch checkedChildren="Đang sử dụng" unCheckedChildren="Ngừng" />
              </Form.Item>
            </Form>
          </Card>
          {isAdmin && (
            <Card title="Thêm trường nhập liệu">
              <Select
                mode="multiple"
                style={{ width: '100%' }}
                placeholder="Chọn các trường Đang sử dụng"
                value={[]}
                options={available.map((f) => ({ value: f.id, label: `${f.name} (${f.code})` }))}
                optionFilterProp="label"
                onChange={(v: number[]) => add(v)}
                suffixIcon={<PlusOutlined />}
              />
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12, marginBottom: 0 }}>
                Trường phụ thuộc chỉ áp dụng cho trường gốc kiểu single choice / boolean / kết quả cuộc gọi, tối đa {MAX_DEPENDENCY_DEPTH} cấp, và hiển thị liền kề trường gốc.
              </Typography.Paragraph>
            </Card>
          )}
        </Col>
        <Col xs={24} xl={15}>
          <Card styles={{ body: { paddingTop: 4 } }}>
            <Tabs
              items={[
                {
                  key: 'cfg',
                  label: `Danh sách trường (${items.length})`,
                  children: items.length ? sortableList(ordered, false) : <Empty description="Chưa có trường nào" />,
                },
                {
                  key: 'preview',
                  label: 'Xem trước theo Phiếu',
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }} size={16}>
                      <Alert type="info" showIcon message="Chỉ hiển thị các trường có cờ “Hiển thị trên Phiếu”. Thử chọn giá trị trường gốc để xem trường phụ thuộc xuất hiện." />
                      <div className="zone">
                        <div className="zone-title">Khu vực tĩnh (trên)</div>
                        <Row gutter={[12, 8]}>
                          {STATIC_TOP.map((l) => (
                            <Col xs={12} md={8} key={l}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                {l}
                              </div>
                              <Input size="small" disabled placeholder="—" />
                            </Col>
                          ))}
                        </Row>
                      </div>
                      <div className="zone" style={{ borderColor: '#818cf8', background: '#fff' }}>
                        <div className="zone-title">Khu vực động (giữa) – kéo thả để sắp xếp vị trí</div>
                        {ticketVisible.length ? (
                          <>
                            <div style={{ marginBottom: 16 }}>{sortableList(ticketVisible, true)}</div>
                            <Form form={preview} layout="vertical">
                              <DynamicFields items={defs} form={preview} ticketOnly />
                            </Form>
                          </>
                        ) : (
                          <Empty description="Không có trường hiển thị trên Phiếu" />
                        )}
                      </div>
                      <div className="zone">
                        <div className="zone-title">Khu vực tĩnh (dưới)</div>
                        <Row gutter={12}>
                          {STATIC_BOTTOM.map((l) => (
                            <Col span={12} key={l}>
                              <div className="muted" style={{ fontSize: 12 }}>
                                {l}
                              </div>
                              <Input.TextArea disabled rows={2} placeholder="—" />
                            </Col>
                          ))}
                        </Row>
                      </div>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
