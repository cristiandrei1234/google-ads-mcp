"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession, organization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AcceptInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    const res = await organization.acceptInvitation({ invitationId: id });
    setBusy(false);
    if (res.error) {
      setError(res.error.message || "Could not accept the invitation.");
      return;
    }
    await organization.setActive({ organizationId: (res.data as { invitation: { organizationId: string } }).invitation.organizationId });
    router.replace("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Join the agency</CardTitle>
          <CardDescription>You were invited to a Google Ads MCP workspace.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPending ? (
            <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
          ) : session ? (
            <>
              <p className="text-sm text-[var(--muted-foreground)]">
                Signed in as {session.user.email}. Accept to join the team.
              </p>
              {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
              <Button onClick={accept} disabled={busy} className="w-full">
                {busy ? "Joining…" : "Accept invitation"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--muted-foreground)]">
                Sign in (or create an account with the invited email) to accept.
              </p>
              <Link href={`/sign-in?redirect=/accept-invitation/${id}`}>
                <Button className="w-full">Sign in to continue</Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
