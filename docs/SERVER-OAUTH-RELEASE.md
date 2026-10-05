# Server OAuth refresh release

This release lets remote MCP clients renew expired access tokens through OAuth
instead of asking the user to sign in again. Google Ads connection credentials
are separate from the client's MCP OAuth credentials.

## Changes and compatibility

- MCP requests accept Better Auth MCP OAuth tokens as well as existing dashboard
  cookies/login bearer tokens.
- Discovery and `WWW-Authenticate` advertise the resource and authorization server.
- Authorization uses PKCE; the default scope includes `offline_access`.
- Access tokens expire after one hour. Refresh tokens rotate when used and expire
  thirty days after issuance. Clients must save the replacement refresh token.
- Authorization remains attached to the organization selected when connecting.
  Bans, removed membership and administrative revocation are checked on requests
  and refresh. Revoking sessions also invalidates MCP OAuth tokens.
- **One reconnection is required for pre-upgrade MCP OAuth authorizations.** Their
  rows lack an organization binding. Dashboard login sessions remain compatible.
- Existing encrypted Google Ads connections and account grants are retained.

## Before deployment

Confirm the target host, installation directory, branch/commit and staging URL.
Check the public `BETTER_AUTH_URL`, dashboard `WEB_APP_ORIGIN` and HTTPS routing.
Keep existing signing/encryption keys and Google OAuth client credentials.

The repository's smoke suites create fixture users and organizations, issue
tokens and revoke those fixture sessions. Run them on the isolated test/staging
database with development email delivery disabled, not on production data.

Validation already performed locally: build; 1,053 unit tests with the existing
100% coverage gate; database/auth/identity/HTTP/onboarding smoke suites; real
OAuth/PKCE browser-login resumption, access expiry, refresh rotation, refresh
expiry/replay denial, organization isolation, bans and revocation. Google API
calls use test fixtures; this does not assert real ChatGPT/Claude client behavior.

## Deployment using the existing Docker Compose stack

Run from the confirmed server checkout. Substitute the reviewed release commit
for `RELEASE_COMMIT`; do not pull an unrelated tip or overwrite local changes.

```sh
git status --short
git rev-parse HEAD                 # record the previous application commit
git fetch origin
git checkout RELEASE_COMMIT

mkdir -p backups
chmod 700 backups
OAUTH_RELEASE_BACKUP="backups/before-oauth-refresh-$(date -u +%Y%m%d-%H%M%S).sql"
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U postgres -d google_ads_mcp > "$OAUTH_RELEASE_BACKUP"
chmod 600 "$OAUTH_RELEASE_BACKUP"

# Build first. The running service remains available until recreation.
docker compose -f docker-compose.prod.yml --env-file .env.prod build mcp

# Startup applies 20261006000000_mcp_oauth_binding before accepting HTTP traffic.
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-deps mcp
docker compose -f docker-compose.prod.yml --env-file .env.prod ps mcp
docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=80 mcp
```

Store the backup outside the source tree if the hosting setup requires it, and
do not commit or share it. The migration adds `User.mcpAuthVersion` and token
`organizationId`/`authVersion` columns; it does not delete business data.

## Post-deployment checks

Using the actual public HTTPS origin, check `/health/ready`,
`/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server/api/auth`. An unauthenticated `/mcp`
request must return 401 and an OAuth `WWW-Authenticate` challenge.

Reconnect one dedicated test member's ChatGPT/Claude connector once. Select its
organization before authorization. Confirm that the resulting client scope
includes `offline_access` and a refresh credential is retained by the client.
After the usual one-hour access lifetime, run a read-only call and verify that
the client refreshes without a browser login. Do not expire arbitrary production
tokens by editing their database rows. Repeat with the second client before
declaring the production authentication issue resolved.

## Application rollback

Check out the previously recorded commit, rebuild `mcp` and recreate only that
service using the same commands. Leave the additive database columns in place;
the previous application ignores them. A rollback restores previous OAuth
behavior, so reconnection can still be necessary. Restore the database backup
only for an actual database incident, considering any writes since the backup.

## Remaining external checks

Publishing the branch/PR is separate from deploying the running host. Production
verification requires host access and the real clients. Google OAuth apps in
Testing can still expire their **Google Ads** refresh tokens after seven days;
the MCP refresh fix does not change that Google Cloud publishing setting.
