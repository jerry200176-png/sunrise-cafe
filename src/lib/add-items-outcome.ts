import { friendlyMessage } from "@/lib/friendly-error";
import { readJsonWithTimeout } from "@/lib/fetch-with-timeout";

type Data = Record<string, unknown>;
export type AddItemsOutcome =
  | { kind: "committed"; data: Data }
  | { kind: "not_attempted"; message: string }
  | { kind: "unknown"; message: string };

function object(value: unknown): value is Data {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Only the documented add response shapes confirm a commit. */
export async function readAddItemsOutcome(response: Response): Promise<AddItemsOutcome> {
  let data: unknown;
  try { data = await readJsonWithTimeout<unknown>(response); } catch { return { kind: "unknown", message: "回應無法辨識" }; }
  if (!object(data)) return { kind: "unknown", message: "回應無法辨識" };
  if (!response.ok) {
    const message = friendlyMessage(typeof data.error === "string" ? data.error : undefined, response.status);
    if (response.status >= 400 && response.status < 500 && data.add_outcome === "not_attempted") {
      return { kind: "not_attempted", message };
    }
    return { kind: "unknown", message };
  }
  const committedWithoutRefresh = data.committed === true && data.refresh_failed === true;
  const fullView = object(data.order) && typeof data.order.id === "string" && data.order.id.length > 0 &&
    object(data.billing) && typeof data.billing.end_time === "string" && data.billing.end_time.length > 0;
  if (data.ok === true && (committedWithoutRefresh || (data.refresh_failed !== true && fullView))) {
    return { kind: "committed", data };
  }
  return { kind: "unknown", message: "回應無法確認加點結果" };
}
