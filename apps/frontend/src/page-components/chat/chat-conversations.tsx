import {
  DeleteOutlined,
  EditOutlined,
  ShareAltOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ConversationsProps } from '@ant-design/x';
import { Conversations } from '@ant-design/x';
import type { GetProp } from 'antd';

interface ChatConversationsProps {}

const items: GetProp<ConversationsProps, 'items'> = Array.from({
  length: 4,
}).map((_, index) => ({
  key: `item${index + 1}`,
  label: `Conversation Item ${index + 1}`,
  disabled: index === 3,
}));

function ChatConversations(_props: ChatConversationsProps) {
  const menuConfig: ConversationsProps['menu'] = (conversation) => ({
    items: [
      {
        label: 'Rename',
        key: 'Rename',
        icon: <EditOutlined />,
      },
      {
        label: 'Share',
        key: 'Share',
        icon: <ShareAltOutlined />,
      },
      {
        type: 'divider',
      },
      {
        label: 'Archive',
        key: 'Archive',
        icon: <StopOutlined />,
        disabled: true,
      },
      {
        label: 'Delete Chat',
        key: 'deleteChat',
        icon: <DeleteOutlined />,
        danger: true,
      },
    ],
    onClick: (itemInfo) => {
      console.log(`Click ${itemInfo.key}`, conversation.key);
      itemInfo.domEvent.stopPropagation();
    },
  });

  return (
    <Conversations defaultActiveKey="item1" menu={menuConfig} items={items} />
  );
}

export default ChatConversations;
