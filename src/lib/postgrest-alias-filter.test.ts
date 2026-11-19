import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// PostgREST: an aliased embed (room:rooms!inner) is filtered by its alias (room.branch_id); filtering by
// the table name (rooms.branch_id) is deprecated (PostgREST #4075). Caught twice in review (#586, #587).
describe("aliased PostgREST embeds", () => {
  it("are filtered by the alias, not the table name", () => {
    const offenders = (readdirSync("src", { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => {
        const s = readFileSync(join("src", f), "utf8");
        return s.includes("room:rooms") && /\.(in|eq|neq|gt|gte|lt|lte|is)\("rooms\./.test(s);
      });
    expect(offenders).toEqual([]);
  });
});
