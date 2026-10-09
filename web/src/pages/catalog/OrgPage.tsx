import { useMemo, useState } from 'react';
import { App, Card, Col, Empty, Row, Select, Switch, Table, Tag, Tree, Typography } from 'antd';
import { ApartmentOutlined, CrownOutlined, WarningOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { errMsg, put } from '@/api';
import { useAuth } from '@/auth';
import { PageHead } from '@/components/common';
import { useDepartments, useUsers } from '@/hooks';
import { buildTree, descendants } from '@/utils';

export default function OrgPage() {
  const { isAdmin, user: me } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { data: depts = [] } = useDepartments();
  const { data: users = [] } = useUsers();
  const [sel, setSel] = useState<number | null>(null);

  const tree = useMemo(() => {
    const conv = (n: any): any => ({
      key: n.id,
      title: (
        <span>
          {n.name}{' '}
          {!n.focalUserId && n.level > 1 && (
            <Tag color="orange" icon={<WarningOutlined />} style={{ marginLeft: 4 }}>
              chưa có đầu mối
            </Tag>
          )}
        </span>
      ),
      children: n.children?.map(conv),
    });
    return buildTree(depts).map(conv);
  }, [depts]);

  const dept = depts.find((d) => d.id === sel);
  const ids = sel ? new Set(descendants(depts, sel)) : null;
  const staff = users.filter((u) => !ids || (u.departmentId && ids.has(u.departmentId)));
  const own = dept ? users.filter((u) => u.departmentId === dept.id) : [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['departments'] });
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  return (
    <div className="page">
      <PageHead
        title="Đơn vị & nhân sự"
        sub="Dữ liệu cây đơn vị và nhân sự (giả lập service tổ chức). Đầu mối phòng ban là người nhận tác vụ sinh tự động; nhân sự ngừng hoạt động không được phân giao."
      />
      <Row gutter={16}>
        <Col xs={24} lg={9}>
          <Card title="Cây đơn vị" styles={{ body: { padding: 12 } }}>
            <Tree treeData={tree} defaultExpandAll showLine onSelect={(k) => setSel(k.length ? Number(k[0]) : null)} selectedKeys={sel ? [sel] : []} icon={<ApartmentOutlined />} />
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          {dept && (
            <Card title={dept.name} style={{ marginBottom: 16 }} extra={<span className="mono muted">{dept.code}</span>}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span>
                  <CrownOutlined style={{ color: '#d97706' }} /> Nhân sự đầu mối nhận tác vụ:
                </span>
                <Select
                  style={{ width: 280 }}
                  allowClear
                  placeholder="Chưa chỉ định"
                  disabled={!isAdmin}
                  value={dept.focalUserId ?? undefined}
                  options={own.map((u) => ({ value: u.id, label: `${u.fullName}${u.active ? '' : ' (ngừng hoạt động)'}` }))}
                  onChange={async (v) => {
                    try {
                      await put(`/departments/${dept.id}`, { focalUserId: v ?? null });
                      message.success('Đã cập nhật đầu mối');
                      refresh();
                    } catch (e) {
                      message.error(errMsg(e));
                    }
                  }}
                  notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Phòng ban chưa có nhân sự trực tiếp" />}
                />
                {dept.focalUserId && dept.focalUserActive === false && <Tag color="red">Đầu mối đang ngừng hoạt động</Tag>}
              </div>
            </Card>
          )}
          <Card title={dept ? `Nhân sự thuộc ${dept.name}` : 'Toàn bộ nhân sự'} styles={{ body: { padding: 0 } }}>
            <Table
              rowKey="id"
              size="middle"
              dataSource={staff}
              pagination={false}
              columns={[
                {
                  title: 'Họ tên',
                  dataIndex: 'fullName',
                  render: (v, r: any) => (
                    <div>
                      <b>{v}</b> {r.role === 'ADMIN' && <Tag color="purple">Quản trị</Tag>}
                      {depts.some((d) => d.focalUserId === r.id) && <Tag color="gold">Đầu mối</Tag>}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {r.username} · {r.title}
                      </div>
                    </div>
                  ),
                },
                { title: 'Phòng ban', dataIndex: 'departmentName' },
                {
                  title: 'Hoạt động',
                  dataIndex: 'active',
                  width: 120,
                  render: (v, r: any) => (
                    <Switch
                      checked={v}
                      disabled={!isAdmin || r.id === me?.id}
                      onChange={async (c) => {
                        try {
                          await put(`/users/${r.id}`, { active: c });
                          refresh();
                        } catch (e) {
                          message.error(errMsg(e));
                        }
                      }}
                    />
                  ),
                },
              ]}
            />
          </Card>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
            Gợi ý kiểm thử: tắt hoạt động của một đầu mối rồi hoàn thành tác vụ công việc trước đó để xem cảnh báo "sinh tác vụ tự động thất bại".
          </Typography.Paragraph>
        </Col>
      </Row>
    </div>
  );
}
