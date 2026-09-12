import { ApiError } from '@/api/client';
import type { User } from '@/api/types';
import type { UserListQuery } from '@/api/users';
import { hasMinRole } from '@/auth/roles';
import { UserToolbar, type StatusFilter } from '@/components/users/UserToolbar';
import {
  useDeleteUser,
  useUpdateUserRole,
  useUpdateUserStatus,
  useUserList,
} from '@/hooks/use-users';
import { authStore } from '@/stores/auth';
import type { ProColumns } from '@ant-design/pro-components';
import { ProTable } from '@ant-design/pro-components';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import {
  App,
  Button,
  Descriptions,
  Form,
  Modal,
  Select,
  Space,
  Tag,
} from 'antd';
import dayjs from 'dayjs';
import { useCallback, useMemo, useState, type FC, type ReactNode } from 'react';

export const Route = createFileRoute('/_layout/users')({
  beforeLoad: async ({ context }) => {
    await context.auth.ready;
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
    if (!hasMinRole(authStore.get().user?.role, 'admin')) {
      throw redirect({ to: '/' });
    }
  },
  component: UsersPage,
});

const ROLE_TAG_COLOR: Record<User['role'], string> = {
  user: 'blue',
  admin: 'orange',
  superadmin: 'red',
};

const ROLE_LABEL: Record<User['role'], string> = {
  user: '普通用户',
  admin: '管理员',
  superadmin: '超级管理员',
};

function RoleTag({ role }: { role: User['role'] }) {
  return <Tag color={ROLE_TAG_COLOR[role]}>{ROLE_LABEL[role]}</Tag>;
}

function StatusTag({ status }: { status: number }) {
  return status === 1 ? (
    <Tag color="success">正常</Tag>
  ) : (
    <Tag color="default">已禁用</Tag>
  );
}

type UserDetailModalProps = {
  user: User | null;
  open: boolean;
  onClose: () => void;
};

const UserDetailModal: FC<UserDetailModalProps> = ({ user, open, onClose }) => {
  return (
    <Modal
      title="用户详情"
      open={open}
      destroyOnHidden
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {user && (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="ID">{user.id}</Descriptions.Item>
          <Descriptions.Item label="用户名">{user.username}</Descriptions.Item>
          <Descriptions.Item label="昵称">
            {user.nickname ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="邮箱">{user.email}</Descriptions.Item>
          <Descriptions.Item label="角色">
            <RoleTag role={user.role} />
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <StatusTag status={user.status} />
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {dayjs(user.createdAt).format('YYYY-MM-DD HH:mm')}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {dayjs(user.updatedAt).format('YYYY-MM-DD HH:mm')}
          </Descriptions.Item>
        </Descriptions>
      )}
    </Modal>
  );
};

type UserRoleModalProps = {
  user: User | null;
  open: boolean;
  onClose: () => void;
};

const ROLE_FORM_OPTIONS = [
  { label: '普通用户', value: 'user' },
  { label: '管理员', value: 'admin' },
];

const UserRoleModal: FC<UserRoleModalProps> = ({ user, open, onClose }) => {
  const { message } = App.useApp();
  const updateRoleMutation = useUpdateUserRole();
  const [form] = Form.useForm();

  const handleSubmit = async () => {
    if (!user) return;
    let values: { role: 'user' | 'admin' };
    try {
      values = await form.validateFields();
    } catch {
      // 校验未通过：表单自身会展示错误提示，无需额外处理
      return;
    }
    try {
      await updateRoleMutation.mutateAsync({
        id: user.id,
        input: { role: values.role },
      });
      message.success('角色修改成功');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        message.error(e.message);
      } else {
        message.error('修改失败，请稍后重试');
      }
    }
  };

  return (
    <Modal
      title={`修改角色：${user?.username ?? ''}`}
      open={open}
      destroyOnHidden
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={updateRoleMutation.isPending}
            onClick={handleSubmit}
          >
            确认
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ role: user?.role === 'admin' ? 'admin' : 'user' }}
      >
        <Form.Item
          name="role"
          label="目标角色"
          rules={[{ required: true, message: '请选择目标角色' }]}
        >
          <Select options={ROLE_FORM_OPTIONS} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

