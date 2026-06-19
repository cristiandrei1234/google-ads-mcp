"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut, organization } from "@/lib/auth-client";
import {
  listConnections,
  listMembers,
  listGrants,
  listAccessibleAccounts,
  addGrant,
  removeGrant,
  startConnect,
  type Connection,
  type Member,
  type Grant,
  type AccessLevel,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const selectClass =
  "h-9 rounded-md border border-[var(--input)] bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!isPending && !session) router.replace("/sign-in");
  }, [isPending, session, router]);

  if (isPending || !session) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-[var(--muted-foreground)]">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Google Ads MCP</h1>
          <p className="text-sm text-[var(--muted-foreground)]">{session.user.email}</p>
        </div>
        <Button variant="outline" onClick={() => signOut().then(() => router.replace("/sign-in"))}>
          Sign out
        </Button>
      </header>
      {session.session.activeOrganizationId ? <AgencyConsole /> : <CreateOrg />}
    </main>
  );
}

function CreateOrg() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
    const created = await organization.create({ name, slug });
    if (created.error || !created.data) {
      setLoading(false);
      setError(created.error?.message || "Could not create the organization.");
      return;
    }
    await organization.setActive({ organizationId: created.data.id });
    window.location.reload();
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Create your agency</CardTitle>
        <CardDescription>An organization groups your team and Google Ads connections.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="org">Agency name</Label>
            <Input id="org" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
          <Button type="submit" disabled={loading || !name}>
            {loading ? "Creating…" : "Create agency"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AgencyConsole() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, m, g] = await Promise.all([listConnections(), listMembers(), listGrants()]);
      setConnections(c);
      setMembers(m);
      setGrants(g);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Google Ads connections</CardTitle>
            <CardDescription>Link the agency MCC or your own account.</CardDescription>
          </div>
          <Button onClick={startConnect}>Connect Google Ads</Button>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No connections yet. Click “Connect Google Ads”.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Login MCC</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.label}</TableCell>
                    <TableCell className="font-mono text-xs">{c.mccCustomerId}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "active" ? "muted" : "destructive"}>{c.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <TeamCard members={members} />

      <GrantsCard connections={connections} members={members} grants={grants} onChange={refresh} />
    </div>
  );
}

interface Invitation {
  id: string;
  email: string;
  role: string | null;
  status: string;
}

function TeamCard({ members }: { members: Member[] }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvitations = useCallback(async () => {
    const res = await organization.listInvitations();
    if (!res.error && res.data) {
      setInvitations((res.data as Invitation[]).filter((i) => i.status === "pending"));
    }
  }, []);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await organization.inviteMember({ email, role: role as "member" | "admin" });
    setBusy(false);
    if (res.error) {
      setError(res.error.message || "Could not send the invitation.");
      return;
    }
    setEmail("");
    await loadInvitations();
  }

  async function cancel(invitationId: string) {
    setBusy(true);
    await organization.cancelInvitation({ invitationId });
    setBusy(false);
    await loadInvitations();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>Members of your agency and pending invitations.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Invite by email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@agency.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <Button type="submit" disabled={busy || !email}>
            Send invite
          </Button>
        </form>
        {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.user.email}</TableCell>
                <TableCell>
                  <Badge variant="muted">{m.role}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="muted">active</Badge>
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
            {invitations.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.email}</TableCell>
                <TableCell>
                  <Badge variant="muted">{i.role ?? "member"}</Badge>
                </TableCell>
                <TableCell>
                  <Badge>invited</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => cancel(i.id)} disabled={busy}>
                    Cancel
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function GrantsCard({
  connections,
  members,
  grants,
  onChange,
}: {
  connections: Connection[];
  members: Member[];
  grants: Grant[];
  onChange: () => Promise<void>;
}) {
  const [memberId, setMemberId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [level, setLevel] = useState<AccessLevel>("READ");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccounts([]);
    setCustomerId("");
    if (!connectionId) return;
    listAccessibleAccounts(connectionId)
      .then(setAccounts)
      .catch((e) => setError((e as Error).message));
  }, [connectionId]);

  async function add() {
    if (!memberId || !connectionId || !customerId) return;
    setBusy(true);
    setError(null);
    try {
      await addGrant({ memberId, connectionId, customerId, accessLevel: level });
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(g: Grant) {
    setBusy(true);
    try {
      await removeGrant({ memberId: g.memberId, connectionId: g.connectionId, customerId: g.customerId });
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account access</CardTitle>
        <CardDescription>Grant team members access to specific client accounts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Member</Label>
            <select className={selectClass} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Select…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user.email}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Connection</Label>
            <select className={selectClass} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              <option value="">Select…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Account</Label>
            <select
              className={selectClass}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={!connectionId}
            >
              <option value="">{connectionId ? "Select…" : "Pick a connection"}</option>
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Level</Label>
            <select className={selectClass} value={level} onChange={(e) => setLevel(e.target.value as AccessLevel)}>
              <option value="READ">READ</option>
              <option value="WRITE">WRITE</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <Button onClick={add} disabled={busy || !memberId || !connectionId || !customerId}>
            Grant
          </Button>
        </div>
        {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}

        {grants.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Level</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={`${g.memberId}:${g.connectionId}:${g.customerId}`}>
                  <TableCell>{g.memberEmail}</TableCell>
                  <TableCell className="font-mono text-xs">{g.customerId}</TableCell>
                  <TableCell>{g.connectionLabel}</TableCell>
                  <TableCell>
                    <Badge variant="muted">{g.accessLevel}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => remove(g)} disabled={busy}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
