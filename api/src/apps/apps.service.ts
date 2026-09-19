import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../database/database.constants';
import type { DrizzleDB } from '../database/database.types';
import { apps } from '../database/schema';
import type { AppSummaryDto } from './dto/app-summary.dto';

@Injectable()
export class AppsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  findAll(): Promise<AppSummaryDto[]> {
    return this.db
      .select({ name: apps.name, displayName: apps.displayName })
      .from(apps)
      .orderBy(apps.name);
  }
}
