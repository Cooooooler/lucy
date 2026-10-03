import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  ModelProviderType,
  ModelProviderVendor,
} from '../entities/model-provider.entity.js';
import { CreateModelProviderDto } from './create-model-provider.dto.js';

const valid = {
  name: 'gpt-4o-mini',
  type: ModelProviderType.Llm,
  vendor: ModelProviderVendor.OpenAI,
  baseUrl: 'https://api.openai.com/v1',
  contextLength: 128000,
  apiKey: 'sk-secret',
};

describe('CreateModelProviderDto', () => {
  it('合法输入通过', async () => {
    expect(
      await validate(plainToInstance(CreateModelProviderDto, valid)),
    ).toHaveLength(0);
  });

  it('name 首尾空白被 trim', () => {
    const dto = plainToInstance(CreateModelProviderDto, {
      ...valid,
      name: '  gpt-4o-mini  ',
    });
    expect(dto.name).toBe('gpt-4o-mini');
  });

  it('name 为空串或纯空白校验失败', async () => {
    expect(
      await validate(
        plainToInstance(CreateModelProviderDto, { ...valid, name: '' }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(CreateModelProviderDto, { ...valid, name: '   ' }),
      ),
    ).not.toHaveLength(0);
  });

  it('apiKey 一旦提供即非空（空串校验失败）', async () => {
    expect(
      await validate(
        plainToInstance(CreateModelProviderDto, { ...valid, apiKey: '' }),
      ),
    ).not.toHaveLength(0);
  });

  it('ollama 可省略 apiKey', async () => {
    const dto = plainToInstance(CreateModelProviderDto, {
      name: 'qwen2.5',
      type: ModelProviderType.Llm,
      vendor: ModelProviderVendor.Ollama,
      baseUrl: 'http://localhost:11434',
      contextLength: 32768,
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
