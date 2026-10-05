import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("the installed Google Ads SDK renews local access before one-hour expiry without interactive login", async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  // Use the SDK's own Google Auth version, not the separate top-level dependency.
  const sdkRequire = createRequire(require.resolve("google-ads-api"));
  const { OAuth2Client } = sdkRequire("google-auth-library");
  const refresh = vi.spyOn(OAuth2Client.prototype, "refreshTokenNoCache").mockImplementation(async () => ({
    tokens: { access_token: `fixture-access-${refresh.mock.calls.length}`, expiry_date: Date.now() + 3600000 },
    res: { data: {} },
  }));
  const { Service } = require(path.join(path.dirname(require.resolve("google-ads-api")), "service.js"));
  const service = new Service(
    { client_id: "fixture-client", client_secret: "fixture-secret", developer_token: "fixture-developer" },
    { customer_id: "1234567890", refresh_token: "fixture-local-refresh" },
  );
  expect(await service.getAccessToken()).toBe("fixture-access-1");
  expect(refresh).toHaveBeenCalledWith("fixture-local-refresh");
  vi.advanceTimersByTime(45 * 60000);
  expect(await service.getAccessToken()).toBe("fixture-access-1");
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(6 * 60000);
  expect(await service.getAccessToken()).toBe("fixture-access-2");
  expect(refresh).toHaveBeenCalledTimes(2);
});
