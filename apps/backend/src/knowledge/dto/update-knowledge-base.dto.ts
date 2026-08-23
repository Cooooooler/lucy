import { PartialType } from '@nestjs/swagger';
import { CreateKnowledgeBaseDto } from './create-knowledge-base.dto.js';

export class UpdateKnowledgeBaseDto extends PartialType(
  CreateKnowledgeBaseDto,
) {}
