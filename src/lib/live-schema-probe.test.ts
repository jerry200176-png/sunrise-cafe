import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("live schema probe safety contract", () => {
  const script = readFileSync(resolve(process.cwd(), "scripts/verify-live-schema-readonly.mjs"), "utf8");

  it("covers the production relations required by the reservation/order evidence gate", () => {
    for (const relation of [
      "reservations", "rooms", "menu_categories", "menu_items", "menu_item_options",
      "orders", "order_items", "ops_events",
    ]) expect(script).toContain(`"${relation}"`);
    expect(script).toContain("information_schema.columns");
    expect(script).toContain("pg_constraint");
    expect(script).toContain("pg_indexes");
    expect(script).toContain("pg_policies");
    expect(script).toContain("role_table_grants");
  });

  it("has no mutation primitive or migration-file execution path", () => {
    expect(script).not.toMatch(/CREATE\s+|ALTER\s+|DROP\s+|INSERT\s+|UPDATE\s+|DELETE\s+/i);
    expect(script).not.toContain("migration-reservation-preorder.sql");
    expect(script).toContain("read-only-postgres-catalog");
  });
});
