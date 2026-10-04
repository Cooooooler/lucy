import { normalizeChunk } from './stream-chunk.js';

describe('normalizeChunk', () => {
  it('字符串 content → text', () => {
    expect(normalizeChunk({ content: '你好' })).toEqual({
      text: '你好',
      reasoning: '',
      finishReason: undefined,
    });
  });

  it('OpenAI/Ollama 的 reasoning_content 归入 reasoning', () => {
    expect(
      normalizeChunk({
        content: '',
        additional_kwargs: { reasoning_content: '先思考' },
      }),
    ).toMatchObject({ text: '', reasoning: '先思考' });
  });

  it('Anthropic 内容块：text 与 thinking 分路', () => {
    expect(
      normalizeChunk({
        content: [
          { type: 'thinking', thinking: '想一想' },
          { type: 'text', text: '答案' },
        ],
      }),
    ).toMatchObject({ text: '答案', reasoning: '想一想' });
  });

  it('Ollama done_reason 作为 finishReason', () => {
    expect(
      normalizeChunk({
        content: '',
        response_metadata: { done_reason: 'length' },
      }).finishReason,
    ).toBe('length');
  });

  it('Anthropic finish_reason=max_tokens 归一为 length', () => {
    expect(
      normalizeChunk({
        content: '',
        response_metadata: { finish_reason: 'max_tokens' },
      }).finishReason,
    ).toBe('length');
  });

  it('未知形状回退为空增量', () => {
    expect(normalizeChunk({})).toEqual({
      text: '',
      reasoning: '',
      finishReason: undefined,
    });
    expect(normalizeChunk({ content: 42 })).toEqual({
      text: '',
      reasoning: '',
      finishReason: undefined,
    });
  });
});
