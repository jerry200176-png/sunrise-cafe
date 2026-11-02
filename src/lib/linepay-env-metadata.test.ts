import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { inspectMetadata } from '../../scripts/inspect-linepay-env-metadata.mjs';

const root = process.cwd();
const canary = 'fixture-private-value-never-print';
const syntheticToken = 'fixture-token-never-print';
const good = () => new Response(JSON.stringify({ envs: [
  { key: 'LINE_PAY_CHANNEL_ID', target: ['production', 'preview'], value: canary },
  { key: 'LINE_PAY_CHANNEL_SECRET', target: 'production', value: canary },
  { key: canary, target: 'production', value: canary },
  { key: 'LINE_PAY_API_BASE_URL', target: [canary, '\u001b[31m'], value: canary },
] }), { status: 200 });

describe('LINE Pay metadata-only display', () => {
  it('uses fixed HTTPS project and team, GET, no redirects, timeout, and emits only allowed constants', async () => {
    const request = vi.fn().mockResolvedValue(good());
    const result = await inspectMetadata(syntheticToken, request);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.vercel.com/v10/projects/prj_5swHVn2nqzrZ50VYx1zoEXZAvKiP/env?teamId=team_o4vau0vkVyakLaNFPmhXkL5M&decrypt=false');
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual(['LINE_PAY_CHANNEL_ID: preview', 'LINE_PAY_CHANNEL_ID: production', 'LINE_PAY_CHANNEL_SECRET: production']);
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toContain(syntheticToken);
  });

  it.each([301, 302, 403, 404, 429, 500])('does not expose or parse error body on HTTP %s', async (status) => {
    const response = new Response(canary, { status });
    vi.spyOn(response, 'json').mockImplementation(() => { throw new Error(canary); });
    const result = await inspectMetadata(syntheticToken, async () => response).catch((e: Error) => e.message);
    expect(result).toBe('diagnostic unavailable');
    expect(result).not.toContain(canary);
    expect(response.json).not.toHaveBeenCalled();
  });

  it.each(['', '{', '{}', '{"envs":null}', `{"envs":[],"x":"${'x'.repeat(2 * 1024 * 1024)}"}`])('rejects malformed or oversize bodies safely', async (body) => {
    await expect(inspectMetadata(syntheticToken, async () => new Response(body))).rejects.toThrow('diagnostic unavailable');
  });

  it('hides network errors and missing credentials', async () => {
    await expect(inspectMetadata('', async () => { throw new Error(canary); })).rejects.toThrow('diagnostic unavailable');
    await expect(inspectMetadata(syntheticToken, async () => { throw new Error(canary); })).rejects.toThrow('diagnostic unavailable');
  });

  it('fails closed on a stalled body via the request abort signal', async () => {
    const request = vi.fn((_url, init?: RequestInit) => {
      const stream = new ReadableStream({
        start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error(canary))); },
      });
      setTimeout(() => (init?.signal as AbortSignal).dispatchEvent(new Event('abort')), 5);
      return Promise.resolve(new Response(stream));
    });
    await expect(inspectMetadata(syntheticToken, request)).rejects.toThrow('diagnostic unavailable');
  });

  it('allows only main-branch manual execution and never prints synthetic values or the token', () => {
    const fixture = resolve(root, 'scripts/test-fixtures/linepay-metadata-synthetic-fetch.mjs');
    const script = resolve(root, 'scripts/inspect-linepay-env-metadata.mjs');
    const scratch = mkdtempSync(resolve(tmpdir(), 'linepay-metadata-'));
    const run = (ref: string, event: string) => spawnSync(process.execPath, [script], {
      cwd: scratch, encoding: 'utf8', timeout: 10000,
      env: { NODE_ENV: 'test', GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: event, GITHUB_REF: ref, VERCEL_TOKEN: syntheticToken, NODE_OPTIONS: `--import=${fixture}` },
    });
    try {
      const ok = run('refs/heads/main', 'workflow_dispatch');
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('Completeness unknown');
      expect(ok.stdout).toContain('LINE_PAY_CHANNEL_ID: production');
      expect(ok.stdout + ok.stderr).not.toContain(canary);
      expect(ok.stdout + ok.stderr).not.toContain(syntheticToken);
      for (const invalid of [run('refs/heads/other', 'workflow_dispatch'), run('refs/heads/main', 'pull_request')]) {
        expect(invalid.status).toBe(1);
        expect(invalid.stdout + invalid.stderr).not.toContain(canary);
        expect(invalid.stdout + invalid.stderr).not.toContain(syntheticToken);
      }
      expect(readdirSync(scratch)).toEqual([]);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });

  it('limits the real workflow to a main-only manual event and one credentialed fixed command', () => {
    type Step = { uses?: string; with?: Record<string, unknown>; env?: Record<string, string>; run?: string };
    type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { if?: string; permissions: Record<string, string>; 'timeout-minutes': number; steps: Step[] }> };
    const yaml = createRequire(import.meta.url)('js-yaml') as { load: (input: string) => unknown };
    const workflow = yaml.load(readFileSync(resolve(root, '.github/workflows/inspect-linepay-env-metadata.yml'), 'utf8')) as Workflow;
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(workflow.permissions).toEqual({});
    expect(Object.keys(workflow.jobs)).toEqual(['inspect']);
    expect(workflow.jobs.inspect.if).toBe("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'");
    expect(workflow.jobs.inspect.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.inspect['timeout-minutes']).toBe(2);
    expect(workflow.jobs.inspect.steps).toHaveLength(3);
    expect(workflow.jobs.inspect.steps[0].uses).toMatch(/^actions\/checkout@[a-f0-9]{40}$/);
    expect(workflow.jobs.inspect.steps[0].with).toEqual({ 'persist-credentials': false });
    expect(workflow.jobs.inspect.steps[1].uses).toMatch(/^actions\/setup-node@[a-f0-9]{40}$/);
    expect(workflow.jobs.inspect.steps[1].with).toEqual({ 'node-version': '22', 'package-manager-cache': false });
    expect(workflow.jobs.inspect.steps[2].env).toEqual({ VERCEL_TOKEN: '${{ secrets.VERCEL_TOKEN }}' });
    expect(workflow.jobs.inspect.steps[2].run).toBe('node scripts/inspect-linepay-env-metadata.mjs');
  });
});
