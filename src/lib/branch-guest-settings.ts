import type { RentalNoteSection } from "@/types";

type BranchOverrides = {
  rental_notes?: RentalNoteSection[] | null;
  deposit_info?: string | null;
  google_review_url?: string | null;
} | null | undefined;

type SharedSettings = {
  rental_notes: RentalNoteSection[];
  deposit_info: string | null;
  google_review_url?: string | null;
};

/** Branch value when filled in, otherwise the shared settings row (same rule as closed dates). */
export function resolveBranchGuestSettings(branch: BranchOverrides, shared: SharedSettings) {
  return {
    rental_notes: branch?.rental_notes?.length ? branch.rental_notes : shared.rental_notes,
    deposit_info: branch?.deposit_info?.trim() ? branch.deposit_info : shared.deposit_info,
    google_review_url: branch?.google_review_url?.trim() ? branch.google_review_url : shared.google_review_url ?? null,
  };
}

/**
 * Admin textarea format: blank line between sections, first line = section title,
 * following lines = items. Empty text → null (use the shared notes).
 */
export function parseRentalNotesText(text: string): RentalNoteSection[] | null {
  const sections = text
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map(([title, ...items]) => ({ title, items }));
  return sections.length ? sections : null;
}

export function formatRentalNotesText(sections: RentalNoteSection[] | null | undefined): string {
  return (sections ?? []).map((s) => [s.title, ...s.items].join("\n")).join("\n\n");
}
