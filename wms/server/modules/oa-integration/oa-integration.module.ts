import { Module } from '@nestjs/common';
import { OaIntegrationController } from './oa-integration.controller';
import { OaIntegrationService } from './oa-integration.service';

@Module({
  controllers: [OaIntegrationController],
  providers: [OaIntegrationService],
  exports: [OaIntegrationService],
})
export class OaIntegrationModule {}
