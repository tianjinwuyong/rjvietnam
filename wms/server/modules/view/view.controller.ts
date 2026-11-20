import { Controller, Get, Res, Req } from '@nestjs/common';
import type { Request, Response } from 'express';
import { join } from 'path';
import { Public } from '../../common/auth/public.decorator';

@Public()
@Controller()
export class ViewController {

  @Get(['/', '*'])
  async render(@Req() req: Request, @Res() res: Response): Promise<void> {
    // API 请求不在这里处理（由其他模块的 /api 路由先行匹配）
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    const indexPath = join(process.cwd(), 'dist', 'client', 'index.html');
    res.sendFile(indexPath);
  }
}
