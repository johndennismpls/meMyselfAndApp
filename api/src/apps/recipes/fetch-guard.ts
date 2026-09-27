import { isIP } from 'node:net';
import { lookup, type LookupOptions } from 'node:dns/promises';
import { Agent, type Dispatcher } from 'node:undici';

/**
 * The SSRF guard (§4.1). The server fetches URLs that trace back to user input —
 * a pasted link, or one a model read off the open web. Unguarded that is a
 * request forgery primitive pointed at whatever else is on the host or the LAN.
 *
 * Pure apart from the DNS resolver, which is injectable so the tests can cover a
 * hostname resolving to a private address without touching the network.
 */

export type GuardFailure =
  'malformed' | 'scheme' | 'private-address' | 'unresolvable';

/** One address this URL's host is allowed to resolve to, as checked by the guard. */
export type PinnedAddress = { address: string; family: 4 | 6 };

export type GuardResult =
  | { ok: true; url: URL; addresses: PinnedAddress[] }
  | { ok: false; reason: GuardFailure };

/** Matches `dns.lookup(host, { all: true })`. */
export type Resolver = (host: string) => Promise<{ address: string }[]>;

const defaultResolver: Resolver = (host) => lookup(host, { all: true });

/**
 * Loopback, private, link-local, unique-local, unspecified, and the IPv4-mapped
 * IPv6 forms of all of them. Written out rather than pulled from a package
 * because the list is short and the failure mode of a wrong one is severe.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;

  if (family === 6) {
    const v6 = address.toLowerCase().split('%')[0];
    if (v6 === '::' || v6 === '::1') return true;
    // Unique-local fc00::/7 and link-local fe80::/10.
    if (/^f[cd]/.test(v6)) return true;
    if (/^fe[89ab]/.test(v6)) return true;
    // ::ffff:10.0.0.1 and friends — re-check as IPv4. The WHATWG URL parser
    // never produces the dotted form, only the compressed hex form
    // (::ffff:169.254.169.254 becomes ::ffff:a9fe:a9fe), so both need matching.
    const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mappedDotted) return isBlockedAddress(mappedDotted[1]);
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
    if (mappedHex) {
      const high = parseInt(mappedHex[1], 16);
      const low = parseInt(mappedHex[2], 16);
      const quad = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
      return isBlockedAddress(quad);
    }
    return false;
  }

  const [a, b] = address.split('.').map(Number);
  if (a === 0) return true; // unspecified / "this network"
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. the cloud metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  return false;
}

/**
 * Validates one URL. Called on the initial URL *and* on every redirect hop — a
 * public URL redirecting to 127.0.0.1 is the whole attack.
 */
export async function guardUrl(
  raw: string,
  resolver: Resolver = defaultResolver,
): Promise<GuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'scheme' };
  }

  // A literal IP in the host skips DNS entirely.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) return { ok: false, reason: 'private-address' };
    const family = isIP(host) === 6 ? 6 : 4;
    return { ok: true, url, addresses: [{ address: host, family }] };
  }

  let resolved: { address: string }[];
  try {
    resolved = await resolver(host);
  } catch {
    return { ok: false, reason: 'unresolvable' };
  }
  if (resolved.length === 0) return { ok: false, reason: 'unresolvable' };

  // Any blocked address disqualifies the host: a name resolving to both a public
  // and a private address would otherwise be a race we lose.
  if (resolved.some((a) => isBlockedAddress(a.address))) {
    return { ok: false, reason: 'private-address' };
  }

  const addresses: PinnedAddress[] = resolved.map((a) => ({
    address: a.address,
    family: isIP(a.address) === 6 ? 6 : 4,
  }));
  return { ok: true, url, addresses };
}

export const MAX_REDIRECTS = 3;

/**
 * Pins a connection to the address(es) the guard already validated, instead of
 * letting `fetch` re-resolve the hostname at connect time. Without this, an
 * attacker controlling DNS for their own domain (TTL=0) can return a public
 * address for the guard's lookup and then 127.0.0.1/169.254.169.254 for the
 * real connection — the check and the connect race, and the attacker wins the
 * race whenever they like.
 *
 * `node:undici` (not the npm package) on purpose: it's the exact class Node's
 * global `fetch` checks the `dispatcher` option against, so there's no risk of
 * a duplicate-but-incompatible `Dispatcher` class from a separately installed
 * copy.
 */
export function pinnedLookup(
  addresses: PinnedAddress[],
): (
  hostname: string,
  options: LookupOptions & { all?: boolean },
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | { address: string; family: number }[],
    family?: number,
  ) => void,
) => void {
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(
        null,
        addresses.map((a) => ({ address: a.address, family: a.family })),
      );
      return;
    }
    const [first] = addresses;
    callback(null, first.address, first.family);
  };
}

/**
 * One dispatcher per guarded fetch. Callers must close it (`await
 * dispatcher.close()`) once they're done reading the response body — closing
 * it any earlier would cut the body stream off mid-read.
 */
export function pinnedDispatcher(addresses: PinnedAddress[]): Dispatcher {
  return new Agent({
    connect: { lookup: pinnedLookup(addresses) } as never,
  });
}
