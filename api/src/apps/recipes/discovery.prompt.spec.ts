import { DISCOVERY_SYSTEM, discoveryTurn } from './discovery.prompt';

/**
 * The system prompt is the cache prefix (§5.5), so the preferences have to ride
 * in the user turn. These two tests are what keeps that true.
 */

describe('discoveryTurn', () => {
  it('leaves the request alone when there are no preferences', () => {
    expect(discoveryTurn('give me a pancakes recipe', [])).toBe(
      'give me a pancakes recipe',
    );
  });

  it('puts the preferences above the request, one bullet each', () => {
    expect(
      discoveryTurn('give me a brownie recipe', [
        'No tree nuts',
        'I only have a microwave',
      ]),
    ).toBe(
      '<standing_preferences>\n' +
        '- No tree nuts\n' +
        '- I only have a microwave\n' +
        '</standing_preferences>\n\n' +
        'give me a brownie recipe',
    );
  });

  it('keeps the preferences out of the cached system prompt', () => {
    expect(DISCOVERY_SYSTEM).toContain('<standing_preferences>');
    expect(DISCOVERY_SYSTEM).not.toContain('No tree nuts');
  });
});
