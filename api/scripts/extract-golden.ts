/**
 * Manual, NOT in CI (§11.3). Runs the real prompts against the committed fixture
 * pages and, optionally, a handful of real requests, and prints what comes back.
 *
 * This is how you check that a prompt change actually improved anything. It
 * costs real money — roughly $0.10-0.20 per page for extraction and $0.25-0.50
 * per find — and runs when you ask it to.
 *
 *   pnpm exec ts-node --compilerOptions '{"module":"commonjs"}' scripts/extract-golden.ts
 *   pnpm exec ts-node --compilerOptions '{"module":"commonjs"}' scripts/extract-golden.ts --find "vegan sheet-pan pancakes"
 *
 * Needs ANTHROPIC_API_KEY in the environment or in api/.env.
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeRepository } from '../src/apps/recipes/claude.repository';
import { DiscoveryService } from '../src/apps/recipes/discovery.service';
import { ExtractionService } from '../src/apps/recipes/extraction.service';
import { ScrapeService } from '../src/apps/recipes/scrape.service';
import { RecipeTrace } from '../src/apps/recipes/trace';

const FIXTURES = join(process.cwd(), 'src/apps/recipes/__fixtures__');

/** The real fetched pages, not the synthetic edge cases. */
const REAL_FIXTURES = readdirSync(FIXTURES).filter(
  (name) =>
    name.endsWith('.html') &&
    name !== 'js-shell.html' &&
    name !== 'sidebar-ingredients.html',
);

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      'ANTHROPIC_API_KEY is not set. This script calls the real API.',
    );
    process.exit(1);
  }

  const claude = new ClaudeRepository(new Anthropic());
  const config = new ConfigService();
  const trace = new RecipeTrace();
  const scraper = new ScrapeService(config);
  const extraction = new ExtractionService(claude, trace);

  const findIndex = process.argv.indexOf('--find');
  const request = findIndex === -1 ? null : process.argv[findIndex + 1];

  if (request) {
    console.log(`\n=== DISCOVERY: ${request} ===\n`);
    const discovery = new DiscoveryService(claude, trace, config);
    const result = await discovery.discover(request);
    console.log('interpreted as:', result.interpretedAs);
    for (const [i, candidate] of result.candidates.entries()) {
      console.log(`${i + 1}. ${candidate.site_name} — ${candidate.title}`);
      console.log(`   ${candidate.url}`);
      console.log(`   ${candidate.why}`);
    }
    return;
  }

  for (const name of REAL_FIXTURES) {
    console.log(`\n=== EXTRACTION: ${name} ===\n`);
    const page = scraper.clean(readFileSync(join(FIXTURES, name), 'utf8'));
    const url = page.canonicalUrl ?? `file://${name}`;
    const result = await extraction.extract(page, url);

    if (!result.ok) {
      console.log(`not a recipe: ${result.rejectionReason}`);
      continue;
    }

    const r = result.recipe;
    console.log(r.title);
    if (r.description) console.log(`\n${r.description}`);
    if (r.origin) console.log(`\norigin: ${r.origin}`);
    console.log(
      `\nserves ${r.servings ?? r.yield_text ?? '—'} | prep ${r.prep_minutes ?? '—'} | ` +
        `cook ${r.cook_minutes ?? '—'} | total ${r.total_minutes ?? '—'}`,
    );
    for (const group of r.ingredients) {
      console.log(`\n${group.heading ?? 'Ingredients'}`);
      for (const item of group.items) console.log(`  - ${item}`);
    }
    console.log('\nSteps');
    for (const [i, step] of r.steps.entries())
      console.log(`  ${i + 1}. ${step}`);
    if (r.notes.length) {
      console.log('\nNotes');
      for (const note of r.notes) console.log(`  - ${note}`);
    }
    console.log(`\nimage: ${r.image_url ?? '—'}`);
  }
}

void main();
