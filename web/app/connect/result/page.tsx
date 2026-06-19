"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function Result() {
  const params = useSearchParams();
  const status = params.get("status");
  const mcc = params.get("mcc");
  const message = params.get("message");
  const ok = status === "connected";

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{ok ? "Account connected" : "Connection failed"}</CardTitle>
        <CardDescription>
          {ok
            ? `Linked Google Ads MCC ${mcc}. You can now grant client accounts to your team.`
            : message || "Something went wrong during the connection."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/dashboard">
          <Button className="w-full">Back to dashboard</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function ConnectResultPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={null}>
        <Result />
      </Suspense>
    </main>
  );
}
