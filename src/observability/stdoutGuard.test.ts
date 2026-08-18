import { describe, it, expect, vi } from "vitest";
import { redirectConsoleToStderr } from "./stdoutGuard.js";

describe("redirectConsoleToStderr", () => {
  it("sends console output to stderr, never to the JSON-RPC stream on stdout", () => {
    const originalConsole = globalThis.console;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      redirectConsoleToStderr();
      // console.error already avoided stdout; console.log is the leak that
      // corrupts the stream, so assert on the whole surface.
      console.log("from a third-party library");
      console.error("an error");
      console.warn("a warning");
      console.info("an info line");
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(stderrWrite).toHaveBeenCalledTimes(4);
      expect(stderrWrite.mock.calls[0]?.[0]).toContain("from a third-party library");
    } finally {
      globalThis.console = originalConsole;
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
    }
  });
});
