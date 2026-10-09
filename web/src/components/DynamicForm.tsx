import { useMemo, useState } from 'react';
import { Button, Checkbox, Col, DatePicker, Descriptions, Form, FormInstance, Input, InputNumber, Modal, Radio, Row, Select, Switch, Table, Tooltip, Typography, App } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { depthOf, FormItemDef, isEmptyValue, optionsOf, visibleItems } from '@shared/form';
import { get } from '@/api';
import { useBranches, useProvinces, useRms, useWards } from '@/hooks';
import { fmtDateTime, fmtMoney } from '@/utils';

// ───── Trường ghép ─────

export function BranchRmInput({ value, onChange, disabled }: { value?: any; onChange?: (v: any) => void; disabled?: boolean }) {
  const { data: branches = [] } = useBranches();
  const { data: rms = [] } = useRms();
  const v = value || {};
  const rmOptions = rms.filter((r) => r.branchId === v.branchId).map((r) => ({ value: r.id, label: `${r.fullName} (${r.code})` }));
  return (
    <Row gutter={8}>
      <Col span={12}>
        <Select
          placeholder="Chi nhánh"
          value={v.branchId ?? undefined}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          onChange={(b) => onChange?.({ branchId: b ?? null, rmId: null })}
          allowClear
          showSearch
          optionFilterProp="label"
          disabled={disabled}
          style={{ width: '100%' }}
        />
      </Col>
      <Col span={12}>
        <Select
          placeholder={v.branchId ? 'RM' : 'Chọn chi nhánh trước'}
          value={v.rmId ?? undefined}
          options={rmOptions}
          onChange={(r) => onChange?.({ ...v, rmId: r ?? null })}
          allowClear
          showSearch
          optionFilterProp="label"
          disabled={disabled || !v.branchId}
          style={{ width: '100%' }}
        />
      </Col>
    </Row>
  );
}

export function AdminUnitInput({ value, onChange, disabled }: { value?: any; onChange?: (v: any) => void; disabled?: boolean }) {
  const { data: provinces = [] } = useProvinces();
  const { data: wards = [] } = useWards();
  const v = value || {};
  return (
    <Row gutter={8}>
      <Col xs={24} md={8}>
        <Select
          placeholder="Thành phố/Tỉnh"
          value={v.provinceId ?? undefined}
          options={provinces.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(p) => onChange?.({ provinceId: p ?? null, wardId: null, address: v.address ?? '' })}
          allowClear
          showSearch
          optionFilterProp="label"
          disabled={disabled}
          style={{ width: '100%' }}
        />
      </Col>
      <Col xs={24} md={8}>
        <Select
          placeholder={v.provinceId ? 'Xã/Phường' : 'Chọn Tỉnh/TP trước'}
          value={v.wardId ?? undefined}
          options={wards.filter((w) => w.provinceId === v.provinceId).map((w) => ({ value: w.id, label: w.name }))}
          onChange={(w) => onChange?.({ ...v, wardId: w ?? null })}
          allowClear
          showSearch
          optionFilterProp="label"
          disabled={disabled || !v.provinceId}
          style={{ width: '100%' }}
        />
      </Col>
      <Col xs={24} md={8}>
        <Input placeholder="Địa chỉ (số nhà, đường…)" value={v.address ?? ''} onChange={(e) => onChange?.({ ...v, address: e.target.value })} disabled={disabled} />
      </Col>
    </Row>
  );
}

function DateInput({ id, value, onChange, disabled }: { id?: string; value?: string; onChange?: (v: string | null) => void; disabled?: boolean }) {
  return (
    <DatePicker
      id={id}
      value={value ? dayjs(value) : null}
      onChange={(d) => onChange?.(d ? d.format('YYYY-MM-DD') : null)}
      format="DD/MM/YYYY"
      style={{ width: '100%' }}
      disabled={disabled}
    />
  );
}

// ───── 360 view ─────

