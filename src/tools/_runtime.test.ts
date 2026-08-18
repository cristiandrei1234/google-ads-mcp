import { describe, it, expect, afterEach } from "vitest";
import { asTool, renderToolResult, maxResultChars, DEFAULT_MAX_RESULT_CHARS } from "./_runtime.js";
import config from "../config/env.js";

afterEach(() => {
  delete (config as { GOOGLE_ADS_MAX_RESULT_CHARS?: number }).GOOGLE_ADS_MAX_RESULT_CHARS;
});

describe("asTool", () => {
  it("wraps a successful result as a single JSON text block", async () => {
    const res = await asTool(async (a: { x: number }) => ({ ok: a.x }), { x: 5 });
    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(JSON.parse(res.content[0].text)).toEqual({ ok: 5 });
  });

  it("serialises without indentation (2-space indent cost ~a third of the payload)", async () => {
    const res = await asTool(async () => ({ a: 1 }), undefined);
    expect(res.content[0].text).toBe(JSON.stringify({ a: 1 }));
  });

  it("passes the args through to the function", async () => {
    const seen: unknown[] = [];
    await asTool(async (a: string) => seen.push(a), "hello");
    expect(seen).toEqual(["hello"]);
  });

  it("renders a thrown Error through toErrorMessage", async () => {
    const res = await asTool(async () => {
      throw new Error("boom");
    }, undefined);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Error: boom");
  });

  it("renders a thrown string", async () => {
    const res = await asTool(async () => {
      throw "raw string failure";
    }, undefined);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Error: raw string failure");
  });

  it("renders a nested errors[] payload", async () => {
    const res = await asTool(async () => {
      throw { errors: [{ message: "nested message" }] };
    }, undefined);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Error: nested message");
  });

  it("bounds an oversized array and says how much was dropped", async () => {
    (config as { GOOGLE_ADS_MAX_RESULT_CHARS?: number }).GOOGLE_ADS_MAX_RESULT_CHARS = 1000;
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, padding: "x".repeat(50) }));
    const res = await asTool(async () => rows, undefined);
    const parsed = JSON.parse(res.content[0].text);
    expect(res.isError).toBeUndefined();
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalRows).toBe(500);
    expect(parsed.returnedRows).toBeGreaterThan(0);
    expect(parsed.returnedRows).toBeLessThan(500);
    expect(parsed.rows).toHaveLength(parsed.returnedRows);
    // The message has to tell the caller what to do, not merely that it happened.
    expect(parsed.advice).toMatch(/LIMIT/);
    expect(parsed.advice).toMatch(/WHERE/);
    expect(res.content[0].text.length).toBeLessThanOrEqual(1000);
  });

  it("bounds an oversized non-array payload", async () => {
    (config as { GOOGLE_ADS_MAX_RESULT_CHARS?: number }).GOOGLE_ADS_MAX_RESULT_CHARS = 800;
    const res = await asTool(async () => ({ blob: "y".repeat(5000) }), undefined);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalRows).toBeUndefined();
    expect(typeof parsed.partial).toBe("string");
    expect(parsed.advice).toMatch(/GOOGLE_ADS_MAX_RESULT_CHARS/);
  });

  it("leaves a result that fits untouched", async () => {
    (config as { GOOGLE_ADS_MAX_RESULT_CHARS?: number }).GOOGLE_ADS_MAX_RESULT_CHARS = 1000;
    expect(renderToolResult([{ a: 1 }])).toBe('[{"a":1}]');
  });

  it("renders an undefined result as null (JSON has no undefined)", () => {
    expect(renderToolResult(undefined)).toBe("null");
  });
});

describe("maxResultChars", () => {
  it("falls back to the built-in ceiling", () => {
    expect(maxResultChars()).toBe(DEFAULT_MAX_RESULT_CHARS);
  });

  it("honors GOOGLE_ADS_MAX_RESULT_CHARS", () => {
    (config as { GOOGLE_ADS_MAX_RESULT_CHARS?: number }).GOOGLE_ADS_MAX_RESULT_CHARS = 42;
    expect(maxResultChars()).toBe(42);
  });
});
