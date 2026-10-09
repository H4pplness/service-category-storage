import { useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Button, Dropdown, Empty, Layout, List, Menu, Popover, Spin, Tag, Typography } from 'antd';
import {
  AppstoreOutlined,
  BellOutlined,
  CalendarOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FormOutlined,
  LogoutOutlined,
  ProfileOutlined,
  ShopOutlined,
  SwapOutlined,
  TagsOutlined,
  UnorderedListOutlined,
  ApartmentOutlined,
  CheckSquareOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import { get, post } from './api';
import { fmtDateTime } from './utils';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TicketList from './pages/tickets/TicketList';
import TicketCreate from './pages/tickets/TicketCreate';
import TicketDetail from './pages/tickets/TicketDetail';
import TaskList from './pages/tasks/TaskList';
import CatalogTree from './pages/catalog/CatalogTree';
import Fields from './pages/catalog/Fields';
import Forms from './pages/catalog/Forms';
import FormBuilder from './pages/catalog/FormBuilder';
import Workflows from './pages/catalog/Workflows';
import WorkflowEditor from './pages/catalog/WorkflowEditor';
import Services from './pages/catalog/Services';
import CalendarPage from './pages/catalog/CalendarPage';
import OrgPage from './pages/catalog/OrgPage';
import AssistantLauncher from './components/assistant/AssistantLauncher';

const { Sider, Header, Content } = Layout;

function NotificationBell() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => get('/notifications'), refetchInterval: 15000 });
  const items: any[] = data?.items ?? [];
  const content = (
    <div style={{ width: 380 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b>Thông báo</b>
        <Button
          size="small"
          type="link"
          onClick={async () => {
            await post('/notifications/read-all');
            qc.invalidateQueries({ queryKey: ['notifications'] });
          }}
        >
          Đánh dấu đã đọc tất cả
        </Button>
      </div>
      {items.length ? (
        <List
          style={{ maxHeight: 420, overflow: 'auto' }}
          dataSource={items}
          renderItem={(n: any) => (
            <List.Item
              style={{ cursor: 'pointer', background: n.read ? undefined : '#f5f7ff', padding: '10px 12px', borderRadius: 8 }}
              onClick={async () => {
                await post(`/notifications/${n.id}/read`);
                qc.invalidateQueries({ queryKey: ['notifications'] });
                setOpen(false);
                if (n.link) nav(n.link);
              }}
            >
              <List.Item.Meta
                title={<span style={{ fontWeight: n.read ? 400 : 600 }}>{n.title}</span>}
                description={
                  <>
                    <div>{n.message}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtDateTime(n.createdAt)}
                    </Typography.Text>
                  </>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty description="Không có thông báo" />
      )}
    </div>
  );
  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomRight">
      <Badge count={data?.unread ?? 0} size="small">
        <Button shape="circle" icon={<BellOutlined />} />
      </Badge>
    </Popover>
  );
}

function UserMenu() {
  const { user, logout, login } = useAuth();
  const nav = useNavigate();
  const { data: users = [] } = useQuery({ queryKey: ['demo-users'], queryFn: () => get('/auth/demo-users') });
  if (!user) return null;
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items: [
          {
            key: 'switch',
            icon: <SwapOutlined />,
            label: 'Chuyển nhanh người dùng (demo)',
            children: users.map((u: any) => ({
              key: `u${u.id}`,
              label: (
                <span>
                  {u.fullName} <Typography.Text type="secondary">· {u.departmentName}</Typography.Text>
                </span>
              ),
              disabled: u.id === user.id,
              onClick: async () => {
                await login(u.username, '123456');
                nav('/');
              },
            })),
          },
          { type: 'divider' },
          { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', danger: true, onClick: logout },
        ],
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <Avatar style={{ background: '#4f46e5' }}>{user.fullName.split(' ').pop()?.[0]}</Avatar>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 600 }}>
            {user.fullName} {user.role === 'ADMIN' && <Tag color="purple">Quản trị</Tag>}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {user.departmentName}
          </Typography.Text>
        </div>
      </div>
    </Dropdown>
  );
}

