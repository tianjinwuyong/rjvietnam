import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

export function NeedLogin() {
  return UseGuards(JwtAuthGuard);
}
