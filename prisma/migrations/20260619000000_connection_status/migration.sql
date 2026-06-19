-- Connection health: mark a connection as needing re-authentication when Google
-- rejects its refresh token (invalid_grant), so admins can re-link it.
ALTER TABLE "GoogleAdsConnection" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
