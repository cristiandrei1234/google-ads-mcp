import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the heavy boundaries the handlers call. Factories are hoisted by vitest.
vi.mock("../services/google-ads/client.js", () => ({ getCustomer: vi.fn(), getClient: vi.fn() }));
vi.mock("../services/google-ads/mutator.js", () => ({ runMutation: vi.fn() }));

import { createUserList, listUserLists } from "./audiences.js";
import { getCustomer } from "../services/google-ads/client.js";
import { runMutation } from "../services/google-ads/mutator.js";
import { fakeCustomer } from "../test/harness.js";

beforeEach(() => {
  vi.clearAllMocks();
  (getCustomer as any).mockResolvedValue(fakeCustomer());
  (runMutation as any).mockResolvedValue({ results: [{ resource_name: "rn" }] });
});

describe("audiences tools", () => {
  it("createUserList builds a CRM_BASED user_list create mutation with all fields", async () => {
    const res = await createUserList({
      customerId: "1",
      name: "My List",
      description: "desc",
      membershipLifeSpan: 60,
      userId: "u1",
    });

    expect(getCustomer).toHaveBeenCalledWith("1", "u1");
    const ops = (runMutation as any).mock.calls[0][1];
    expect(ops[0].user_list_operation.create).toEqual({
      name: "My List",
      description: "desc",
      membership_life_span: 60,
      crm_based_user_list: { upload_key_type: "CONTACT_INFO" },
    });
    expect(res).toEqual({ results: [{ resource_name: "rn" }] });
  });

  it("createUserList passes undefined description and undefined userId through", async () => {
    await createUserList({
      customerId: "2",
      name: "Bare",
      membershipLifeSpan: 30,
    } as any);

    expect(getCustomer).toHaveBeenCalledWith("2", undefined);
    const create = (runMutation as any).mock.calls[0][1][0].user_list_operation.create;
    expect(create.description).toBeUndefined();
    expect(create.membership_life_span).toBe(30);
  });

  it("listUserLists queries the user_list resource and returns the rows", async () => {
    const rows = [{ user_list: { id: "9", name: "L" } }];
    (getCustomer as any).mockResolvedValue(fakeCustomer(rows));

    const result = await listUserLists({ customerId: "3", userId: "u9" });

    expect(getCustomer).toHaveBeenCalledWith("3", "u9");
    const customer = await (getCustomer as any).mock.results[0].value;
    const query = customer.query.mock.calls[0][0];
    expect(query).toContain("FROM user_list");
    expect(query).toContain("user_list.id");
    expect(query).toContain("user_list.size_for_display");
    expect(result).toEqual(rows);
  });
});
