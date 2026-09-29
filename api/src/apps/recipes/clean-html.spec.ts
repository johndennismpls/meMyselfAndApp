import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScrapeService } from './scrape.service';

/**
 * §11.3, against saved HTML in __fixtures__/. The three site fixtures are real
 * pages, committed, because the thing being tested is whether the strip survives
 * the markup real recipe sites actually ship.
 */

// Jest runs this suite as ESM, where __dirname is undefined; rootDir is `api`.
const FIXTURES = join(process.cwd(), 'src/apps/recipes/__fixtures__');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const scraper = new ScrapeService(new ConfigService());

describe('cleanHtml — the synthetic edge cases', () => {
  const page = scraper.clean(fixture('sidebar-ingredients.html'));

  it('keeps an ingredient list parked in a sidebar', () => {
    // A readability port discards this. The whitelist strip is the reason we
    // do not use one.
    expect(page.text).toContain('1 1/2 cups all-purpose flour');
    expect(page.text).toContain('1 1/4 cups buttermilk');
  });

  it('marks list items with a leading dash', () => {
    expect(page.text).toContain('- 2 tablespoons granulated sugar');
  });

  it('keeps the steps', () => {
    expect(page.text).toContain('Whisk the dry ingredients');
    expect(page.text).toContain('about 2 minutes a side');
  });

  it('strips nav, header, footer, forms, buttons, and scripts', () => {
    expect(page.text).not.toContain('analytics.track');
    expect(page.text).not.toContain('Search');
    expect(page.text).not.toContain('© 2026');
  });

  it('strips aside[role=complementary] but not other asides', () => {
    expect(page.text).not.toContain('Belgian Waffles');
    expect(page.text).toContain('all-purpose flour');
  });

  it('captures og:title, og:image, og:site_name, and canonical', () => {
    expect(page.title).toBe('Fluffy Buttermilk Pancakes');
    expect(page.ogImageUrl).toBe('/images/pancakes-hero.jpg');
    expect(page.siteName).toBe("Sally's Baking");
    expect(page.canonicalUrl).toBe('https://example.test/fluffy-pancakes/');
  });

  it('collapses runs of blank lines', () => {
    expect(page.text).not.toMatch(/\n{3}/);
  });
});

describe('cleanHtml — real recipe pages', () => {
  it.each([
    ['bbcgoodfood-pancakes.html', '100g plain flour', 'bbcgoodfood.com'],
    ['food-pancakes.html', '1 teaspoon baking powder', 'food.com'],
    ['kingarthur-pancakes.html', 'baking powder', 'kingarthurbaking.com'],
  ])('%s keeps its ingredients and metadata', (name, ingredient, host) => {
    const page = scraper.clean(fixture(name));

    expect(page.text).toContain(ingredient);
    expect(page.title).toBeTruthy();
    expect(page.canonicalUrl).toContain(host);

    // A cleaned recipe page is typically 3-15k characters (§4.2). Far outside
    // that band means the strip took too much or too little.
    expect(page.text.length).toBeGreaterThan(1_000);
    expect(page.text.length).toBeLessThan(40_000);
  });

  it('drops the script payload from a real page', () => {
    const page = scraper.clean(fixture('food-pancakes.html'));
    expect(page.text).not.toContain('function(');
    expect(page.text).not.toContain('window.');
  });
});

describe('assertUsable', () => {
  it('rejects a page that needs JavaScript to render', () => {
    const page = scraper.clean(fixture('js-shell.html'));
    expect(page.text.length).toBeLessThan(200);
    expect(() => scraper.assertUsable(page)).toThrow(
      'That page had no readable text',
    );
  });

  it('rejects a page over the character cap rather than truncating it', () => {
    // No silent truncation: a quarter-million characters isn't a recipe page.
    const page = scraper.clean(`<p>${'pancakes '.repeat(40_000)}</p>`);
    expect(() => scraper.assertUsable(page)).toThrow('too large to process');
  });

  it('accepts an ordinary recipe page', () => {
    const page = scraper.clean(fixture('bbcgoodfood-pancakes.html'));
    expect(() => scraper.assertUsable(page)).not.toThrow();
  });
});
