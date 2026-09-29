import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { customerTokenForBranch, matchCustomerBotSignature, parseBranchCustomerBots } from "./customer-line-bots";

const TONGDE = "11111111-2222-4333-8444-555555555555";
const bot = { branchId: TONGDE, name: "同德店", secret: "td-secret", token: "td-token" };

describe("parseBranchCustomerBots", () => {
  it("keeps complete entries and ignores broken ones without throwing", () => {
    const raw = JSON.stringify([
      { branch_id: TONGDE, name: "同德店", secret: "td-secret", token: "td-token" },
      { branch_id: "not-a-uuid", secret: "s", token: "t" },
      { branch_id: TONGDE, secret: "", token: "t" },
    ]);
    expect(parseBranchCustomerBots(raw)).toEqual([bot]);
    expect(parseBranchCustomerBots("nope")).toEqual([]);
    expect(parseBranchCustomerBots(undefined)).toEqual([]);
  });
});

describe("customerTokenForBranch", () => {
  it("uses the branch's own account when configured, else the default account", () => {
    expect(customerTokenForBranch(TONGDE, [bot], "default")).toBe("td-token");
    expect(customerTokenForBranch("99999999-2222-4333-8444-555555555555", [bot], "default")).toBe("default");
    expect(customerTokenForBranch(null, [bot], "default")).toBe("default");
  });
});

describe("matchCustomerBotSignature", () => {
  it("identifies the branch account that signed the body, or nothing", () => {
    const body = '{"events":[]}';
    const sign = (s: string) => crypto.createHmac("sha256", s).update(body).digest("base64");
    expect(matchCustomerBotSignature(body, sign("td-secret"), [bot])).toEqual(bot);
    expect(matchCustomerBotSignature(body, sign("other"), [bot])).toBeNull();
    expect(matchCustomerBotSignature(body, "", [bot])).toBeNull();
  });
});
