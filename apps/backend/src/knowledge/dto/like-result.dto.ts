import { ApiProperty } from '@nestjs/swagger';

/** 点赞/取消点赞操作的返回结果 */
export class LikeResultDto {
  @ApiProperty({ description: '操作后的点赞数' })
  likeCount: number;

  @ApiProperty({ description: '操作后当前用户是否已点赞' })
  isLiked: boolean;
}
