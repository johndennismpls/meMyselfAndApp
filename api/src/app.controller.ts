import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import type { Greeting } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): Greeting {
    return this.appService.getHello();
  }
}
