import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppsService } from './apps.service';
import { AppSummaryDto } from './dto/app-summary.dto';

@ApiTags('apps')
@Controller('apps')
export class AppsController {
  constructor(private readonly appsService: AppsService) {}

  @Get()
  @ApiOperation({ summary: 'List every app, name and display name only.' })
  @ApiOkResponse({ type: [AppSummaryDto] })
  findAll(): Promise<AppSummaryDto[]> {
    return this.appsService.findAll();
  }
}
