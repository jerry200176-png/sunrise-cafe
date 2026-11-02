#!/usr/bin/env node
// The response can contain values. Do not print, persist or return its body.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://api.vercel.com/v10/projects/prj_5swHVn2nqzrZ50VYx1zoEXZAvKiP/env?teamId=team_o4vau0vkVyakLaNFPmhXkL5M&decrypt=false';
const NAMES = Object.freeze(['LINE_PAY_CHANNEL_ID', 'LINE_PAY_CHANNEL_SECRET', 'LINE_PAY_API_BASE_URL']);
const TARGETS = Object.freeze(['production', 'preview', 'development']);
const MAX_BYTES = 2 * 1024 * 1024;

export async function inspectMetadata(token, request = fetch) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('diagnostic unavailable');
  let response;
  try {
    response = await request(ENDPOINT, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('diagnostic unavailable');
  }
  if (response.status !== 200 || !response.body) {
    if (response.body) void response.body.cancel().catch(() => {});
    throw new Error('diagnostic unavailable');
  }
  const reader = response.body.getReader();
  let raw = '';
  let parsed;
  let bytes = 0;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('diagnostic unavailable');
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.envs)) throw new Error('diagnostic unavailable');
    const observed = new Set();
    for (const item of parsed.envs) {
      if (!item || typeof item !== 'object' || !NAMES.includes(item.key)) continue;
      const targets = Array.isArray(item.target) ? item.target : [item.target];
      for (const name of NAMES) {
        if (item.key !== name) continue;
        for (const target of TARGETS) if (targets.includes(target)) observed.add(`${name}: ${target}`);
      }
    }
    return [...observed].sort();
  } catch {
    throw new Error('diagnostic unavailable');
  } finally {
    raw = '';
    parsed = undefined;
    try { void reader.cancel().catch(() => {}); } catch { /* Do not expose transport errors. */ }
    reader.releaseLock();
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('diagnostic unavailable');
  }
  const observed = await inspectMetadata(process.env.VERCEL_TOKEN);
  console.log('LINE Pay project variable targets observed (preview may be branch-scoped):');
  for (const line of observed) console.log(line);
  console.log('Completeness unknown; absence, values, deployed configuration and payment readiness were not verified.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('LINE Pay environment diagnostic unavailable; no configuration conclusion.');
    process.exitCode = 1;
  });
}
