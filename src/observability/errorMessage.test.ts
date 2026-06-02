import { describe, it, expect } from "vitest";
import { toErrorMessage } from "./errorMessage.js";

describe("toErrorMessage", () => {
  it("returns a non-empty string error as-is", () => {
    expect(toErrorMessage("boom")).toBe("boom");
  });

  it("ignores a blank string and falls through to JSON.stringify", () => {
    // "   " is a string but trim().length === 0, so it is not returned directly.
    expect(toErrorMessage("   ")).toBe('"   "');
  });

  it("returns Error.message when present and non-empty", () => {
    expect(toErrorMessage(new Error("kaboom"))).toBe("kaboom");
  });

  it("falls through when Error.message is blank", () => {
    const err = new Error("   ");
    // message is blank → not used; JSON.stringify(Error) yields "{}".
    expect(toErrorMessage(err)).toBe("{}");
  });

  it("returns object.message for a plain object with a string message", () => {
    expect(toErrorMessage({ message: "object message" })).toBe("object message");
  });

  it("ignores a blank object.message and tries errors[]", () => {
    expect(
      toErrorMessage({ message: "  ", errors: [{ message: "nested" }] })
    ).toBe("nested");
  });

  it("ignores non-string object.message", () => {
    expect(toErrorMessage({ message: 42 })).toBe('{"message":42}');
  });

  it("reads the first object item's message from errors[]", () => {
    expect(toErrorMessage({ errors: [{ message: "first error" }] })).toBe("first error");
  });

  it("skips non-object entries in errors[] to find the first object with a message", () => {
    expect(
      toErrorMessage({ errors: [null, "str", 5, { message: "the one" }] })
    ).toBe("the one");
  });

  it("falls through when the first errors[] object has a blank message", () => {
    const input = { errors: [{ message: "   " }] };
    expect(toErrorMessage(input)).toBe(JSON.stringify(input));
  });

  it("falls through when the first errors[] object has a non-string message", () => {
    const input = { errors: [{ message: 7 }] };
    expect(toErrorMessage(input)).toBe(JSON.stringify(input));
  });

  it("falls through when errors[] has no object entries at all", () => {
    const input = { errors: ["a", "b"] };
    expect(toErrorMessage(input)).toBe(JSON.stringify(input));
  });

  it("falls through when errors is not an array", () => {
    const input = { errors: "nope" };
    expect(toErrorMessage(input)).toBe(JSON.stringify(input));
  });

  it("JSON.stringifies a plain object without message or errors", () => {
    expect(toErrorMessage({ code: 500 })).toBe('{"code":500}');
  });

  it("JSON.stringifies primitive non-string values (number)", () => {
    expect(toErrorMessage(123)).toBe("123");
  });

  it("returns the literal string for null (typeof object guard requires truthy)", () => {
    // null is an object but falsy, so the object branch is skipped → JSON.stringify(null).
    expect(toErrorMessage(null)).toBe("null");
  });

  it("returns 'Unknown error' when JSON.stringify throws (circular reference)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toErrorMessage(circular)).toBe("Unknown error");
  });

  it("handles undefined input", () => {
    // JSON.stringify(undefined) === undefined → function returns undefined.
    expect(toErrorMessage(undefined)).toBeUndefined();
  });
});
