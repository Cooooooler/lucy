/** 归一后的流式分片：text/reasoning 为本次增量，finishReason 为结束原因（stop/length） */
export interface NormalizedChunk {
  text: string;
  reasoning: string;
  finishReason?: string;
}

/**
 * 归一不同 vendor 的流式分片——独立适配层，避免会话流服务承担供应商差异
 * （新增供应商只改这里，`ChatStreamService` 只消费统一形状）。
 *
 * - `content` 可能是字符串（OpenAI/Ollama）或内容块数组（Anthropic）；
 * - 思考链可能在 `additional_kwargs.reasoning_content`（OpenAI/Ollama）或内容块里（Anthropic）；
 * - 结束原因 Ollama 用 `done_reason`、OpenAI/Anthropic 用 `finish_reason`，Anthropic 的长度
 *   截断记作 `max_tokens`，统一归一为 `length`。
 */
export function normalizeChunk(chunk: unknown): NormalizedChunk {
  const c = chunk as {
    content?: unknown;
    additional_kwargs?: { reasoning_content?: unknown };
    response_metadata?: { done_reason?: unknown; finish_reason?: unknown };
  };
  const { text, reasoning } = extractContent(c.content);
  const extraReasoning =
    typeof c.additional_kwargs?.reasoning_content === 'string'
      ? c.additional_kwargs.reasoning_content
      : '';
  const rawFinish =
    typeof c.response_metadata?.done_reason === 'string'
      ? c.response_metadata.done_reason
      : typeof c.response_metadata?.finish_reason === 'string'
        ? c.response_metadata.finish_reason
        : undefined;
  return {
    text,
    reasoning: reasoning + extraReasoning,
    finishReason: rawFinish === 'max_tokens' ? 'length' : rawFinish,
  };
}

// content 为字符串或内容块数组（Anthropic）：text 归一为回答，thinking/reasoning 块归一为思考
function extractContent(content: unknown): { text: string; reasoning: string } {
  if (typeof content === 'string') return { text: content, reasoning: '' };
  if (!Array.isArray(content)) return { text: '', reasoning: '' };
  let text = '';
  let reasoning = '';
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; text?: unknown; thinking?: unknown };
    const value =
      typeof b.text === 'string'
        ? b.text
        : typeof b.thinking === 'string'
          ? b.thinking
          : '';
    if (b.type === 'thinking' || b.type === 'reasoning') reasoning += value;
    else text += value;
  }
  return { text, reasoning };
}
