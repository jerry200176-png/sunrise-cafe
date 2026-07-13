import { existsSync, readFileSync } from "fs";
import { join } from "path";

export type TaskWallItem = {
  id: string;
  title: string;
  role: string;
  score: number;
  executable: boolean;
  blocked_reason: string | null;
  owner?: string;
};

export type FailureLearning = {
  ts: string;
  phase: string;
  task_id: string;
  antibody: string;
  vaccine: string;
  catalyst: string;
};

export type OrchestratorSnapshot = {
  generated_at: string;
  status: "ok" | "degraded" | "unavailable";
  next_task: TaskWallItem | null;
  ranked_executable: TaskWallItem[];
  top_blocked: TaskWallItem[];
  gate_block: boolean;
  iteration_count: number;
  operational_mode: string;
  stall: { stalled: boolean; warnings: { code: string; message: string }[] };
  recent_learnings: FailureLearning[];
  blockers: { id: string; owner: string; reason: string; action?: string }[];
  last_iteration: {
    task_id: string;
    outcome: string;
    completed_at: string;
    pr?: string;
  } | null;
};

function readJson<T>(relPath: string): T | null {
  const path = join(process.cwd(), relPath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function readJsonl<T>(relPath: string, limit = 5): T[] {
  const path = join(process.cwd(), relPath);
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

/** Read orchestrator task wall + stall state for admin dashboard. */
export function collectOrchestratorSnapshot(): OrchestratorSnapshot {
  const wall = readJson<{
    generated_at?: string;
    next_task?: TaskWallItem | null;
    ranked_executable?: TaskWallItem[];
    top_blocked?: TaskWallItem[];
    gate_block?: boolean;
    state?: {
      iteration_count?: number;
      operational_mode?: string;
      blockers?: OrchestratorSnapshot["blockers"];
      last_iteration?: OrchestratorSnapshot["last_iteration"];
    };
    stall?: OrchestratorSnapshot["stall"];
    recent_learnings?: FailureLearning[];
  }>("orchestrator/task-wall.json");

  const priority = readJson<{
    generated_at?: string;
    next_task?: TaskWallItem | null;
    ranked?: TaskWallItem[];
    top_blocked?: TaskWallItem[];
    gate_block?: boolean;
  }>("orchestrator/priority.json");

  const state = readJson<{
    iteration_count?: number;
    operational_mode?: string;
    blockers?: OrchestratorSnapshot["blockers"];
    last_iteration?: OrchestratorSnapshot["last_iteration"];
  }>("orchestrator/state.json");

  const stall =
    readJson<OrchestratorSnapshot["stall"]>("orchestrator/stall.json") ?? {
      stalled: false,
      warnings: [],
    };

  const learnings =
    wall?.recent_learnings ??
    readJsonl<FailureLearning>("orchestrator/failure-learnings.jsonl", 5);

  if (!wall && !priority && !state) {
    return {
      generated_at: new Date().toISOString(),
      status: "unavailable",
      next_task: null,
      ranked_executable: [],
      top_blocked: [],
      gate_block: false,
      iteration_count: 0,
      operational_mode: "UNKNOWN",
      stall,
      recent_learnings: learnings,
      blockers: [],
      last_iteration: null,
    };
  }

  const ranked = wall?.ranked_executable ??
    (priority?.ranked ?? []).filter((t) => t.executable).slice(0, 8);

  return {
    generated_at:
      wall?.generated_at ?? priority?.generated_at ?? new Date().toISOString(),
    status: stall.stalled ? "degraded" : "ok",
    next_task: wall?.next_task ?? priority?.next_task ?? null,
    ranked_executable: ranked,
    top_blocked: wall?.top_blocked ?? priority?.top_blocked ?? [],
    gate_block: wall?.gate_block ?? priority?.gate_block ?? false,
    iteration_count:
      wall?.state?.iteration_count ?? state?.iteration_count ?? 0,
    operational_mode:
      wall?.state?.operational_mode ?? state?.operational_mode ?? "UNKNOWN",
    stall,
    recent_learnings: learnings,
    blockers: wall?.state?.blockers ?? state?.blockers ?? [],
    last_iteration:
      wall?.state?.last_iteration ?? state?.last_iteration ?? null,
  };
}
