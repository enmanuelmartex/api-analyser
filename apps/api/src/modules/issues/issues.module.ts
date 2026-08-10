import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IssueLifecycleService } from './issue-lifecycle.service';
import { IssuesService } from './issues.service';
import { IssuesController } from './issues.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [IssuesController],
  providers: [IssueLifecycleService, IssuesService],
  exports: [IssueLifecycleService, IssuesService],
})
export class IssuesModule {}
