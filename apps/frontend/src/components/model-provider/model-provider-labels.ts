import type {
  ModelProviderProtocol,
  ModelProviderType,
  ModelProviderVendor,
} from '@/api/types';

/** 模型供应商：与后端 `ModelProviderVendor` 枚举一一对应（决定实际调用的 SDK） */
export const VENDOR_OPTIONS: {
  label: string;
  value: ModelProviderVendor;
}[] = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Ollama', value: 'ollama' },
];

export const VENDOR_LABEL: Record<ModelProviderVendor, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
};

/** 供应商标签的强调色（仅装饰，不影响语义） */
export const VENDOR_COLOR: Record<ModelProviderVendor, string> = {
  openai: '#10a37f',
  anthropic: '#d97757',
  ollama: '#6b7280',
};

/** 各供应商的默认 Base URL：切换供应商时用于回填（用户已手填则不覆盖） */
export const VENDOR_DEFAULT_BASE_URL: Record<ModelProviderVendor, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434',
};

/** 模型类型：与后端 `ModelProviderType` 枚举一一对应 */
export const MODEL_TYPE_OPTIONS: {
  label: string;
  value: ModelProviderType;
}[] = [
  { label: 'LLM', value: 'llm' },
  { label: '文本嵌入', value: 'text-embedding' },
  { label: '语音转文字', value: 'speech2text' },
  { label: '语音合成', value: 'tts' },
  { label: '内容审核', value: 'moderation' },
];

export const MODEL_TYPE_LABEL: Record<ModelProviderType, string> = {
  llm: 'LLM',
  'text-embedding': '文本嵌入',
  speech2text: '语音转文字',
  tts: '语音合成',
  moderation: '内容审核',
};

/** 类型标签的强调色（仅装饰，不影响语义） */
export const MODEL_TYPE_COLOR: Record<ModelProviderType, string> = {
  llm: '#45b7d1',
  'text-embedding': '#7c6cf0',
  speech2text: '#f0a13c',
  tts: '#e06c9f',
  moderation: '#4ecdc4',
};

/** API 协议：仅 LLM 有意义 */
export const PROTOCOL_OPTIONS: {
  label: string;
  value: ModelProviderProtocol;
}[] = [
  { label: 'Chat Completions', value: 'chat-completions' },
  { label: 'Responses API', value: 'responses' },
];

export const PROTOCOL_LABEL: Record<ModelProviderProtocol, string> = {
  'chat-completions': 'Chat Completions',
  responses: 'Responses API',
};