function Shell() {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const menu = [
    { key: '/', icon: <DashboardOutlined />, label: 'Tổng quan' },
    { key: '/tickets/new', icon: <FileAddOutlined />, label: 'Tạo phiếu' },
    { key: '/tickets', icon: <FileTextOutlined />, label: 'Danh sách phiếu' },
    { key: '/tasks', icon: <CheckSquareOutlined />, label: 'Tác vụ' },
    {
      key: 'catalog',
      icon: <AppstoreOutlined />,
      label: 'Danh mục',
      children: [
        { key: '/catalog/products', icon: <ShopOutlined />, label: 'Sản phẩm' },
        { key: '/catalog/operations', icon: <TagsOutlined />, label: 'Nghiệp vụ' },
        { key: '/catalog/fields', icon: <UnorderedListOutlined />, label: 'Trường nhập liệu' },
        { key: '/catalog/forms', icon: <FormOutlined />, label: 'Mẫu nhập liệu' },
        { key: '/catalog/workflows', icon: <DeploymentUnitOutlined />, label: 'Quy trình' },
        { key: '/catalog/services', icon: <ProfileOutlined />, label: 'Dịch vụ' },
        { key: '/catalog/calendar', icon: <CalendarOutlined />, label: 'Lịch làm việc' },
        { key: '/catalog/org', icon: <ApartmentOutlined />, label: 'Đơn vị & nhân sự' },
      ],
    },
  ];
  const all = ['/tickets/new', '/tickets', '/tasks', ...menu[4].children!.map((c) => c.key)];
  const selected = all.filter((k) => loc.pathname === k || loc.pathname.startsWith(k + '/')).sort((a, b) => b.length - a.length)[0] ?? '/';
  const selKey = selected === '/tickets' && loc.pathname === '/tickets/new' ? '/tickets/new' : selected;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider className="app-sider" width={240} collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="light" breakpoint="lg">
        <div className="brand">
          <div className="brand-logo">D</div>
          {!collapsed && (
            <div>
              DCMS
              <small>Phiếu & Tác vụ</small>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selKey]}
          defaultOpenKeys={loc.pathname.startsWith('/catalog') ? ['catalog'] : []}
          items={menu}
          onClick={(e) => nav(e.key)}
          style={{ padding: 8 }}
        />
        {!collapsed && !isAdmin && (
          <div style={{ padding: '0 20px', fontSize: 12 }} className="muted">
            <ClusterOutlined /> Danh mục chỉ quản trị mới được chỉnh sửa
          </div>
        )}
      </Sider>
      <Layout>
        <Header className="app-header">
          <div />
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <NotificationBell />
            <UserMenu />
          </div>
        </Header>
        <Content>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tickets" element={<TicketList />} />
            <Route path="/tickets/new" element={<TicketCreate />} />
            <Route path="/tickets/:id" element={<TicketDetail />} />
            <Route path="/tasks" element={<TaskList />} />
            <Route path="/catalog/products" element={<CatalogTree kind="products" />} />
            <Route path="/catalog/operations" element={<CatalogTree kind="operations" />} />
            <Route path="/catalog/fields" element={<Fields />} />
            <Route path="/catalog/forms" element={<Forms />} />
            <Route path="/catalog/forms/:id" element={<FormBuilder />} />
            <Route path="/catalog/workflows" element={<Workflows />} />
            <Route path="/catalog/workflows/:id" element={<WorkflowEditor />} />
            <Route path="/catalog/services" element={<Services />} />
            <Route path="/catalog/calendar" element={<CalendarPage />} />
            <Route path="/catalog/org" element={<OrgPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Content>
      </Layout>
      <AssistantLauncher />
    </Layout>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <Spin size="large" />
      </div>
    );
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route path="*" element={user ? <Shell /> : <Navigate to="/login" />} />
    </Routes>
  );
}
