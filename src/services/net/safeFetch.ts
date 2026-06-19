import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import axios, { type AxiosResponse } from "axios";

/**
 * SSRF-safe outbound fetching for user-supplied URLs (e.g. image asset uploads).
 *
 * The threat: a tenant passes `http://169.254.169.254/...` (cloud metadata),
 * `http://localhost:5432`, or any private/loopback address and tricks the server
 * into fetching internal resources. We defend in depth:
 *
 *   1. Only http/https URLs are allowed (no file://, gopher://, etc.).
 *   2. The connecting socket's resolved IP is validated AT CONNECT TIME via a
 *      custom DNS lookup hook, which also defeats DNS-rebinding (a hostname that
 *      resolves to a public IP on the first lookup and a private one later).
 *   3. Redirects are disabled, so a 302 to an internal address cannot bypass (2).
 *   4. A response size cap and timeout bound resource use.
 */

const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this host"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // RFC6598 carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 metadata)
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved (incl. 255.255.255.255 broadcast)
];

/**
 * Convert a dotted-quad IPv4 string to its 32-bit unsigned integer value.
 * Callers pass strings already validated by {@link isIP} (or the embedded-IPv4
 * regex), so the format is trusted here.
 */
function ipv4ToInt(ip: string): number {
  let value = 0;
  for (const part of ip.split(".")) {
    value = value * 256 + Number(part);
  }
  return value >>> 0;
}

function ipv4InRange(ipInt: number, base: string, prefix: number): boolean {
  // All ranges use prefixes 4..24, so (32 - prefix) is always a valid 1..31 shift.
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (ipv4ToInt(base) & mask);
}

function isPrivateIpv4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(([base, prefix]) => ipv4InRange(ipInt, base, prefix));
}

function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // strip zone id (fe80::1%eth0)
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d): validate the embedded IPv4.
  const mapped = addr.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const head = parseInt(addr.split(":")[0] || "0", 16);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * True if `ip` is a private, loopback, link-local, or otherwise non-public
 * address that outbound requests must never reach. A string that is not a valid
 * IP is treated as private (fail closed).
 */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return true;
}

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

type LookupImpl = typeof dnsLookup;

/**
 * Build a DNS lookup function (for an http/https Agent) that rejects resolution
 * to any private address. It runs at socket-connect time, so it also blocks DNS
 * rebinding. Exported for testing; production wires the real `dns.lookup`.
 */
export function createSafeLookup(impl: LookupImpl = dnsLookup): LookupImpl {
  const safeLookup = ((hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: unknown,
      family?: number
    ) => void;
    const opts = (typeof options === "function" ? {} : options) as { all?: boolean };

    impl(hostname, { ...opts, all: true } as never, (err, addresses) => {
      if (err) {
        cb(err, "", undefined);
        return;
      }
      const list = addresses as unknown as Array<{ address: string; family: number }>;
      const blocked = list.find((entry) => isPrivateIp(entry.address));
      if (blocked) {
        cb(
          new SsrfBlockedError(`Refusing to connect to private address ${blocked.address} (${hostname}).`),
          "",
          undefined
        );
        return;
      }
      if (opts.all) {
        cb(null, list as never, undefined);
        return;
      }
      cb(null, list[0].address, list[0].family);
    });
  }) as unknown as LookupImpl;
  return safeLookup;
}

export interface FetchImageOptions {
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Maximum response size in bytes. */
  maxBytes?: number;
  /** Injectable DNS lookup (tests); defaults to the SSRF-safe wrapper. */
  lookup?: LookupImpl;
  /** Injectable HTTP client (tests); defaults to axios. */
  get?: typeof axios.get;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Fetch an image from a user-supplied URL with SSRF protections. Returns the
 * raw bytes. Throws {@link SsrfBlockedError} for a disallowed scheme or a
 * private target, or the underlying transport error otherwise.
 */
export async function fetchPublicImage(url: string, options: FetchImageOptions = {}): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`Unsupported URL scheme '${parsed.protocol}' (only http/https allowed).`);
  }

  const lookup = options.lookup ?? createSafeLookup();
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxContentLength = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const get = options.get ?? axios.get;

  const response: AxiosResponse = await get(url, {
    responseType: "arraybuffer",
    timeout,
    maxRedirects: 0,
    maxContentLength,
    maxBodyLength: maxContentLength,
    httpAgent: new HttpAgent({ lookup }),
    httpsAgent: new HttpsAgent({ lookup }),
  });
  return Buffer.from(response.data);
}
