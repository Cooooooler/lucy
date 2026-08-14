import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_layout/chat')({
  component: ChatLayout,
});

function ChatLayout() {
  return <Outlet />;
}
