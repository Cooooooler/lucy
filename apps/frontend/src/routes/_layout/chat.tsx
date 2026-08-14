import { createFileRoute } from '@tanstack/react-router';
import { Empty } from 'antd';

export const Route = createFileRoute('/_layout/chat')({
  component: ChatEmptyPage,
});

function ChatEmptyPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <Empty description="暂无会话，请通过 /chat/:conversationId 访问" />
    </div>
  );
}
