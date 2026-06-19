import { describe, it, expect, vi } from "vitest";
import {
  checkDatabase,
  shutdown,
  installSignalHandlers,
} from "./lifecycle.js";

describe("checkDatabase", () => {
  it("returns true when the ping succeeds", async () => {
    const prisma = { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) };
    expect(await checkDatabase(prisma)).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("returns false and warns when the ping fails", async () => {
    const prisma = { $queryRaw: vi.fn(async () => { throw new Error("no db"); }) };
    const logger = { warn: vi.fn() };
    expect(await checkDatabase(prisma, logger)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("tolerates a failure with no logger", async () => {
    const prisma = { $queryRaw: vi.fn(async () => { throw new Error("no db"); }) };
    expect(await checkDatabase(prisma)).toBe(false);
  });
});

describe("shutdown", () => {
  function makeLogger() {
    return { info: vi.fn(), error: vi.fn() };
  }

  it("drains server -> sessions -> prisma in order on the happy path", async () => {
    const order: string[] = [];
    const server = { close: vi.fn((cb: (e?: Error) => void) => { order.push("server"); cb(); }) };
    const sessions = { closeAll: vi.fn(async () => { order.push("sessions"); }) };
    const prisma = { $disconnect: vi.fn(async () => { order.push("prisma"); }) };
    const logger = makeLogger();
    await shutdown({ server, sessions, prisma, logger });
    expect(order).toEqual(["server", "sessions", "prisma"]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs but continues when each step errors", async () => {
    const server = { close: vi.fn((cb: (e?: Error) => void) => cb(new Error("close fail"))) };
    const sessions = { closeAll: vi.fn(async () => { throw new Error("drain fail"); }) };
    const prisma = { $disconnect: vi.fn(async () => { throw new Error("dc fail"); }) };
    const logger = makeLogger();
    await shutdown({ server, sessions, prisma, logger });
    expect(logger.error).toHaveBeenCalledTimes(3);
    expect(prisma.$disconnect).toHaveBeenCalled();
  });
});

describe("installSignalHandlers", () => {
  function fakeProcess() {
    const handlers = new Map<string, () => void>();
    return {
      once: vi.fn((sig: string, h: () => void) => handlers.set(sig, h)),
      fire: (sig: string) => handlers.get(sig)?.(),
    };
  }

  it("registers the default signals and runs the drain then exits 0", async () => {
    const proc = fakeProcess();
    const run = vi.fn(async () => {});
    const exit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const setTimer = vi.fn(() => ({ unref: vi.fn() }));
    installSignalHandlers({ process: proc, run, exit, logger, setTimer });
    expect(proc.once).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(proc.once).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    proc.fire("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a second signal (drains once)", async () => {
    const proc = fakeProcess();
    const run = vi.fn(async () => {});
    const exit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    installSignalHandlers({
      process: proc,
      run,
      exit,
      logger,
      signals: ["SIGTERM"],
      setTimer: () => ({}), // no unref -> exercises optional chaining
    });
    proc.fire("SIGTERM");
    proc.fire("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("exits 1 and logs when the drain rejects", async () => {
    const proc = fakeProcess();
    const run = vi.fn(async () => { throw new Error("drain boom"); });
    const exit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    installSignalHandlers({ process: proc, run, exit, logger, setTimer: () => ({ unref: vi.fn() }) });
    proc.fire("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logger.error).toHaveBeenCalled();
  });

  it("forces exit 1 when the watchdog fires before the drain finishes", () => {
    const proc = fakeProcess();
    const run = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const exit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const setTimer = (cb: () => void) => { cb(); return { unref: vi.fn() }; }; // fire immediately
    installSignalHandlers({ process: proc, run, exit, logger, setTimer });
    proc.fire("SIGTERM");
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith({ timeoutMs: 25_000 }, expect.any(String));
  });

  it("uses the real default timer when none is injected", async () => {
    const proc = fakeProcess();
    const run = vi.fn(async () => {});
    const exit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    installSignalHandlers({ process: proc, run, exit, logger });
    proc.fire("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  });
});
