import { useState } from 'react';
import { App, Avatar, Button, Form, Input, Tag, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth';
import { errMsg, get } from '@/api';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { data: users = [] } = useQuery({ queryKey: ['demo-users'], queryFn: () => get('/auth/demo-users') });

  const submit = async (v: any) => {
    setLoading(true);
    try {
      await login(v.username, v.password);
      nav('/');
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, fontWeight: 700 }}>
          <div className="brand-logo" style={{ background: 'rgba(255,255,255,.15)' }}>
            D
          </div>
          DCMS
        </div>
        <div>
          <h1 style={{ fontSize: 40, lineHeight: 1.15, margin: 0, fontWeight: 700 }}>
            Tạo phiếu, xử lý tác vụ
            <br />
            theo quy trình.
          </h1>
          <p style={{ opacity: 0.8, fontSize: 16, maxWidth: 460, marginTop: 16 }}>
            Mỗi phiếu áp dụng quy trình theo dịch vụ, tác vụ được sinh tự động qua từng công việc, SLA được theo dõi theo thời gian thực.
          </p>
        </div>
        <div style={{ opacity: 0.6, fontSize: 13 }}>© DCMS · Phiếu & Tác vụ</div>
      </div>
      <div className="login-panel">
        <div style={{ width: '100%', maxWidth: 420 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            Đăng nhập
          </Typography.Title>
          <Typography.Text type="secondary">Dùng tài khoản mẫu bên dưới, mật khẩu chung: 123456</Typography.Text>
          <Form form={form} layout="vertical" onFinish={submit} style={{ marginTop: 24 }} initialValues={{ password: '123456' }}>
            <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}>
              <Input size="large" prefix={<UserOutlined />} placeholder="vd: admin" />
            </Form.Item>
            <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
              <Input.Password size="large" prefix={<LockOutlined />} />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              Đăng nhập
            </Button>
          </Form>
          <div className="section-title" style={{ marginTop: 28 }}>
            Tài khoản mẫu
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, maxHeight: 300, overflow: 'auto' }}>
            {users.map((u: any) => (
              <div key={u.id} className="demo-user" onClick={() => submit({ username: u.username, password: '123456' })}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Avatar size="small" style={{ background: u.role === 'ADMIN' ? '#7c3aed' : '#4f46e5' }}>
                    {u.fullName.split(' ').pop()[0]}
                  </Avatar>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {u.fullName} {u.role === 'ADMIN' && <Tag color="purple">QT</Tag>}
                    </div>
                    <div className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.username} · {u.departmentName}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
