"use client";

import { MapPin } from "lucide-react";
import type { Branch } from "@/types";

interface BranchSwitcherProps {
  branches: Branch[];
  currentBranchId: string | null;
  onBranchChange: (branchId: string | null) => void;
  disabled?: boolean;
}

export function BranchSwitcher({
  branches,
  currentBranchId,
  onBranchChange,
  disabled,
}: BranchSwitcherProps) {
  return (
    <div className="flex items-center gap-2">
      <MapPin className="h-5 w-5 text-gray-500 shrink-0" aria-hidden />
      <select
        value={currentBranchId ?? ""}
        onChange={(e) =>
          onBranchChange(e.target.value ? e.target.value : null)
        }
        disabled={disabled}
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600 disabled:bg-gray-100"
        aria-label="選擇分店"
      >
        <option value="">請選擇分店</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  );
}