function View360Input({ id, value, onChange, item, customerId, disabled }: { id?: string; value?: any; onChange?: (v: any) => void; item: FormItemDef; customerId?: number | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { message } = App.useApp();
  const { data: c } = useQuery({ queryKey: ['customer', customerId], queryFn: () => get(`/customers/${customerId}`), enabled: !!customerId });
  const src = item.view360Source;
  const pick = () => {
    if (!c) return;
    const direct: Record<string, string | undefined> = {
      CUSTOMER_PHONE: c.phone,
      CUSTOMER_EMAIL: c.email,
      CUSTOMER_ID_NUMBER: c.idNumber,
      CUSTOMER_ADDRESS: c.address,
    };
    if (src && src in direct) {
      onChange?.(direct[src] ?? '');
      message.success('Đã copy dữ liệu từ 360 view');
    } else setOpen(true);
  };
  const rows = src === 'ACCOUNT_NO' ? c?.accounts : src === 'CARD_NO' ? c?.cards : c?.transactions;
  const columns: any[] =
    src === 'ACCOUNT_NO'
      ? [
          { title: 'Số tài khoản', dataIndex: 'accountNo' },
          { title: 'Loại', dataIndex: 'type' },
          { title: 'Số dư', dataIndex: 'balance', render: fmtMoney },
          { title: 'Trạng thái', dataIndex: 'status' },
        ]
      : src === 'CARD_NO'
        ? [
            { title: 'Số thẻ', dataIndex: 'cardNo' },
            { title: 'Loại thẻ', dataIndex: 'cardType' },
            { title: 'Hiệu lực', dataIndex: 'expiry' },
            { title: 'Trạng thái', dataIndex: 'status' },
          ]
        : [
            { title: 'Mã giao dịch', dataIndex: 'refNo' },
            { title: 'Thời gian', dataIndex: 'txnAt', render: fmtDateTime },
            { title: 'Nguồn', dataIndex: 'sourceNo' },
            { title: 'Số tiền', dataIndex: 'amount', render: fmtMoney },
            { title: 'Nội dung', dataIndex: 'description' },
          ];
  const valueOf = (r: any) => (src === 'ACCOUNT_NO' ? r.accountNo : src === 'CARD_NO' ? r.cardNo : r.refNo);
  return (
    <>
      <Input
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        placeholder={item.placeholder || 'Nhập hoặc lấy từ 360 view'}
        addonAfter={
          <Tooltip title={customerId ? 'Copy dữ liệu từ 360 view khách hàng' : 'Chọn khách hàng để dùng 360 view'}>
            <Button type="link" size="small" icon={<CloudDownloadOutlined />} disabled={!customerId || disabled} onClick={pick} style={{ padding: 0, height: 20 }}>
              360
            </Button>
          </Tooltip>
        }
      />
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} width={860} title={`360 view – ${c?.fullName ?? ''}: chọn ${item.name.toLowerCase()}`}>
        <Table
          size="small"
          rowKey="id"
          dataSource={rows || []}
          columns={[
            ...columns,
            {
              title: '',
              width: 80,
              render: (_: any, r: any) => (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => {
                    onChange?.(valueOf(r));
                    setOpen(false);
                  }}
                >
                  Chọn
                </Button>
              ),
            },
          ]}
          pagination={false}
        />
      </Modal>
    </>
  );
}

// ───── Render 1 trường ─────

