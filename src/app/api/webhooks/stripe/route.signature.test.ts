import Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('Stripe signature parsing protects payloads', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@/lib/stripe'); vi.doUnmock('@/lib/ops-log'); });

  it('does not log a validly signed malformed payload or parser exception', async () => {
    const secret='synthetic_fixture_only';
    const marker='SYNSECRET';
    const payload=marker; // deliberately not JSON, but signed by the synthetic fixture
    const sdk=new Stripe('synthetic_fixture_only');
    const signature=sdk.webhooks.generateTestHeaderString({payload,secret});
    // The header is valid for this fixture; the SDK reaches its JSON parser.
    expect(()=>sdk.webhooks.constructEvent(payload,signature,secret)).toThrow(SyntaxError);
    const ops=vi.fn();
    const stderr=vi.spyOn(console,'error').mockImplementation(()=>{});
    vi.stubEnv('STRIPE_WEBHOOK_SECRET',secret);
    vi.doMock('@/lib/stripe',()=>({stripe:sdk,isStripeEnabled:()=>true}));
    vi.doMock('@/lib/ops-log',()=>({logOps:ops}));
    const {POST}=await import('./route');
    const response=await POST(new NextRequest('http://localhost/api/webhooks/stripe',{
      method:'POST',headers:{'stripe-signature':signature},body:payload,
    }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(marker);
    expect(JSON.stringify(ops.mock.calls)).not.toContain(marker);
  });
});
