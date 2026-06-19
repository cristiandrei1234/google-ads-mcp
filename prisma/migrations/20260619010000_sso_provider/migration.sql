-- Enterprise SSO (@better-auth/sso): registered SAML 2.0 / OIDC identity
-- providers, optionally scoped to an organization.
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "domain" TEXT NOT NULL,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SsoProvider_providerId_key" ON "SsoProvider"("providerId");
CREATE INDEX "SsoProvider_organizationId_idx" ON "SsoProvider"("organizationId");

ALTER TABLE "SsoProvider" ADD CONSTRAINT "SsoProvider_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
