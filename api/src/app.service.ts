import { Injectable } from '@nestjs/common';

export interface Greeting {
  message: string;
}

@Injectable()
export class AppService {
  getHello(): Greeting {
    return { message: 'Hello World!' };
  }
}
