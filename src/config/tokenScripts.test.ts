import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { mock, fs, server, loadEnvironment, OAuth2Client } = vi.hoisted(() => {
  const mock = { getToken: vi.fn(), getAccessToken: vi.fn(), setCredentials: vi.fn(), generateAuthUrl: vi.fn(() => "http://google.example/consent") };
  const fs = { existsSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn(), chmodSync: vi.fn() };
  const server = { handler: undefined as any, close: vi.fn(), listen: vi.fn((_port: number, _host: string, fn: () => void) => fn()) };
  return { mock, fs, server, loadEnvironment: vi.fn(() => "/tmp/mcp-fixture/custom.env"), OAuth2Client: vi.fn(function () { return mock; }) };
});
vi.mock("google-auth-library", () => ({ OAuth2Client }));
vi.mock("./envFile.js", () => ({ loadEnvironment }));
vi.mock("node:fs", () => fs);
vi.mock("node:http", () => ({ createServer: (handler: unknown) => { server.handler = handler; return server; } }));
let log: ReturnType<typeof vi.spyOn>, errorLog: ReturnType<typeof vi.spyOn>, exit: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("GOOGLE_ADS_CLIENT_ID", "fixture-client");
  vi.stubEnv("GOOGLE_ADS_CLIENT_SECRET", "fixture-secret");
  vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN", "fixture-old-refresh");
  vi.stubEnv("OAUTH_PORT", undefined as any);
  mock.getToken.mockResolvedValue({ tokens: { refresh_token: "fixture-new-refresh" } });
  mock.getAccessToken.mockResolvedValue({ token: "fixture-access" });
  fs.existsSync.mockReturnValue(false);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  process.exitCode = 0;
});
afterEach(() => { process.exitCode = 0; vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const generate = () => import("../../scripts/generate-refresh-token.js");
const check = () => import("../../scripts/test-token-validity.js");
async function callback(params: Record<string, string>) {
  const state = mock.generateAuthUrl.mock.lastCall![0].state;
  const response = { writeHead: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis() };
  await server.handler({ url: "/oauth2callback?" + new URLSearchParams({ state, ...params }) }, response);
  return response;
}
describe("local token generation", () => {
  it("requests offline consent, rejects stray callbacks, and saves to the server's selected file", async () => {
    await generate();
    expect(mock.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({ access_type: "offline", prompt: "consent", scope: "https://www.googleapis.com/auth/adwords", state: expect.any(String) }));
    const badState = await callback({ state: "bad", code: "code" });
    expect(badState.writeHead).toHaveBeenCalledWith(400);
    expect(mock.getToken).not.toHaveBeenCalled();
    const response = await callback({ code: "code" });
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(fs.writeFileSync).toHaveBeenCalledWith("/tmp/mcp-fixture/custom.env", "\nGOOGLE_ADS_REFRESH_TOKEN=fixture-new-refresh\n", { mode: 0o600 });
    expect(fs.chmodSync).toHaveBeenCalledWith("/tmp/mcp-fixture/custom.env", 0o600);
    expect(log.mock.calls.flat().join(" ")).toContain("overrides");
    expect(log.mock.calls.flat().join(" ")).not.toContain("fixture-new-refresh");
  });
  it("replaces a previous token without modifying other variables", async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("KEEP=this\n# GOOGLE_ADS_REFRESH_TOKEN=old\n");
    await generate(); await callback({ code: "code" });
    expect(fs.writeFileSync.mock.lastCall![1]).toBe("KEEP=this\nGOOGLE_ADS_REFRESH_TOKEN=fixture-new-refresh\n");
  });
  it("handles missing code/token and exchange errors without saving or logging credentials", async () => {
    await generate();
    expect((await callback({})).writeHead).toHaveBeenCalledWith(400);
    mock.getToken.mockResolvedValue({ tokens: {} });
    expect((await callback({ code: "code" })).writeHead).toHaveBeenCalledWith(400);
    mock.getToken.mockRejectedValue(new Error("sensitive-request-body"));
    expect((await callback({ code: "code" })).writeHead).toHaveBeenCalledWith(500);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("sensitive-request-body");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
describe("local refresh diagnosis", () => {
  it("obtains access through the refresh token without exposing tokens", async () => {
    await check();
    expect(mock.setCredentials).toHaveBeenCalledWith({ refresh_token: "fixture-old-refresh" });
    expect(mock.getAccessToken).toHaveBeenCalledOnce();
    expect(log.mock.calls.flat().join(" ")).toContain("without browser login");
    expect(log.mock.calls.flat().join(" ")).not.toContain("fixture-access");
    expect(process.exitCode).toBe(0);
  });
  it("fails before calling Google if credentials are missing", async () => {
    vi.stubEnv("GOOGLE_ADS_REFRESH_TOKEN", undefined as any);
    await check();
    expect(mock.getAccessToken).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it.each(["invalid_grant", "invalid_client", "unauthorized_client", "server_error", undefined])("reports %s safely with a failing exit status", async code => {
    mock.getAccessToken.mockRejectedValue({ response: { data: { error: code, refresh_token: "sensitive-refresh" } }, message: "sensitive-request-body" });
    await check();
    const output = errorLog.mock.calls.flat().join(" ");
    expect(output).not.toMatch(/sensitive-refresh|sensitive-request-body/);
    expect(process.exitCode).toBe(1);
    if (code === "invalid_grant") expect(output).toContain("7 days");
  });
});
