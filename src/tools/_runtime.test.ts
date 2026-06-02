import { describe, it, expect } from "vitest";
import { asTool } from "./_runtime.js";

describe("asTool", () => {
  it("wraps a successful result as a single JSON text block", async () => {
    const res = await asTool(async (a: { x: number }) => ({ ok: a.x }), { x: 5 });
    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(JSON.parse(res.content[0].text)).toEqual({ ok: 5 });
  });

  it("pretty-prints the JSON with 2-space indentation", async () => {
    const res = await asTool(async () => ({ a: 1 }), undefined);
    expect(res.content[0].text).toBe(JSON.stringify({ a: 1 }, null, 2));
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
});
