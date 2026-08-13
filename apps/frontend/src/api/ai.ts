import type { HookFetchPlugin } from 'hook-fetch';
import { ApiError, http, refreshTokens, retry401 } from './client';
import type {
  Conversation,
  ConversationListResult,
  CreateConversationRequest,
  RenameConversationRequest,
  SendMessageRequest,
} from './types';

export function createConversationApi(input: CreateConversationRequest = {}) {
  return http.post<Conversation>('ai/conversations', input).json();
}

export function listConversationsApi(page = 1, pageSize = 20) {
  return http
    .get<ConversationListResult>('ai/conversations', { page, pageSize })
    .json();
}

export function getConversationApi(id: string) {
  return http.get<Conversation>(`ai/conversations/${id}`).json();
}

export function renameConversationApi(
  id: string,
  input: RenameConversationRequest,
) {
  return http.patch<Conversation>(`ai/conversations/${id}`, input).json();
}

export function deleteConversationApi(id: string) {
  return http.delete<{ success: boolean }>(`ai/conversations/${id}`).json();
}

type SseChunk = { event?: string; data?: string };

// 同一帧内多行 `data:` 用换行拼接，避免内容丢失（NestJS SSE 会把多行文本拆成多行 data）
function createSseTransform(): TransformStream<string, SseChunk> {
  let buffer = '';
  const parseFrame = (frame: string): SseChunk => {
    let event = '';
    const dataParts: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataParts.push(line.slice(5).replace(/^ /, ''));
      }
    }
    return { event, data: dataParts.join('\n') };
  };
  return new TransformStream<string, SseChunk>({
    transform(chunk, controller) {
      buffer += chunk;
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (frame.trim()) controller.enqueue(parseFrame(frame));
      }
    },
    flush(controller) {
      if (buffer.trim()) controller.enqueue(parseFrame(buffer));
    },
  });
}

// SSE 是 text/event-stream，流式消费走 stream()，绕过 http 实例的 afterResponse 解包；
// 这里在 beforeStream 把字节流解码并解析成帧对象，保证流里取到的是 { event, data }
const sseParsePlugin: HookFetchPlugin = {
  name: 'sse-parse',
  beforeStream(ctx) {
    return ctx.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(createSseTransform());
  },
};

// SSE 流式 401 无法经 refreshOn401 插件重放（stream() 对 onError 的 resolve 会直接返回空流），
// 故标记 skipAuthRefresh，由外层 retry401 在业务层刷新后重建流
export async function streamSendMessageApi(
  conversationId: string,
  input: SendMessageRequest,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return retry401(refreshTokens, () =>
    consumeStream(conversationId, input, onDelta, signal),
  );
}

async function consumeStream(
  conversationId: string,
  input: SendMessageRequest,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let full = '';
  const req = http.post(`ai/conversations/${conversationId}/messages`, input, {
    plugins: [sseParsePlugin],
    extra: { skipAuthRefresh: true },
  });
  const onAbort = () => req.abort();
  if (signal && !signal.aborted) {
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    for await (const chunk of req.stream<SseChunk>()) {
      const frame = chunk.result;
      if (frame?.event === 'delta') {
        full += frame.data ?? '';
        onDelta?.(frame.data ?? '');
      } else if (frame?.event === 'error') {
        throw new ApiError(frame.data || '生成失败');
      } else if (frame?.event === 'done') {
        break;
      }
    }
    return full;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
