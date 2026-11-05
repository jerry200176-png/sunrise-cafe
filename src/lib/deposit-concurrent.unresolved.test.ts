import { describe, expect, it, vi } from 'vitest';
import { markDepositPaid } from './deposit-paid';

describe('unresolved synthetic paid-write safety - expected RED', () => {
  it('must produce one audit when two approvals read the same unpaid snapshot', async () => {
    let entered = 0;
    let release = () => {};
    const bothLoaded = new Promise<void>((resolve) => { release = resolve; });
    const audit = vi.fn();
    const notify = vi.fn().mockResolvedValue({ ok: true });
    const fx = {
      load: async () => {
        entered++;
        if (entered === 2) release();
        await bothLoaded;
        return { is_deposit_paid: false, deposit_payment_note: null, deposit_paid_on: null,
          deposit_last_five: null, status: 'pending', booking_code: 'SYNTHETIC' };
      },
      write: async () => {},
      audit,
      notify,
    };
    await Promise.all([
      markDepositPaid('synthetic', 'stripe_webhook', {}, null, fx),
      markDepositPaid('synthetic', 'stripe_confirm', {}, null, fx),
    ]);
    expect(notify).toHaveBeenCalled(); // invocation only; not evidence of duplicate LINE sends
    expect(audit).toHaveBeenCalledTimes(1);
  });
});
