import { Message, MessageRole } from './entities/message.entity.js';

/**
 * 把按时间正序的历史行规整成合法的对话序列（纯函数，与 DI/预算无关）：
 * - 裁掉尾部「有问无答」的孤立 user 行——凭证/上游失败会在最新一轮留下未被回答的
 *   user 行，过滤空 AI 行后相邻 Human 会破坏角色交替（Bedrock/兼容网关直接 400），
 *   且下一轮会把同一问题重复送入；
 * - 相邻 user 只保留更近的那条——空 AI 行落在**中间**时同样会留下孤立 user
 *   （[u1, ai(''), u2, ai2] 过滤后是 [u1, u2, ai2]），旧问题已被后续提问取代，
 *   重复送还容易让模型串线；
 * - 首条非 system 消息必须是 user——预算裁剪可能把某轮回答留下、却把它的提问裁掉。
 *
 * 幂等：预算选行后再调用一次即可补齐最后一条不变式。
 */
export function normalizeTurns(rows: Message[]): Message[] {
  let tailEnd = rows.length;
  while (tailEnd > 0 && rows[tailEnd - 1].role === MessageRole.User) {
    tailEnd--;
  }

  const normalized: Message[] = [];
  for (const m of rows.slice(0, tailEnd)) {
    if (
      m.role === MessageRole.User &&
      normalized.at(-1)?.role === MessageRole.User
    ) {
      normalized.pop();
    }
    normalized.push(m);
  }
  while (normalized.length > 0 && normalized[0].role !== MessageRole.User) {
    normalized.shift();
  }
  return normalized;
}
