import { Injectable } from '@nestjs/common';
import type { GreetingDto } from './dto/greeting.dto';

@Injectable()
export class AppService {
  getHello(): GreetingDto {
    return { message: 'Hello World!' };
  }
}
