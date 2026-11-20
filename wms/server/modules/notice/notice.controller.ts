import { Controller, Get, Post, Param, Query, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NoticeService } from './notice.service';
import type { Request } from 'express';

/**
 * 站内消息（顶部铃铛）。
 * 只读自己的消息：userId 一律取登录态，不接受前端传参，避免越权看他人消息。
 */
@Controller('api/notices')
@NeedLogin()
export class NoticeController {
  constructor(private readonly noticeService: NoticeService) {}

  private userIdOf(req: Request): string {
    return req.userContext?.userId || '';
  }

  /** 我的消息列表 */
  @Get()
  async list(
    @Req() req: Request,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('onlyUnread') onlyUnread?: string,
  ) {
    const userId = this.userIdOf(req);
    const data = await this.noticeService.list({
      userId,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      onlyUnread: onlyUnread === 'true' || onlyUnread === '1',
    });
    return { code: 0, message: 'success', data };
  }

  /** 未读数（铃铛角标） */
  @Get('unread-count')
  async unreadCount(@Req() req: Request) {
    const count = await this.noticeService.unreadCount(this.userIdOf(req));
    return { code: 0, message: 'success', data: { count } };
  }

  /** 标记单条已读 */
  @Post(':id/read')
  async markRead(@Req() req: Request, @Param('id') id: string) {
    const updated = await this.noticeService.markRead(this.userIdOf(req), id);
    return { code: 0, message: 'success', data: { updated } };
  }

  /** 全部已读 */
  @Post('read-all')
  async markAllRead(@Req() req: Request) {
    const updated = await this.noticeService.markAllRead(this.userIdOf(req));
    return { code: 0, message: 'success', data: { updated } };
  }
}
