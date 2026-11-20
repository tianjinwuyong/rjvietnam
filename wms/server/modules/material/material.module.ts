import { Module } from '@nestjs/common';

import { MaterialController } from './material.controller';
import { MaterialService } from './material.service';
import { SubstitutionController } from './substitution.controller';
import { SubstitutionService } from './substitution.service';
import { SystemModule } from '../system/system.module';

@Module({
  imports: [SystemModule],
  controllers: [MaterialController, SubstitutionController],
  providers: [MaterialService, SubstitutionService],
})
export class MaterialModule {}
