import { guardUrl, isBlockedAddress, type Resolver } from './fetch-guard';

/**
 * §11.3. A table of hostile URLs, checked without touching the network — the
 * resolver is injected, so "a hostname that resolves to 10.x" is a test case
 * rather than a DNS entry someone has to own.
 */

/** Every host resolves to one public address unless the test says otherwise. */
const publicResolver: Resolver = () =>
  Promise.resolve([{ address: '93.184.216.34' }]);

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.53.1.9', 'the rest of 127/8'],
    ['10.0.0.1', 'private 10/8'],
    ['172.16.0.1', 'private 172.16/12'],
    ['172.31.255.255', 'the top of 172.16/12'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.169.254', 'the cloud metadata endpoint'],
    ['0.0.0.0', 'unspecified'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fe80::1', 'IPv6 link-local'],
    ['fd00::1', 'IPv6 unique-local'],
    ['::ffff:10.0.0.1', 'an IPv4-mapped private address'],
    ['not-an-address', 'anything unparseable'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    ['93.184.216.34'],
    ['8.8.8.8'],
    ['172.32.0.1'], // just outside 172.16/12
    ['2606:2800:220:1:248:1893:25c8:1946'],
  ])('allows the public address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('guardUrl', () => {
  it.each([
    ['file:///etc/passwd', 'scheme'],
    ['ftp://example.com/x', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['not a url at all', 'malformed'],
  ])('rejects %s', async (url, reason) => {
    await expect(guardUrl(url, publicResolver)).resolves.toMatchObject({
      ok: false,
      reason,
    });
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:3000/',
    'http://10.1.2.3/',
    'https://192.168.0.1/router',
  ])('rejects the literal private address in %s', async (url) => {
    await expect(guardUrl(url, publicResolver)).resolves.toMatchObject({
      ok: false,
      reason: 'private-address',
    });
  });

  it('rejects a public hostname that resolves to a private address', async () => {
    const resolver: Resolver = () => Promise.resolve([{ address: '10.0.0.7' }]);
    await expect(
      guardUrl('https://evil.test/', resolver),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'private-address',
    });
  });

  it('rejects a host resolving to both a public and a private address', async () => {
    // Otherwise this is a DNS rebinding race we lose.
    const resolver: Resolver = () =>
      Promise.resolve([{ address: '93.184.216.34' }, { address: '127.0.0.1' }]);
    await expect(
      guardUrl('https://evil.test/', resolver),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'private-address',
    });
  });

  it('rejects a host that does not resolve', async () => {
    const resolver: Resolver = () => Promise.reject(new Error('ENOTFOUND'));
    await expect(
      guardUrl('https://nope.test/', resolver),
    ).resolves.toMatchObject({
      ok: false,
      reason: 'unresolvable',
    });
  });

  it('allows an ordinary public page', async () => {
    const result = await guardUrl(
      'https://www.seriouseats.com/pancakes',
      publicResolver,
    );
    expect(result.ok).toBe(true);
  });
});
