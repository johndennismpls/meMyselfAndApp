import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { DRIZZLE } from '../src/database/database.constants';
import type { DrizzleDB } from '../src/database/database.types';
import { apps } from '../src/database/schema';

describe('apps table', () => {
  let mod: Awaited<ReturnType<typeof buildModule>>;
  let db: DrizzleDB;

  const buildModule = () =>
    Test.createTestingModule({ imports: [AppModule] }).compile();

  beforeAll(async () => {
    mod = await buildModule();
    db = mod.get<DrizzleDB>(DRIZZLE);
  });

  afterEach(async () => {
    await db.delete(apps);
  });

  afterAll(async () => {
    await mod.close();
  });

  it('inserts and reads rows', async () => {
    const [row] = await db
      .insert(apps)
      .values({ name: 'stronglifts', displayName: 'StrongLifts 5x5' })
      .returning();

    expect(row).toMatchObject({
      id: expect.any(Number),
      name: 'stronglifts',
      displayName: 'StrongLifts 5x5',
    });
    expect(await db.select().from(apps)).toEqual([row]);
  });

  it('defaults createdAt to the insert time', async () => {
    const before = Date.now();
    const [row] = await db.insert(apps).values({ name: 'no-timestamp' }).returning();

    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('leaves displayName null when omitted', async () => {
    const [row] = await db.insert(apps).values({ name: 'bare' }).returning();
    expect(row.displayName).toBeNull();
  });
});
