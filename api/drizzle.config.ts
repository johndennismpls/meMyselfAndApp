import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. drizzle-kit would otherwise fall back to libpq ' +
      'defaults and migrate the wrong database. Copy .env.example to .env.',
  );
}

// Surfaces which database is about to be migrated, since drizzle-kit does not.
console.log(`drizzle-kit target: ${url.replace(/\/\/[^@]*@/, '//***@')}`);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './src/database/migrations',
  dbCredentials: { url },
});
