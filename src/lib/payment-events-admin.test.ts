import { describe, expect, it } from "vitest";

/**
 * 審核狀態轉換規則（與 payment-events-admin 邏輯對齊，純函式供測試）
 */
export function resolveApproveAction(
  currentStatus: string
): "approve" | "noop" | "conflict" {
  if (currentStatus === "approved") return "noop";
  if (currentStatus === "pending_review") return "approve";
  return "conflict";
}

export function resolveRejectAction(
  currentStatus: string
): "reject" | "noop" | "conflict" {
  if (currentStatus === "rejected") return "noop";
  if (currentStatus === "pending_review") return "reject";
  return "conflict";
}

describe("payment review idempotency rules", () => {
  it("approve on approved is noop", () => {
    expect(resolveApproveAction("approved")).toBe("noop");
  });

  it("approve on pending_review proceeds", () => {
    expect(resolveApproveAction("pending_review")).toBe("approve");
  });

  it("approve on rejected is conflict", () => {
    expect(resolveApproveAction("rejected")).toBe("conflict");
  });

  it("reject on rejected is noop", () => {
    expect(resolveRejectAction("rejected")).toBe("noop");
  });

  it("reject on pending_review proceeds", () => {
    expect(resolveRejectAction("pending_review")).toBe("reject");
  });

  it("reject on approved is conflict", () => {
    expect(resolveRejectAction("approved")).toBe("conflict");
  });
});
