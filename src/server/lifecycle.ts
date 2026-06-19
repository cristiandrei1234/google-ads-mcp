/**
 * Server lifecycle helpers: a real readiness check (does the DB actually
 * answer?) and a graceful shutdown that drains sessions and closes the DB pool
 * instead of letting the process die mid-request.
 */

export interface ReadinessLogger {
  warn: (obj: unknown, msg?: string) => void;
}

/** Minimal Prisma surface the readiness probe needs. */
export interface PingablePrisma {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

/**
 * Liveness is "the process is up"; readiness is "the process can serve traffic",
 * which for us means Postgres answers. Returns true iff a trivial query succeeds.
 */
export async function checkDatabase(prisma: PingablePrisma, logger?: ReadinessLogger): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger?.warn({ err }, "readiness: database ping failed");
    return false;
  }
}

export interface HttpServerLike {
  close(callback: (err?: Error) => void): void;
}

export interface DrainableSessions {
  closeAll(): Promise<void>;
}

export interface DisconnectablePrisma {
  $disconnect(): Promise<void>;
}

export interface ShutdownLogger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export interface ShutdownDeps {
  server: HttpServerLike;
  sessions: DrainableSessions;
  prisma: DisconnectablePrisma;
  logger: ShutdownLogger;
}

/** Promisified server.close — resolves even if close reports an error (logged). */
function closeServer(server: HttpServerLike, logger: ShutdownLogger): Promise<void> {
  return new Promise((resolve) => {
    server.close((err) => {
      if (err) {
        logger.error({ err }, "shutdown: http server close error");
      }
      resolve();
    });
  });
}

/**
 * Drain in order: stop accepting connections, close MCP sessions, disconnect the
 * DB pool. Each step is best-effort and isolated so one failure cannot strand
 * the others. Safe to await exactly once per process.
 */
export async function shutdown(deps: ShutdownDeps): Promise<void> {
  const { server, sessions, prisma, logger } = deps;
  logger.info({}, "shutdown: draining");
  await closeServer(server, logger);
  try {
    await sessions.closeAll();
  } catch (err) {
    logger.error({ err }, "shutdown: session drain error");
  }
  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, "shutdown: prisma disconnect error");
  }
  logger.info({}, "shutdown: complete");
}

export interface SignalSource {
  once(signal: string, handler: () => void): void;
}

export interface SignalHandlerDeps {
  process: SignalSource;
  signals?: string[];
  run: () => Promise<void>;
  exit: (code: number) => void;
  logger: ShutdownLogger;
  /** Hard-exit deadline so a hung drain can't keep the process alive forever. */
  timeoutMs?: number;
  setTimer?: (cb: () => void, ms: number) => { unref?: () => void };
}

/**
 * Install SIGTERM/SIGINT handlers that run `run()` once, then exit. A watchdog
 * timer forces exit if the drain hangs. Guarded so a second signal is ignored.
 */
export function installSignalHandlers(deps: SignalHandlerDeps): void {
  const signals = deps.signals ?? ["SIGTERM", "SIGINT"];
  const timeoutMs = deps.timeoutMs ?? 25_000;
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  let started = false;

  const handle = () => {
    if (started) return;
    started = true;
    const watchdog = setTimer(() => {
      deps.logger.error({ timeoutMs }, "shutdown: drain timed out, forcing exit");
      deps.exit(1);
    }, timeoutMs);
    watchdog.unref?.();
    deps
      .run()
      .then(() => deps.exit(0))
      .catch((err) => {
        deps.logger.error({ err }, "shutdown: unexpected error");
        deps.exit(1);
      });
  };

  for (const signal of signals) {
    deps.process.once(signal, handle);
  }
}
