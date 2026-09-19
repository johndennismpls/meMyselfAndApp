import { ApiProperty } from '@nestjs/swagger';

/** The public shape of an app: just enough for the web client to render a tile. */
export class AppSummaryDto {
  @ApiProperty({
    description: 'Stable slug, also used to look up the tile thumbnail.',
    example: 'wordsearch',
  })
  name: string;

  @ApiProperty({
    description: 'Human-readable label shown on the tile.',
    example: 'Word Search',
    nullable: true,
    type: String,
  })
  displayName: string | null;
}
