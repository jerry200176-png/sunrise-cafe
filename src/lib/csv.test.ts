import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "./csv";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvRow(["A包廂, 大安", 'say "hi"', "x\ny", 3])).toBe('"A包廂, 大安","say ""hi""","x\ny",3');
  });
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
  });
});
