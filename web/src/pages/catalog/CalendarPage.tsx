import { useEffect, useState } from 'react';
import { App, Button, Card, Col, DatePicker, Form, Input, Popconfirm, Row, Select, Space, Table, Tag, TimePicker, Typography } from 'antd';
import { DeleteOutlined, MinusCircleOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { del, errMsg, get, post, put } from '@/api';
import { useAuth } from '@/auth';
import { PageHead } from '@/components/common';
import { hhmmToMinutes, Shift, shiftsTotalMinutes } from '@shared/sla';

export default function CalendarPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const { data, isLoading } = useQuery({ queryKey: ['calendar'], queryFn: () => get('/calendar') });
  const [shifts, setShifts] = useState<Shift[]>([]);
  useEffect(() => {
    if (data) setShifts(data.shifts);
  }, [data]);
  const total = shiftsTotalMinutes(shifts);
  const year = dayjs().year();

  const saveShifts = async () => {
    try {
      await put('/calendar/shifts', { shifts });
      message.success('Đã lưu ca làm việc');
      qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  const addHoliday = async () => {
    const v = await form.validateFields();
    try {
      await post('/calendar/holidays', { ...v, date: v.date.format('YYYY-MM-DD') });
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (e) {
      message.error(errMsg(e));
    }
  };

  return (
    <div className="page">
      <PageHead title="Lịch làm việc" sub="Cấu hình giờ hành chính dùng để tính SLA: 1 ngày làm việc = 8 giờ, trừ thứ 7, Chủ nhật, nghỉ giữa ca, ngày nghỉ lễ; cộng ngày làm bù." />
      <Row gutter={16}>
        <Col xs={24} lg={9}>
          <Card
            title="Ca làm việc (thứ 2 – thứ 6)"
            extra={
              isAdmin && (
                <Button type="primary" size="small" icon={<SaveOutlined />} onClick={saveShifts} disabled={total !== 480}>
                  Lưu
                </Button>
              )
            }
          >
            {shifts.map((s, i) => (
              <Space key={i} style={{ marginBottom: 8 }}>
                <TimePicker.RangePicker
                  format="HH:mm"
                  minuteStep={15}
                  value={[dayjs(s.start, 'HH:mm'), dayjs(s.end, 'HH:mm')]}
                  onChange={(v) => v && setShifts((l) => l.map((x, j) => (j === i ? { start: v[0]!.format('HH:mm'), end: v[1]!.format('HH:mm') } : x)))}
                  disabled={!isAdmin}
                  allowClear={false}
                />
                {isAdmin && shifts.length > 1 && <MinusCircleOutlined onClick={() => setShifts((l) => l.filter((_, j) => j !== i))} />}
              </Space>
            ))}
            {isAdmin && (
              <div>
                <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => setShifts((l) => [...l, { start: '18:00', end: '19:00' }])}>
                  Thêm ca
                </Button>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              Tổng thời gian:{' '}
              <Tag color={total === 480 ? 'green' : 'red'}>
                {Math.floor(total / 60)} giờ {total % 60 ? `${total % 60} phút` : ''}
              </Tag>
              {total !== 480 && <Typography.Text type="danger">phải bằng 8 giờ</Typography.Text>}
            </div>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
              Khoảng giữa các ca ({shifts.length > 1 ? shifts.slice(1).map((s, i) => `${shifts[i].end}–${s.start}`).join(', ') : 'không có'}) là thời gian nghỉ giữa ca, không tính SLA.
              {shifts.some((s) => hhmmToMinutes(s.end) <= hhmmToMinutes(s.start)) && ' Có ca không hợp lệ.'}
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Card title="Ngày nghỉ lễ & ngày làm bù">
            {isAdmin && (
              <Form form={form} layout="inline" style={{ marginBottom: 16, rowGap: 8 }} initialValues={{ type: 'HOLIDAY' }}>
                <Form.Item name="date" rules={[{ required: true, message: 'Chọn ngày' }]}>
                  <DatePicker format="DD/MM/YYYY" placeholder="Ngày" />
                </Form.Item>
                <Form.Item name="type">
                  <Select
                    style={{ width: 150 }}
                    options={[
                      { value: 'HOLIDAY', label: 'Ngày nghỉ lễ' },
                      { value: 'WORKDAY', label: 'Ngày làm bù' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="name" rules={[{ required: true, message: 'Nhập tên' }]}>
                  <Input placeholder="Tên ngày (VD: Quốc khánh)" style={{ width: 220 }} />
                </Form.Item>
                <Button type="primary" icon={<PlusOutlined />} onClick={addHoliday}>
                  Thêm
                </Button>
              </Form>
            )}
            <Table
              rowKey="id"
              size="small"
              loading={isLoading}
              dataSource={(data?.list ?? []).filter((h: any) => h.date >= `${year - 1}`)}
              pagination={{ pageSize: 12 }}
              columns={[
                { title: 'Ngày', dataIndex: 'date', render: (v) => dayjs(v).format('DD/MM/YYYY (dddd)') },
                { title: 'Loại', dataIndex: 'type', render: (v) => (v === 'WORKDAY' ? <Tag color="green">Làm bù</Tag> : <Tag color="volcano">Nghỉ lễ</Tag>) },
                { title: 'Tên', dataIndex: 'name' },
                ...(isAdmin
                  ? [
                      {
                        title: '',
                        width: 50,
                        render: (_: any, r: any) => (
                          <Popconfirm
                            title="Xóa ngày này?"
                            okText="Xóa"
                            cancelText="Hủy"
                            onConfirm={async () => {
                              await del(`/calendar/holidays/${r.id}`);
                              qc.invalidateQueries({ queryKey: ['calendar'] });
                            }}
                          >
                            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                          </Popconfirm>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
