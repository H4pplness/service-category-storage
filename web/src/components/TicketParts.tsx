import { useMemo, useState } from 'react';
import { Alert, Descriptions, Empty, Select, Space, Tag, TreeSelect, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/api';
import { useCalendar, useOperations, useProducts } from '@/hooks';
import { buildTree, fmtDateTime } from '@/utils';
import { SEGMENT_LABEL, WORK_HOURS_LABEL } from '@shared/constants';
import { addDuration, formatSla, WorkHoursMode } from '@shared/sla';
import type { FormItemDef } from '@shared/form';

/** Chuyển mẫu nhập liệu (API /forms/:id) → danh sách FormItemDef. */
export function formToItems(form: any): FormItemDef[] {
  if (!form) return [];
  return form.items.map((it: any) => ({
    itemId: it.key,
    fieldId: it.fieldId,
    code: it.field.code,
    name: it.field.name,
    infoType: it.field.infoType,
    view360Source: it.field.view360Source,
    dataType: it.field.dataType,
    displayType: it.field.displayType,
    options: it.field.options,
    required: it.field.required,
    showOnTicket: it.field.showOnTicket,
    placeholder: it.field.placeholder,
    sortOrder: it.sortOrder,
    parentItemId: it.parentKey,
    parentValues: it.parentValues,
  }));
}

/** TreeSelect chỉ cho chọn lá thuộc tập `allowIds` (bỏ nhánh không có lá hợp lệ). */
function restrictedTree(rows: any[], allow: (r: any) => boolean) {
  const tree = buildTree(rows.filter((r) => r.active));
  const conv = (n: any): any | null => {
    if (!n.children?.length) return allow(n) ? { value: n.id, title: n.name, key: n.id } : null;
    const children = n.children.map(conv).filter(Boolean);
    if (!children.length) return null;
    return { value: n.id, title: n.name, key: n.id, selectable: false, children };
  };
  return tree.map(conv).filter(Boolean);
}

export function ProductSelect({ id, value, onChange, disabled }: { id?: string; value?: number; onChange?: (v: number | undefined) => void; disabled?: boolean }) {
  const { data = [] } = useProducts();
  const tree = useMemo(() => restrictedTree(data, () => true), [data]);
  return (
    <TreeSelect
      id={id}
      value={value}
      onChange={onChange}
      treeData={tree}
      showSearch
      treeNodeFilterProp="title"
      placeholder="Chọn sản phẩm (tới level cuối cùng)"
      allowClear
      disabled={disabled}
      treeDefaultExpandAll
      popupMatchSelectWidth={false}
      style={{ width: '100%' }}
    />
  );
}

export function OperationSelect({
  id,
  productId,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  productId?: number;
  value?: number;
  onChange?: (v: number | undefined) => void;
  disabled?: boolean;
}) {
  const { data = [] } = useOperations();
  const { data: allowed = [] } = useQuery<number[]>({
    queryKey: ['ops-for-product', productId],
    queryFn: () => get('/services/operations-for-product', { productId }),
    enabled: !!productId,
  });
  const tree = useMemo(() => restrictedTree(data, (r) => allowed.includes(r.id)), [data, allowed]);
  return (
    <TreeSelect
      id={id}
      value={value}
      onChange={onChange}
      treeData={tree}
      showSearch
      treeNodeFilterProp="title"
      placeholder={productId ? (tree.length ? 'Chọn nghiệp vụ' : 'Sản phẩm chưa có dịch vụ nào') : 'Chọn sản phẩm trước'}
      allowClear
      disabled={disabled || !productId}
      treeDefaultExpandAll
      popupMatchSelectWidth={false}
      style={{ width: '100%' }}
    />
  );
}

export function useServiceLookup(productId?: number, operationId?: number) {
  return useQuery({
    queryKey: ['service-lookup', productId, operationId],
    queryFn: () => get('/services/lookup', { productId, operationId }),
    enabled: !!productId && !!operationId,
  });
}

export function ServiceInfo({ service, segment, hasCustomer }: { service: any; segment?: string | null; hasCustomer: boolean }) {
  const cal = useCalendar();
  if (!service) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chọn Sản phẩm + Nghiệp vụ để áp dụng dịch vụ" />;
  const applied =
    service.segmentMode === 'ALL' ? service.workflows.find((w: any) => w.segment === 'ALL') : segment ? service.workflows.find((w: any) => w.segment === segment) : null;
  const due = applied && cal ? addDuration(service.workHoursMode as WorkHoursMode, cal, Date.now(), applied.slaMinutes) : null;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Descriptions
        size="small"
        column={1}
        items={[
          { key: 'c', label: 'Mã dịch vụ', children: <b className="mono">{service.code}</b> },
          { key: 'h', label: 'Giờ làm việc', children: WORK_HOURS_LABEL[service.workHoursMode] },
          { key: 'f', label: 'Mẫu nhập liệu', children: service.formName ? `${service.formName} (${service.formCode})` : '—' },
          {
            key: 'w',
            label: 'Quy trình',
            children: (
              <Space direction="vertical" size={2}>
                {service.workflows.map((w: any) => (
                  <span key={w.segment} style={{ opacity: applied && applied.segment !== w.segment ? 0.5 : 1 }}>
                    {service.segmentMode === 'BY_SEGMENT' && <Tag>{SEGMENT_LABEL[w.segment]}</Tag>}
                    {w.workflowName} · <Typography.Text type="secondary">SLA {formatSla(w.slaMinutes, service.workHoursMode)}</Typography.Text>
                  </span>
                ))}
              </Space>
            ),
          },
          ...(due ? [{ key: 'd', label: 'Thời hạn dự kiến', children: <b>{fmtDateTime(due)}</b> }] : []),
        ]}
      />
      {service.segmentMode === 'BY_SEGMENT' && !hasCustomer && (
        <Alert type="warning" showIcon message="Dịch vụ áp dụng quy trình theo phân khúc – vui lòng chọn khách hàng." />
      )}
    </Space>
  );
}