function UsersPage() {
  const { message, modal } = App.useApp();
  const currentUser = useSelector(authStore, (s) => s.user);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [roleUser, setRoleUser] = useState<User | null>(null);

  const query = useMemo<UserListQuery>(
    () => ({
      page,
      pageSize,
      keyword: keyword || undefined,
      status: status === 'all' ? undefined : status === 'enabled' ? 1 : 0,
    }),
    [page, pageSize, keyword, status],
  );

  const { data, isLoading } = useUserList(query);
  const rows = useMemo(() => data?.list ?? [], [data?.list]);
  const updateStatusMutation = useUpdateUserStatus();
  const deleteMutation = useDeleteUser();

  // 改角色仅 superadmin 可见可点：后端路由层 @Roles(SuperAdmin) 会 403 非 superadmin
  const canChangeRole = hasMinRole(currentUser?.role, 'superadmin');

  const handleToggleStatus = useCallback(
    (record: User) => {
      const next = record.status === 1 ? 0 : 1;
      modal.confirm({
        title:
          next === 0
            ? `禁用用户 ${record.username}？`
            : `启用用户 ${record.username}？`,
        content:
          next === 0
            ? '禁用后该用户已签发的令牌立即不可用。'
            : '启用后该用户可重新登录。',
        okText: next === 0 ? '禁用' : '启用',
        okType: next === 0 ? 'danger' : 'primary',
        onOk: () =>
          updateStatusMutation
            .mutateAsync({ id: record.id, input: { status: next as 0 | 1 } })
            .then(() => {
              message.success(next === 0 ? '用户已禁用' : '用户已启用');
            })
            .catch((e: unknown) => {
              if (e instanceof ApiError) {
                message.error(e.message);
              } else {
                message.error('操作失败，请稍后重试');
              }
              throw e;
            }),
      });
    },
    [message, modal, updateStatusMutation],
  );

  const handleDelete = useCallback(
    (record: User) => {
      modal.confirm({
        title: `删除用户 ${record.username}？`,
        content: '删除后其关联数据将被级联清理，且不可恢复。',
        okText: '删除',
        okType: 'danger',
        onOk: () =>
          deleteMutation
            .mutateAsync(record.id)
            .then(() => {
              message.success('用户已删除');
              const capturedPage = page;
              if (rows.length === 1 && capturedPage > 1) {
                setPage((current) =>
                  current === capturedPage ? current - 1 : current,
                );
              }
            })
            .catch((e: unknown) => {
              if (e instanceof ApiError) {
                message.error(e.message);
              } else {
                message.error('删除失败，请稍后重试');
              }
              throw e;
            }),
      });
    },
    [message, modal, deleteMutation, page, rows.length],
  );

  const columns: ProColumns<User>[] = useMemo(
    () => [
      { title: '用户名', dataIndex: 'username', copyable: true },
      {
        title: '昵称',
        dataIndex: 'nickname',
        render: (_, r) => r.nickname ?? '-',
      },
      { title: '邮箱', dataIndex: 'email', copyable: true },
      {
        title: '角色',
        dataIndex: 'role',
        render: (_, r) => <RoleTag role={r.role} />,
      },
      {
        title: '状态',
        dataIndex: 'status',
        render: (_, r) => <StatusTag status={r.status} />,
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        valueType: 'dateTime',
        render: (_, r) => dayjs(r.createdAt).format('YYYY-MM-DD HH:mm'),
      },
      {
        title: '操作',
        valueType: 'option',
        render: (_, record) => {
          // 自己不可操作：后端同样会 403，前端直接禁用按钮
          const operable = record.id !== currentUser?.id;
          const roleOperable = canChangeRole && operable;
          return [
            <a key="detail" onClick={() => setDetailUser(record)}>
              详情
            </a>,
            ...(canChangeRole
              ? [
                  <a
                    key="role"
                    onClick={() => roleOperable && setRoleUser(record)}
                    className={
                      roleOperable
                        ? undefined
                        : 'cursor-not-allowed text-(--ant-color-text-disabled)!'
                    }
                  >
                    改角色
                  </a>,
                ]
              : []),
            <a
              key="status"
              onClick={() => operable && handleToggleStatus(record)}
              className={
                operable
                  ? undefined
                  : 'cursor-not-allowed text-(--ant-color-text-disabled)!'
              }
            >
              {record.status === 1 ? '禁用' : '启用'}
            </a>,
            <a
              key="delete"
              onClick={() => operable && handleDelete(record)}
              className={
                operable
                  ? 'text-(--ant-color-error)!'
                  : 'cursor-not-allowed text-(--ant-color-text-disabled)!'
              }
            >
              删除
            </a>,
          ];
        },
      },
    ],
    [canChangeRole, currentUser?.id, handleDelete, handleToggleStatus],
  );

  let content: ReactNode;
  if (isLoading && rows.length === 0) {
    content = (
      <ProTable<User>
        rowKey="id"
        loading
        dataSource={[]}
        columns={columns}
        search={false}
        options={false}
        dateFormatter="string"
        pagination={false}
      />
    );
  } else {
    content = (
      <ProTable<User>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        columns={columns}
        search={false}
        options={false}
        dateFormatter="string"
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: false,
          onChange: (next) => setPage(next),
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <UserToolbar
        status={status}
        onStatusChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        onSearch={(value) => {
          setKeyword(value);
          setPage(1);
        }}
      />
      <div className="min-h-0 flex-1 px-4 py-4 sm:px-6 md:px-8">{content}</div>
      <UserDetailModal
        user={detailUser}
        open={detailUser !== null}
        onClose={() => setDetailUser(null)}
      />
      <UserRoleModal
        user={roleUser}
        open={roleUser !== null}
        onClose={() => setRoleUser(null)}
      />
    </div>
  );
}
