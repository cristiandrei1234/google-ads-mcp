/**
 * In-memory registry of MCP Streamable-HTTP sessions, each bound to its owning
 * user. Adds two things the bare Map lacked:
 *
 *   - inactivity expiry (sweepExpired): a transport that crashes without firing
 *     `onclose` no longer leaks a session forever;
 *   - bulk teardown (closeAll): graceful shutdown can drain every transport.
 */

/** The subset of a Streamable-HTTP transport this store needs. */
export interface ClosableTransport {
  sessionId?: string;
  close(): void | Promise<void>;
}

export interface ManagedSession<T extends ClosableTransport = ClosableTransport> {
  transport: T;
  ownerUserId: string;
  /** Epoch ms of the last request seen on this session. */
  lastSeenAt: number;
}

export class SessionStore<T extends ClosableTransport = ClosableTransport> {
  private readonly sessions = new Map<string, ManagedSession<T>>();

  /** @param now Injectable clock (tests). Defaults to `Date.now`. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  get size(): number {
    return this.sessions.size;
  }

  /** Register a session, stamping its initial activity time. */
  add(sessionId: string, transport: T, ownerUserId: string): void {
    this.sessions.set(sessionId, { transport, ownerUserId, lastSeenAt: this.now() });
  }

  /**
   * Return the session iff it exists AND is owned by `userId`. A wrong owner is
   * indistinguishable from "not found" by design (no cross-tenant leakage).
   */
  getOwned(sessionId: string | undefined, userId: string): ManagedSession<T> | null {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session || session.ownerUserId !== userId) return null;
    return session;
  }

  /** Refresh a session's activity timestamp (called on each handled request). */
  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastSeenAt = this.now();
    }
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Close and drop every session idle for longer than `ttlMs`. Returns the
   * number evicted. A transport that throws on close is still dropped.
   */
  async sweepExpired(ttlMs: number): Promise<number> {
    const cutoff = this.now() - ttlMs;
    let evicted = 0;
    for (const [id, session] of this.sessions) {
      if (session.lastSeenAt <= cutoff) {
        this.sessions.delete(id);
        evicted += 1;
        await this.safeClose(session.transport);
      }
    }
    return evicted;
  }

  /**
   * Close and drop every live session owned by `userId` (admin revocation /
   * forced logout). Returns the number closed.
   */
  async closeForUser(userId: string): Promise<number> {
    let closed = 0;
    for (const [id, session] of this.sessions) {
      if (session.ownerUserId === userId) {
        this.sessions.delete(id);
        closed += 1;
        await this.safeClose(session.transport);
      }
    }
    return closed;
  }

  /** Close and drop all sessions (graceful shutdown). */
  async closeAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of all) {
      await this.safeClose(session.transport);
    }
  }

  private async safeClose(transport: T): Promise<void> {
    try {
      await transport.close();
    } catch {
      // Best-effort: a transport that fails to close is already being discarded.
    }
  }
}
