import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KeysetPaginator } from '../common/pagination/keyset-paginator.js';
import { toConversationDetail, toConversationItem } from './ai.mapper.js';
import type { ConversationDetailDto } from './dto/conversation-detail.dto.js';
import type { ConversationItemDto } from './dto/conversation-item.dto.js';
import { ConversationListResultDto } from './dto/conversation-list-result.dto.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { Conversation } from './entities/conversation.entity.js';
import { Message } from './entities/message.entity.js';

/**
 * 会话元信息服务：会话的增删改查（create/list/get/rename/remove）。
 *
 * 发送消息的流式生成管线（模型调用、中断/超时、落库状态机、标题生成）已拆到
 * `ChatStreamService`（`arch-single-responsibility`）；控制器据此分别注入。
 */
@Injectable()
export class AiService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly paginator: KeysetPaginator,
  ) {}

  /** AI：创建会话（返回允许式契约视图，与列表项同形）。 */
  async create(
    userId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationItemDto> {
    const conversation = await this.conversationRepo.save({
      userId,
      model: dto.model ?? null,
    });
    return toConversationItem(conversation);
  }

  /**
   * AI：游标分页查询会话列表（按最近活跃倒序）。
   *
   * 排序键取 `updatedAt`（每次发消息都会刷新，把会话顶到最前）：它只增不减，行只会移到
   * 已取过的方向，因此**不会重复**。代价是翻页期间被更新的行会被跳过 —— 哪怕它本来还没被
   * 取到，更新后也已移到游标之前，需刷新或重拉首页才能看到。这是可变排序键的固有取舍，
   * 产品上可接受（列表本就按「最近活跃」排序，刚活跃的会话本就该在最前）；改用偏移分页更糟：
   * 窗口滑动会同时造成重复与漏行。
   * @param userId 归属用户
   * @param cursor 上一页返回的 nextCursor；省略表示第一页
   * @param limit 每页条数；由 `KeysetPaginator` 归一化到 `[1, MAX_PAGE_SIZE]`
   * @returns list 与下一页游标（null 表示已到底）
   */
  async list(
    userId: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<ConversationListResultDto> {
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .where('c.userId = :userId', { userId });
    const page = await this.paginator.fetchPage(qb, cursor, limit, 'updatedAt');
    return {
      list: page.list.map(toConversationItem),
      nextCursor: page.nextCursor,
    };
  }

  /** AI：拉取单会话（带消息），返回允许式详情契约视图。 */
  async get(userId: string, id: string): Promise<ConversationDetailDto> {
    const conversation = await this.conversationRepo.findOne({
      where: { id, userId },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    const messages = await this.messageRepo.find({
      where: { conversationId: id },
      order: { createdAt: 'ASC' },
    });
    return toConversationDetail(conversation, messages);
  }

  /** AI：重命名会话（返回允许式契约视图，与列表项同形）。 */
  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<ConversationItemDto> {
    const conversation = await this.conversationRepo.findOne({
      where: { id, userId },
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    conversation.title = title;
    return toConversationItem(await this.conversationRepo.save(conversation));
  }

  /** AI：删除会话（含消息级联）。 */
  async remove(userId: string, id: string): Promise<null> {
    const result = await this.conversationRepo.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('会话不存在');
    return null;
  }
}
