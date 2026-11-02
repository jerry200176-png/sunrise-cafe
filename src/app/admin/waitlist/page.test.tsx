// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => <div>{actions}{children}</div>,
}));

import AdminWaitlistPage from './page';

const item = { id: 'synthetic-waitlist-1', customer_name: '測試客', phone: '0900000000',
  start_time: '2026-10-31T10:00:00Z', end_time: '2026-10-31T11:00:00Z', status: 'waiting',
  created_at: '2026-10-30T10:00:00Z', notified_at: null, staff_called_at: null,
  room_name: '測試房', branch_name: '測試店', has_line: false, needs_call: true };
const pendingKey = 'sunrise.waitlist.pending-write.v1';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const listing = (items = [item]) => json({ items, needs_call_count: items.filter((entry) => entry.needs_call).length });

describe('waitlist write uncertainty', () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); });

  it('locks after a lost write response across reload; requires successful manual review and explicit acknowledgement', async () => {
    let writes = 0;
    const request = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PATCH') { writes++; throw new Error('connection lost'); }
      return listing();
    });
    vi.stubGlobal('fetch', request);
    const user = userEvent.setup();
    const page = render(<AdminWaitlistPage />);
    await user.click(await screen.findByRole('button', { name: '標記已來電' }));
    expect(await screen.findByText(/上次等位操作的結果尚未確認/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '標記已來電' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: '已核對，解除本分頁限制' })).toBeNull();
    const saved = sessionStorage.getItem(pendingKey) ?? '';
    expect(saved).toContain(item.id);
    expect(saved).not.toContain(item.customer_name);
    expect(saved).not.toContain(item.phone);
    page.unmount();
    render(<AdminWaitlistPage />);
    expect(await screen.findByText(/上次等位操作的結果尚未確認/)).toBeTruthy();
    await screen.findByText('測試客');
    expect((screen.getByRole('button', { name: '標記已來電' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '重新整理核對' }));
    const unlock = await screen.findByRole('button', { name: '已核對，解除本分頁限制' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(unlock);
    expect((screen.getByRole('button', { name: '標記已來電' }) as HTMLButtonElement).disabled).toBe(false);
    expect(sessionStorage.getItem(pendingKey)).toBeNull();
    expect(writes).toBe(1);
  });

  it('leaves ambiguous 2xx or non-2xx locked and never calls the write twice', async () => {
    for (const outcome of [json({ ok: true, id: item.id }), json({ error: 'unavailable' }, 503)]) {
      let writes = 0;
      vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
        if (options?.method === 'PATCH') { writes++; return outcome; }
        return listing();
      }));
      const user = userEvent.setup();
      const page = render(<AdminWaitlistPage />);
      await user.click(await screen.findByRole('button', { name: '標記已來電' }));
      expect(await screen.findByText(/上次等位操作的結果尚未確認/)).toBeTruthy();
      expect((screen.getByRole('button', { name: '標記已來電' }) as HTMLButtonElement).disabled).toBe(true);
      expect(writes).toBe(1);
      page.unmount(); sessionStorage.clear();
    }
  });

  it('blocks all mutations and refresh while a write is pending, then applies a valid response once', async () => {
    let resolveWrite!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveWrite = resolve; });
    let reads = 0; let writes = 0;
    const request = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PATCH') { writes++; return pending; }
      reads++; return listing();
    });
    vi.stubGlobal('fetch', request);
    const interval = vi.spyOn(window, 'setInterval');
    const user = userEvent.setup();
    render(<AdminWaitlistPage />);
    await user.click(await screen.findByRole('button', { name: '標記已來電' }));
    expect((screen.getByRole('button', { name: '移除' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '重新整理' }) as HTMLButtonElement).disabled).toBe(true);
    const tick = interval.mock.calls[0]?.[0];
    expect(typeof tick).toBe('function');
    act(() => { (tick as () => void)(); });
    expect(reads).toBe(1);
    await act(async () => { resolveWrite(json({ ok: true, id: item.id, staff_called_at: '2026-10-31T10:00:00.000Z' })); });
    expect((await screen.findByRole('button', { name: '取消來電標記' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/有 1 位等候中客人未綁定 LINE/)).toBeNull();
    expect(sessionStorage.getItem(pendingKey)).toBeNull();
    expect(writes).toBe(1);
  });

  it('removes a successful item and its needs-call count', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => options?.method === 'DELETE' ? json({ ok: true }) : listing()));
    const user = userEvent.setup(); render(<AdminWaitlistPage />);
    await user.click(await screen.findByRole('button', { name: '移除' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '移除' }));
    await waitFor(() => expect(screen.queryByText('測試客')).toBeNull());
    expect(screen.queryByText(/有 1 位等候中客人未綁定 LINE/)).toBeNull();
    expect(sessionStorage.getItem(pendingKey)).toBeNull();
  });

  it('keeps an unconfirmed removal locked without resending it', async () => {
    let writes = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'DELETE') { writes++; throw new Error('lost response'); }
      return listing();
    }));
    const user = userEvent.setup(); render(<AdminWaitlistPage />);
    await user.click(await screen.findByRole('button', { name: '移除' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '移除' }));
    expect(await screen.findByText(/原請求仍可能稍後完成/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '移除' }) as HTMLButtonElement).disabled).toBe(true);
    expect(sessionStorage.getItem(pendingKey)).toContain('remove');
    expect(writes).toBe(1);
  });

  it('never applies a refresh started immediately before a successful write', async () => {
    let resolveRefresh!: (response: Response) => void;
    let resolveWrite!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const pendingWrite = new Promise<Response>((resolve) => { resolveWrite = resolve; });
    let reads = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PATCH') return pendingWrite;
      reads++;
      return reads === 1 ? listing() : pendingRefresh;
    }));
    render(<AdminWaitlistPage />);
    const mark = await screen.findByRole('button', { name: '標記已來電' });
    // Model events arriving together before React commits the loading state.
    act(() => {
      screen.getByRole('button', { name: '重新整理' }).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      mark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => { resolveWrite(json({ ok: true, id: item.id, staff_called_at: '2026-10-31T10:00:00.000Z' })); });
    expect(await screen.findByRole('button', { name: '取消來電標記' })).toBeTruthy();
    await act(async () => { resolveRefresh(listing()); });
    expect(screen.getByRole('button', { name: '取消來電標記' })).toBeTruthy();
  });

  it('does not send a write when per-tab storage is unavailable', async () => {
    const request = vi.fn(async () => listing()); vi.stubGlobal('fetch', request);
    const user = userEvent.setup(); render(<AdminWaitlistPage />);
    const button = await screen.findByRole('button', { name: '標記已來電' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    await user.click(button);
    expect(await screen.findByText(/瀏覽器無法保存待核對狀態/)).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
