import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("./runQuery.js", () => ({ runQuery: vi.fn() }));

import { registerCustomerMatchTools } from "./customerMatch.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runQuery } from "./runQuery.js";
import { captureTools, getTool, toolJson, fakeCustomer } from "../test/harness.js";

const tools = captureTools(registerCustomerMatchTools);
const call = (name: string, args: unknown) => getTool(tools, name).handler(args);

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

let customer: ReturnType<typeof fakeCustomer>;

beforeEach(() => {
  vi.clearAllMocks();
  customer = fakeCustomer();
  (getCustomer as any).mockResolvedValue(customer);
  (runQuery as any).mockResolvedValue([{ offline_user_data_job: { id: "9" } }]);
});

describe("customerMatch tools", () => {
  it("registers all 4 tools", () => {
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_customer_match_members",
        "create_customer_match_job_with_members",
        "list_customer_match_jobs",
        "remove_customer_match_members",
      ].sort()
    );
  });

  describe("add_customer_match_members", () => {
    it("hashes email members and forwards flags", async () => {
      const res = await call("add_customer_match_members", {
        customerId: "123",
        resourceName: "customers/123/offlineUserDataJobs/9",
        members: [{ email: "  Foo@Example.COM " }],
        enablePartialFailure: true,
        enableWarnings: true,
      });
      expect(res.isError).toBeUndefined();
      const arg = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0];
      expect(arg.resource_name).toBe("customers/123/offlineUserDataJobs/9");
      expect(arg.enable_partial_failure).toBe(true);
      expect(arg.enable_warnings).toBe(true);
      expect(arg.operations).toEqual([
        { create: { user_identifiers: [{ hashed_email: sha256("foo@example.com") }] } },
      ]);
    });

    it("hashes phone numbers preserving a + prefix", async () => {
      await call("add_customer_match_members", {
        customerId: "123",
        resourceName: "customers/123/offlineUserDataJobs/9",
        members: [{ phoneNumber: " +1 (650) 555-1212 " }],
      });
      const arg = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0];
      expect(arg.operations[0].create.user_identifiers).toEqual([
        { hashed_phone_number: sha256("+16505551212") },
      ]);
    });

    it("hashes phone numbers without a + prefix", async () => {
      await call("add_customer_match_members", {
        customerId: "123",
        resourceName: "customers/123/offlineUserDataJobs/9",
        members: [{ phoneNumber: " 650-555-1212 " }],
      });
      const arg = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0];
      expect(arg.operations[0].create.user_identifiers).toEqual([
        { hashed_phone_number: sha256("6505551212") },
      ]);
    });

    it("builds an address_info identifier from the full address tuple", async () => {
      await call("add_customer_match_members", {
        customerId: "123",
        resourceName: "customers/123/offlineUserDataJobs/9",
        members: [
          {
            firstName: " John ",
            lastName: " Doe ",
            countryCode: "us",
            postalCode: " 94043 - 1351 ",
          },
        ],
      });
      const arg = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0];
      expect(arg.operations[0].create.user_identifiers).toEqual([
        {
          address_info: {
            hashed_first_name: sha256("john"),
            hashed_last_name: sha256("doe"),
            country_code: "US",
            postal_code: "94043-1351",
          },
        },
      ]);
    });

    it("combines all identifier kinds for one member", async () => {
      await call("add_customer_match_members", {
        customerId: "123",
        resourceName: "customers/123/offlineUserDataJobs/9",
        members: [
          {
            email: "a@b.com",
            phoneNumber: "+1234567890",
            firstName: "Jane",
            lastName: "Roe",
            countryCode: "GB",
            postalCode: "SW1A1AA",
          },
        ],
      });
      const ids = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0]
        .operations[0].create.user_identifiers;
      expect(ids).toHaveLength(3);
      expect(ids[0]).toHaveProperty("hashed_email");
      expect(ids[1]).toHaveProperty("hashed_phone_number");
      expect(ids[2]).toHaveProperty("address_info");
    });

    it("respects explicit false flags", async () => {
      await call("add_customer_match_members", {
        customerId: "123",
        resourceName: "customers/123/offlineUserDataJobs/9",
        members: [{ email: "a@b.com" }],
        enablePartialFailure: false,
        enableWarnings: false,
      });
      const arg = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0];
      expect(arg.enable_partial_failure).toBe(false);
      expect(arg.enable_warnings).toBe(false);
    });

    it("errors when resourceName belongs to a different customer", async () => {
      const res = await call("add_customer_match_members", {
        customerId: "123",
        resourceName: "customers/999/offlineUserDataJobs/9",
        members: [{ email: "a@b.com" }],
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/does not belong to the authorized customer/i);
    });

    it("errors when a member has no usable identifier", async () => {
      const res = await call("add_customer_match_members", {
        customerId: "123",
        resourceName: "customers/123/offlineUserDataJobs/9",
        members: [{ firstName: "OnlyFirst" }],
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/at least one valid identifier/i);
    });

    it("normalizes a dashed customerId before the resource guard", async () => {
      const res = await call("add_customer_match_members", {
        customerId: "12-34-56",
        resourceName: "customers/123456/offlineUserDataJobs/9",
        members: [{ email: "a@b.com" }],
      });
      expect(res.isError).toBeUndefined();
    });
  });

  describe("remove_customer_match_members", () => {
    it("uses the remove mutation type", async () => {
      const res = await call("remove_customer_match_members", {
        customerId: "123",
        resourceName: "customers/123/offlineUserDataJobs/9",
        members: [{ email: "a@b.com" }],
      });
      expect(res.isError).toBeUndefined();
      const arg = customer.offlineUserDataJobs.addOfflineUserDataJobOperations.mock.calls[0][0];
      expect(arg.operations[0]).toHaveProperty("remove");
      expect(arg.operations[0].remove.user_identifiers[0]).toHaveProperty("hashed_email");
    });

    it("errors when resourceName belongs to a different customer", async () => {
      const res = await call("remove_customer_match_members", {
        customerId: "123",
        resourceName: "customers/777/offlineUserDataJobs/9",
        members: [{ email: "a@b.com" }],
      });
      expect(res.isError).toBe(true);
    });
  });

  describe("create_customer_match_job_with_members", () => {
    it("creates a job, adds members, and runs it when runNow is true", async () => {
      const res = await call("create_customer_match_job_with_members", {
        customerId: "12-34-56",
        userListId: "555",
        members: [{ email: "a@b.com" }],
        runNow: true,
      });
      expect(res.isError).toBeUndefined();
      const created = customer.offlineUserDataJobs.createOfflineUserDataJob.mock.calls[0][0];
      expect(created.customer_id).toBe("123456");
      expect(created.job.type).toBe("CUSTOMER_MATCH_USER_LIST");
      expect(created.job.customer_match_user_list_metadata.user_list).toBe(
        "customers/123456/userLists/555"
      );
      expect(customer.offlineUserDataJobs.runOfflineUserDataJob).toHaveBeenCalledWith({
        resource_name: "customers/1/offlineUserDataJobs/9",
      });
      const payload = toolJson(res) as any;
      expect(payload.resourceName).toBe("customers/1/offlineUserDataJobs/9");
      expect(payload.runResponse).not.toBeNull();
    });

    it("does not run the job when runNow is false", async () => {
      const res = await call("create_customer_match_job_with_members", {
        customerId: "123",
        userListId: "555",
        members: [{ email: "a@b.com" }],
        runNow: false,
      });
      expect(customer.offlineUserDataJobs.runOfflineUserDataJob).not.toHaveBeenCalled();
      expect((toolJson(res) as any).runResponse).toBeNull();
    });

    it("accepts a full userList resource name unchanged", async () => {
      await call("create_customer_match_job_with_members", {
        customerId: "123",
        userListId: "customers/123/userLists/888",
        members: [{ email: "a@b.com" }],
        runNow: false,
      });
      const created = customer.offlineUserDataJobs.createOfflineUserDataJob.mock.calls[0][0];
      expect(created.job.customer_match_user_list_metadata.user_list).toBe(
        "customers/123/userLists/888"
      );
    });

    it("reads resourceName from the camelCase response key", async () => {
      customer.offlineUserDataJobs.createOfflineUserDataJob.mockResolvedValueOnce({
        resourceName: "customers/1/offlineUserDataJobs/77",
      });
      const res = await call("create_customer_match_job_with_members", {
        customerId: "123",
        userListId: "555",
        members: [{ email: "a@b.com" }],
        runNow: false,
      });
      expect((toolJson(res) as any).resourceName).toBe("customers/1/offlineUserDataJobs/77");
    });

    it("errors when the create response has no resource name", async () => {
      customer.offlineUserDataJobs.createOfflineUserDataJob.mockResolvedValueOnce({});
      const res = await call("create_customer_match_job_with_members", {
        customerId: "123",
        userListId: "555",
        members: [{ email: "a@b.com" }],
      });
      expect(res.isError).toBe(true);
      expect((toolJson(res) as any).__error).toMatch(/did not return resource_name/i);
      expect(customer.offlineUserDataJobs.addOfflineUserDataJobOperations).not.toHaveBeenCalled();
    });
  });

  describe("member schema refine (exposed via inputSchema)", () => {
    // The refine callback lives on CustomerMatchMemberSchema, embedded in the
    // `members` array of the add tool's inputSchema. captureTools bypasses
    // parsing, so exercise the refine directly through the exposed schema.
    const membersSchema = () =>
      getTool(tools, "add_customer_match_members").config.inputSchema!.members as any;

    it("accepts a member with an email", () => {
      expect(() => membersSchema().parse([{ email: "a@b.com" }])).not.toThrow();
    });

    it("accepts a member with only a phone number", () => {
      expect(() => membersSchema().parse([{ phoneNumber: "+1234567890" }])).not.toThrow();
    });

    it("accepts a member with the full address tuple", () => {
      expect(() =>
        membersSchema().parse([
          { firstName: "A", lastName: "B", countryCode: "US", postalCode: "94043" },
        ])
      ).not.toThrow();
    });

    it("rejects a member with no identifiers", () => {
      expect(() => membersSchema().parse([{}])).toThrow(
        /email, phoneNumber, or full address tuple/i
      );
    });

    it("rejects a member with a partial address tuple", () => {
      expect(() => membersSchema().parse([{ firstName: "A", lastName: "B" }])).toThrow();
    });
  });

  describe("list_customer_match_jobs", () => {
    it("builds the GAQL query", async () => {
      const res = await call("list_customer_match_jobs", { customerId: "123", limit: 50 });
      expect(res.isError).toBeUndefined();
      const arg = (runQuery as any).mock.calls[0][0];
      expect(arg.customerId).toBe("123");
      expect(arg.query).toContain("FROM offline_user_data_job");
      expect(arg.query).toContain("WHERE offline_user_data_job.type = CUSTOMER_MATCH_USER_LIST");
      expect(arg.query).toContain("ORDER BY offline_user_data_job.id DESC");
      expect(arg.query).toContain("LIMIT 50");
    });

    it("honors an explicit limit", async () => {
      await call("list_customer_match_jobs", { customerId: "123", limit: 7 });
      expect((runQuery as any).mock.calls[0][0].query).toContain("LIMIT 7");
    });
  });
});