export function CustomerSelect({ id, value, onChange, disabled }: { id?: string; value?: number | null; onChange?: (v: number | null, c?: any) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const { data = [], isFetching } = useQuery({ queryKey: ['customers', q], queryFn: () => get('/customers', { q }) });
  const { data: cur } = useQuery({ queryKey: ['customer', value], queryFn: () => get(`/customers/${value}`), enabled: !!value });
  const options = [...data, ...(cur && !data.some((d: any) => d.id === cur.id) ? [cur] : [])].map((c: any) => ({
    value: c.id,
    label: `${c.fullName} – CIF ${c.cif}`,
    c,
  }));
  return (
    <Select
      id={id}
      showSearch
      allowClear
      value={value ?? undefined}
      filterOption={false}
      onSearch={setQ}
      loading={isFetching}
      onChange={(v, o: any) => onChange?.(v ?? null, o?.c)}
      disabled={disabled}
      placeholder="Tìm theo CIF, tên, SĐT, giấy tờ"
      options={options}
      optionRender={(o: any) => (
        <div>
          <div>
            {o.data.c.fullName} <Tag color="geekblue">{SEGMENT_LABEL[o.data.c.segment]}</Tag>
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            CIF {o.data.c.cif} · {o.data.c.phone}
          </Typography.Text>
        </div>
      )}
      style={{ width: '100%' }}
    />
  );
}

export function TicketSearchSelect({ id, value, onChange, excludeId }: { id?: string; value?: number[]; onChange?: (v: number[]) => void; excludeId?: number }) {
  const [q, setQ] = useState('');
  const { data = [] } = useQuery({ queryKey: ['ticket-search', q], queryFn: () => get('/tickets/search', { q }) });
  const { data: picked = [] } = useQuery({
    queryKey: ['ticket-picked', value],
    queryFn: async () => (await Promise.all((value || []).map((id) => get(`/tickets/${id}`)))).map((t: any) => ({ id: t.id, code: t.code })),
    enabled: !!value?.length,
  });
  const map = new Map<number, any>();
  [...picked, ...data].forEach((t: any) => t.id !== excludeId && map.set(t.id, t));
  return (
    <Select
      id={id}
      mode="multiple"
      showSearch
      filterOption={false}
      onSearch={setQ}
      value={value}
      onChange={onChange}
      placeholder="Tìm mã phiếu để liên kết"
      options={[...map.values()].map((t) => ({ value: t.id, label: t.code }))}
      style={{ width: '100%' }}
    />
  );
}
