"use client";

import { useEffect, useState } from "react";
import type { Worker } from "tesseract.js";
import { taipeiDateString } from "@/lib/datetime";
import { readTransferText, type TransferReading } from "@/lib/transfer-text";

// One OCR worker for the page, images read one at a time. English/digits model only: the fields
// staff need (amount, date, account) are digits.
// The worker, wasm core and model are served from our own domain (/ocr, copied from node_modules
// by scripts/copy-ocr-assets.mjs at build), so nothing is loaded from a CDN.
let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function ocr(image: Blob): Promise<string> {
  workerPromise ??= import("tesseract.js").then(({ createWorker }) => {
    const base = `${window.location.origin}/ocr`;
    return createWorker("eng", 1, { workerPath: `${base}/worker.min.js`, corePath: base, langPath: base, gzip: false });
  });
  const job = queue.then(async () => (await (await workerPromise!).recognize(image)).data.text);
  queue = job.catch(() => undefined);
  job.catch(() => { workerPromise = null; }); // a failed load may succeed on the next screenshot
  return job;
}

type State = { status: "reading" } | { status: "failed" } | { status: "done"; reading: TransferReading | null };

/** Plain-language line under a payment screenshot. Display only: never approves or stores anything. */
export function ScreenshotReading({ src, expectedAmount }: { src: string; expectedAmount: number | null }) {
  const [state, setState] = useState<State>({ status: "reading" });

  useEffect(() => {
    let cancelled = false;
    fetch(src)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`image ${res.status}`))))
      .then(ocr)
      .then((text) => {
        if (!cancelled) setState({ status: "done", reading: readTransferText(text, expectedAmount, taipeiDateString()) });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed" });
      });
    return () => { cancelled = true; };
  }, [src, expectedAmount]);

  if (state.status === "reading") {
    return <p className="mt-2 text-xs text-stone-500" role="status">讀取截圖中…</p>;
  }
  const reading = state.status === "done" ? state.reading : null;
  if (!reading) {
    return <p className="mt-2 text-xs text-stone-500" role="status">無法自動讀取，請看截圖。</p>;
  }
  return (
    <div className="mt-2 max-w-xs rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
      <p className="font-medium">自動讀到：</p>
      {expectedAmount != null && (
        <p className="mt-1">
          {reading.amountFound
            ? <>✓ 截圖裡有 <strong>NT${expectedAmount}</strong>，與應收訂金相符</>
            : <>⚠ 截圖裡找不到 <strong>NT${expectedAmount}</strong>，請看截圖</>}
        </p>
      )}
      {reading.date && <p className="mt-1">日期：<strong>{reading.date.slice(5).replace("-", "/")}</strong></p>}
      {reading.lastFives.length > 0 && (
        <p className="mt-1">畫面上的帳號末五碼：<strong>{reading.lastFives.join("、")}</strong></p>
      )}
      <p className="mt-1 text-xs text-amber-800">機器讀的，請對照截圖再確認已收款。</p>
    </div>
  );
}
