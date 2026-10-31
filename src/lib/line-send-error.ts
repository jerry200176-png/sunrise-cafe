/** Provider acceptance is unknown for network failures, 5xx, and a bare 409. */
export type LineSendFailure = "not_sent" | "rejected" | "unknown";

export class LineSendError extends Error {
  constructor(message: string, readonly outcome: LineSendFailure) {
    super(message);
    this.name = "LineSendError";
  }
}

/** A response only establishes rejection for unambiguous client errors. */
export function lineHttpFailure(status: number): LineSendFailure {
  return status >= 400 && status < 500 && status !== 408 && status !== 409 ? "rejected" : "unknown";
}

/** Unclassified exceptions may have occurred after the provider accepted the request. */
export function lineSendFailure(error: unknown): LineSendFailure {
  return error instanceof LineSendError ? error.outcome : "unknown";
}
