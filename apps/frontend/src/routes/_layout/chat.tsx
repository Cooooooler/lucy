import ChatConversations from '@/page-components/chat/chat-conversations.tsx';
import {
  BulbOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  SmileOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Bubble,
  Prompts,
  Sender,
  Suggestion,
  ThoughtChain,
} from '@ant-design/x';
import { createFileRoute } from '@tanstack/react-router';
import { Flex, Splitter } from 'antd';
import { useState } from 'react';

export const Route = createFileRoute('/_layout/chat')({
  component: ChatPage,
});

function ChatPage() {
  const [value, setValue] = useState('');
  return (
    <Splitter className={'h-full'} collapsible={{ motion: true }}>
      <Splitter.Panel collapsible defaultSize="20%" min="15%" max="70%">
        <ChatConversations />
      </Splitter.Panel>
      <Splitter.Panel className={'flex'}>
        <Flex vertical justify="space-between" style={{ flex: 1 }}>
          <Bubble.List
            items={[
              {
                key: '1',
                role: 'user',
                placement: 'end',
                content: 'Hello Ant Design X!',
                avatar: <UserOutlined />,
              },
              {
                key: '2',
                role: 'ai',
                content: 'Hello World!',
              },
              {
                key: '3',
                role: 'ai',
                content: '',
                loading: true,
              },
            ]}
          />
          <Flex vertical gap={12} className={'px-4!'}>
            <Prompts
              items={[
                {
                  key: '1',
                  icon: <BulbOutlined style={{ color: '#FFD700' }} />,
                  label: 'Ignite Your Creativity',
                },
                {
                  key: '2',
                  icon: <SmileOutlined style={{ color: '#52C41A' }} />,
                  label: 'Tell me a Joke',
                },
              ]}
            />
            <Suggestion items={[{ label: 'Write a report', value: 'report' }]}>
              {({ onTrigger, onKeyDown }) => {
                return (
                  <Sender
                    value={value}
                    onChange={(nextVal) => {
                      if (nextVal === '/') {
                        onTrigger();
                      } else if (!nextVal) {
                        onTrigger(false);
                      }
                      setValue(nextVal);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder='Type "/" to trigger suggestion'
                  />
                );
              }}
            </Suggestion>
          </Flex>
        </Flex>
      </Splitter.Panel>
      <Splitter.Panel collapsible defaultSize="20%" max="70%">
        <ThoughtChain
          className={'pl-4'}
          style={{ width: 200 }}
          items={[
            {
              title: 'Hello Ant Design X!',
              status: 'success',
              description: 'status: success',
              icon: <CheckCircleOutlined />,
              content:
                'Ant Design X help you build AI chat/platform app as ready-to-use 📦.',
            },
            {
              title: 'Hello World!',
              status: 'success',
              description: 'status: success',
              icon: <CheckCircleOutlined />,
            },
            {
              title: 'Pending...',
              status: 'loading',
              description: 'status: pending',
              icon: <LoadingOutlined />,
            },
          ]}
        />
      </Splitter.Panel>
    </Splitter>
  );
}
