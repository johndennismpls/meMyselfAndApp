import { ApiProperty } from '@nestjs/swagger';

export class GreetingDto {
  @ApiProperty({ example: 'Hello World!' })
  message: string;
}
