import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../observability/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { listLocalServicesLeads } from "./localServices.js";
import { getCustomer } from "../services/google-ads/client.js";
import { fakeCustomer } from "../test/harness.js";

let customer: ReturnType<typeof fakeCustomer>;

beforeEach(() => {
  vi.clearAllMocks();
  customer = fakeCustomer([{ lead: 1 }]);
  (getCustomer as any).mockResolvedValue(customer);
});

describe("listLocalServicesLeads", () => {
  it("queries local_services_lead with limit and ordering", async () => {
    const res = await listLocalServicesLeads({ customerId: "1", limit: 25 });
    const q = customer.query.mock.calls[0][0];
    expect(q).toContain("FROM local_services_lead");
    expect(q).toContain("ORDER BY local_services_lead.creation_date_time DESC");
    expect(q).toContain("LIMIT 25");
    expect(res).toEqual([{ lead: 1 }]);
  });

  it("passes userId to getCustomer", async () => {
    await listLocalServicesLeads({ customerId: "1", limit: 50, userId: "u" });
    expect(getCustomer).toHaveBeenCalledWith("1", "u");
  });
});
