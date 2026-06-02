import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks (hoisted) -------------------------------------------------------

const sendMock = vi.fn();
const resendCtor = vi.fn();

// Resend is a class; its instances expose `emails.send`. Use a real class so
// `new Resend(...)` works, and record construction via resendCtor.
class FakeResend {
  apiKey: string;
  emails = { send: sendMock };
  constructor(key: string) {
    this.apiKey = key;
    resendCtor(key);
  }
}

vi.mock("resend", () => ({ Resend: FakeResend }));

// react-email render → deterministic HTML string.
vi.mock("@react-email/render", () => ({
  render: vi.fn(async () => "<html>rendered</html>"),
}));

const loggerMock = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() };
vi.mock("../observability/logger.js", () => ({ default: loggerMock }));

// The ActionEmail template is a React component; stub it to a marker so render
// is what we assert on (template internals are out of this bucket's scope).
vi.mock("../emails/ActionEmail.js", () => ({
  ActionEmail: vi.fn((props: unknown) => ({ __component: "ActionEmail", props })),
}));

// config is read at module-eval time for `resend`, so each scenario re-imports.
vi.mock("../config/env.js", () => ({ default: {} }));

import config from "../config/env.js";
import { render } from "@react-email/render";
import { ActionEmail } from "../emails/ActionEmail.js";

const cfg = config as unknown as Record<string, unknown>;

async function loadEmail() {
  vi.resetModules();
  return import("./email.js");
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(cfg)) delete cfg[k];
  sendMock.mockResolvedValue({ data: { id: "msg_1" }, error: null });
});

describe("email service — configured (RESEND_API_KEY + EMAIL_FROM set)", () => {
  beforeEach(() => {
    cfg.RESEND_API_KEY = "re_test";
    cfg.EMAIL_FROM = "from@example.com";
  });

  it("constructs Resend with the api key", async () => {
    await loadEmail();
    expect(resendCtor).toHaveBeenCalledWith("re_test");
  });

  it("isEmailConfigured returns true", async () => {
    const mod = await loadEmail();
    expect(mod.isEmailConfigured()).toBe(true);
  });

  it("sendEmail delivers with the configured from address (no text)", async () => {
    const mod = await loadEmail();
    const result = await mod.sendEmail({ to: "u@x.com", subject: "Hi", html: "<b>h</b>" });
    expect(result).toEqual({ delivered: true });
    expect(sendMock).toHaveBeenCalledWith({
      from: "from@example.com",
      to: "u@x.com",
      subject: "Hi",
      html: "<b>h</b>",
    });
    // text omitted when not supplied
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("text");
  });

  it("sendEmail includes text when provided", async () => {
    const mod = await loadEmail();
    await mod.sendEmail({ to: "u@x.com", subject: "Hi", html: "<b>h</b>", text: "plain" });
    expect(sendMock.mock.calls[0][0]).toMatchObject({ text: "plain" });
  });

  it("sendEmail throws and logs when Resend returns an error", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "rate limited" } });
    const mod = await loadEmail();
    await expect(mod.sendEmail({ to: "u@x.com", subject: "S", html: "<b>h</b>" })).rejects.toThrow(
      /Email send failed: rate limited/
    );
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });

  it("renderActionEmail renders the template to HTML", async () => {
    const mod = await loadEmail();
    const html = await mod.renderActionEmail({
      heading: "H",
      body: "B",
      url: "https://x.com",
      cta: "Click",
    });
    expect(html).toBe("<html>rendered</html>");
    expect(ActionEmail).toHaveBeenCalledWith({
      heading: "H",
      body: "B",
      url: "https://x.com",
      cta: "Click",
    });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("sendActionEmail renders then sends with a text fallback", async () => {
    const mod = await loadEmail();
    const result = await mod.sendActionEmail("u@x.com", "Subject", {
      heading: "H",
      body: "Please confirm",
      url: "https://x.com/verify",
      cta: "Verify",
    });
    expect(result).toEqual({ delivered: true });
    expect(sendMock).toHaveBeenCalledWith({
      from: "from@example.com",
      to: "u@x.com",
      subject: "Subject",
      html: "<html>rendered</html>",
      text: "Please confirm\n\nVerify: https://x.com/verify",
    });
  });
});

describe("email service — key set but EMAIL_FROM missing", () => {
  beforeEach(() => {
    cfg.RESEND_API_KEY = "re_test";
    // EMAIL_FROM intentionally unset
  });

  it("isEmailConfigured returns false (resend exists but no from)", async () => {
    const mod = await loadEmail();
    expect(mod.isEmailConfigured()).toBe(false);
  });

  it("sendEmail skips delivery and warns (EMAIL_FROM missing branch)", async () => {
    const mod = await loadEmail();
    const result = await mod.sendEmail({ to: "u@x.com", subject: "S", html: "<b>h</b>" });
    expect(result).toEqual({ delivered: false });
    expect(sendMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });
});

describe("email service — unconfigured (no RESEND_API_KEY)", () => {
  it("does not construct Resend", async () => {
    await loadEmail();
    expect(resendCtor).not.toHaveBeenCalled();
  });

  it("isEmailConfigured returns false", async () => {
    const mod = await loadEmail();
    expect(mod.isEmailConfigured()).toBe(false);
  });

  it("sendEmail skips delivery and warns (no resend branch)", async () => {
    const mod = await loadEmail();
    const result = await mod.sendEmail({ to: "u@x.com", subject: "S", html: "<b>h</b>" });
    expect(result).toEqual({ delivered: false });
    expect(sendMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  it("renderActionEmail still works without a configured sender", async () => {
    const mod = await loadEmail();
    const html = await mod.renderActionEmail({ heading: "H", body: "B", url: "u", cta: "C" });
    expect(html).toBe("<html>rendered</html>");
  });

  it("sendActionEmail renders but reports not delivered", async () => {
    const mod = await loadEmail();
    const result = await mod.sendActionEmail("u@x.com", "S", {
      heading: "H",
      body: "B",
      url: "u",
      cta: "C",
    });
    expect(result).toEqual({ delivered: false });
  });
});
