import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

import axios from "axios";
import {
  isPrivateIp,
  createSafeLookup,
  fetchPublicImage,
  SsrfBlockedError,
} from "./safeFetch.js";

beforeEach(() => vi.clearAllMocks());

describe("isPrivateIp", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata
    "172.16.5.4",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.7",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.9",
    "203.0.113.4",
    "224.0.0.1",
    "255.255.255.255",
  ])("flags private/reserved IPv4 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "151.101.1.69", "172.32.0.1"])(
    "allows public IPv4 %s",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    }
  );

  it("flags IPv6 loopback and unspecified", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);
  });

  it("strips the zone id before checking link-local IPv6", () => {
    expect(isPrivateIp("fe80::1%eth0")).toBe(true);
  });

  it("flags ULA, link-local and multicast IPv6", () => {
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12::3")).toBe(true);
    expect(isPrivateIp("fe80::5")).toBe(true);
    expect(isPrivateIp("ff02::1")).toBe(true);
  });

  it("validates the embedded IPv4 of a mapped address", () => {
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows public IPv6 (and the abbreviated ::2 form)", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIp("::2")).toBe(false);
  });

  it("treats a non-IP string as private (fail closed)", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });
});

describe("createSafeLookup", () => {
  const publicEntry = [{ address: "8.8.8.8", family: 4 }];

  it("returns a single address for the callback-style (no options) call", () => {
    const impl = vi.fn((_h, _o, cb: any) => cb(null, publicEntry));
    const lookup = createSafeLookup(impl as never);
    const cb = vi.fn();
    (lookup as any)("example.com", cb);
    expect(impl).toHaveBeenCalledWith("example.com", { all: true }, expect.any(Function));
    expect(cb).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("returns the full list when options.all is set", () => {
    const impl = vi.fn((_h, _o, cb: any) => cb(null, publicEntry));
    const lookup = createSafeLookup(impl as never);
    const cb = vi.fn();
    (lookup as any)("example.com", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, publicEntry, undefined);
  });

  it("blocks resolution to a private address", () => {
    const impl = vi.fn((_h, _o, cb: any) => cb(null, [{ address: "127.0.0.1", family: 4 }]));
    const lookup = createSafeLookup(impl as never);
    const cb = vi.fn();
    (lookup as any)("evil.test", {}, cb);
    const err = cb.mock.calls[0][0];
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err.message).toContain("127.0.0.1");
  });

  it("propagates an underlying DNS error", () => {
    const dnsErr = new Error("ENOTFOUND");
    const impl = vi.fn((_h, _o, cb: any) => cb(dnsErr));
    const lookup = createSafeLookup(impl as never);
    const cb = vi.fn();
    (lookup as any)("nope.test", {}, cb);
    expect(cb).toHaveBeenCalledWith(dnsErr, "", undefined);
  });

  it("defaults to the real dns.lookup when no impl is given", () => {
    expect(typeof createSafeLookup()).toBe("function");
  });
});

describe("fetchPublicImage", () => {
  it("rejects a malformed URL", async () => {
    await expect(fetchPublicImage("http://[::bad")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects a non-http(s) scheme", async () => {
    await expect(fetchPublicImage("file:///etc/passwd")).rejects.toThrow(/Unsupported URL scheme/);
  });

  it("fetches bytes via the injected client with SSRF-safe request options", async () => {
    const get = vi.fn(async () => ({ data: Buffer.from("imgbytes") }));
    const lookup = vi.fn();
    const out = await fetchPublicImage("https://cdn.example.com/a.png", {
      get: get as never,
      lookup: lookup as never,
      timeoutMs: 1234,
      maxBytes: 99,
    });
    expect(out.equals(Buffer.from("imgbytes"))).toBe(true);
    const [url, cfg] = get.mock.calls[0] as [string, any];
    expect(url).toBe("https://cdn.example.com/a.png");
    expect(cfg).toMatchObject({
      responseType: "arraybuffer",
      timeout: 1234,
      maxRedirects: 0,
      maxContentLength: 99,
      maxBodyLength: 99,
    });
    expect(cfg.httpAgent).toBeDefined();
    expect(cfg.httpsAgent).toBeDefined();
  });

  it("falls back to axios and default timeout/size/lookup when not overridden", async () => {
    (axios.get as any).mockResolvedValue({ data: Buffer.from("x") });
    const out = await fetchPublicImage("http://example.com/i.png");
    expect(out.equals(Buffer.from("x"))).toBe(true);
    const cfg = (axios.get as any).mock.calls[0][1];
    expect(cfg.timeout).toBe(5_000);
    expect(cfg.maxContentLength).toBe(10 * 1024 * 1024);
    expect(cfg.httpAgent).toBeDefined();
  });
});
