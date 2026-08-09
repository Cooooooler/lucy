import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_layout/chat')({
  component: ChatPage,
});

function ChatPage() {
  return <div></div>;
}