function FieldInput({ item, customerId, disabled, ...rest }: { item: FormItemDef; customerId?: number | null; disabled?: boolean; value?: any; onChange?: any }) {
  const opts = optionsOf(item);
  if (item.infoType === 'VIEW360') return <View360Input item={item} customerId={customerId} disabled={disabled} {...rest} />;
  switch (item.dataType) {
    case 'TEXT':
      return item.displayType === 'TEXTAREA' ? (
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} placeholder={item.placeholder ?? ''} disabled={disabled} {...rest} />
      ) : (
        <Input placeholder={item.placeholder ?? ''} disabled={disabled} {...rest} />
      );
    case 'NUMBER':
      return (
        <InputNumber
          style={{ width: '100%' }}
          disabled={disabled}
          formatter={(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
          parser={(v) => (v ? Number(v.replace(/\./g, '')) : (null as any))}
          {...rest}
        />
      );
    case 'DATE':
      return <DateInput disabled={disabled} {...rest} />;
    case 'SINGLE_CHOICE':
    case 'CALL_RESULT':
      return item.displayType === 'RADIO' ? (
        <Radio.Group options={opts} disabled={disabled} {...rest} />
      ) : (
        <Select options={opts} allowClear placeholder="Chọn" disabled={disabled} {...rest} />
      );
    case 'MULTI_CHOICE':
      return item.displayType === 'CHECKBOX' ? (
        <Checkbox.Group options={opts} disabled={disabled} {...rest} />
      ) : (
        <Select mode="multiple" options={opts} allowClear placeholder="Chọn" disabled={disabled} {...rest} />
      );
    case 'BOOLEAN':
      if (item.displayType === 'RADIO')
        return (
          <Radio.Group
            disabled={disabled}
            options={[
              { value: true, label: 'Có' },
              { value: false, label: 'Không' },
            ]}
            {...rest}
          />
        );
      if (item.displayType === 'SWITCH') return <Switch checked={!!rest.value} onChange={rest.onChange} disabled={disabled} />;
      return <Checkbox checked={!!rest.value} onChange={(e) => rest.onChange?.(e.target.checked)} disabled={disabled} />;
    case 'BRANCH_RM':
      return <BranchRmInput disabled={disabled} {...rest} />;
    case 'ADMIN_UNIT':
      return <AdminUnitInput disabled={disabled} {...rest} />;
    default:
      return <Input disabled={disabled} {...rest} />;
  }
}

const wide = (it: FormItemDef) =>
  it.displayType === 'TEXTAREA' || it.dataType === 'ADMIN_UNIT' || it.dataType === 'BRANCH_RM' || (it.dataType === 'MULTI_CHOICE' && it.displayType === 'CHECKBOX');

/** Khối trường động trong antd Form – giá trị nằm dưới name ['dyn', <mã trường>]. */
export function DynamicFields({
  items,
  form,
  ticketOnly,
  customerId,
  disabled,
  columns = 2,
}: {
  items: FormItemDef[];
  form: FormInstance;
  ticketOnly?: boolean;
  customerId?: number | null;
  disabled?: boolean;
  columns?: 1 | 2;
}) {
  const values = Form.useWatch('dyn', form) || {};
  const visible = useMemo(() => visibleItems(items, values, { ticketOnly }), [items, values, ticketOnly]);
  if (!items.length) return null;
  if (!visible.length) return <Typography.Text type="secondary">Không có trường thông tin động</Typography.Text>;
  return (
    <Row gutter={16}>
      {visible.map((it) => {
        const depth = depthOf(it, items);
        return (
          <Col key={it.code} xs={24} md={columns === 1 || wide(it) ? 24 : 12}>
            <div className={depth ? `dep-indent-${depth}` : undefined}>
              <Form.Item
                name={['dyn', it.code]}
                label={it.name}
                required={it.required && !(it.dataType === 'BOOLEAN' && it.displayType !== 'RADIO')}
                valuePropName="value"
                rules={[
                  {
                    validator: (_, v) =>
                      it.required && (it.dataType !== 'BOOLEAN' || it.displayType === 'RADIO') && isEmptyValue(it, v)
                        ? Promise.reject(new Error(`Vui lòng nhập "${it.name}"`))
                        : Promise.resolve(),
                  },
                ]}
              >
                <FieldInput item={it} customerId={customerId} disabled={disabled} />
              </Form.Item>
            </div>
          </Col>
        );
      })}
    </Row>
  );
}

// ───── Xem giá trị ─────

export function useDynDisplay() {
  const { data: branches = [] } = useBranches();
  const { data: rms = [] } = useRms();
  const { data: provinces = [] } = useProvinces();
  const { data: wards = [] } = useWards();
  return (it: FormItemDef, v: any): string => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '';
    const opts = optionsOf(it);
    switch (it.dataType) {
      case 'SINGLE_CHOICE':
      case 'CALL_RESULT':
        return opts.find((o) => o.value === v)?.label ?? String(v);
      case 'MULTI_CHOICE':
        return (v as string[]).map((x) => opts.find((o) => o.value === x)?.label ?? x).join(', ');
      case 'BOOLEAN':
        return v === true || v === 'true' ? 'Có' : 'Không';
      case 'DATE':
        return dayjs(v).format('DD/MM/YYYY');
      case 'NUMBER':
        return fmtMoney(Number(v));
      case 'BRANCH_RM':
        return [branches.find((b) => b.id === v.branchId)?.name, rms.find((r) => r.id === v.rmId)?.fullName].filter(Boolean).join(' | ');
      case 'ADMIN_UNIT':
        return [v.address, wards.find((w) => w.id === v.wardId)?.name, provinces.find((p) => p.id === v.provinceId)?.name].filter(Boolean).join(', ');
      default:
        return String(v);
    }
  };
}

export function DynamicValuesView({ items, values, ticketOnly }: { items: FormItemDef[]; values: Record<string, any>; ticketOnly?: boolean }) {
  const show = useDynDisplay();
  const visible = visibleItems(items, values || {}, { ticketOnly });
  if (!visible.length) return <Typography.Text type="secondary">Không có trường thông tin động</Typography.Text>;
  return (
    <Descriptions
      size="small"
      bordered
      column={{ xs: 1, md: 2 }}
      items={visible.map((it) => ({
        key: it.code,
        label: it.name,
        span: wide(it) ? 2 : 1,
        children: show(it, values?.[it.code]) || <Typography.Text type="secondary">—</Typography.Text>,
      }))}
    />
  );
}
