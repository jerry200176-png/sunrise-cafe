import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m=vi.hoisted(()=>({branch:'daan', create:vi.fn()}));
vi.mock('@/lib/stripe',()=>({isStripeEnabled:()=>true,stripe:{paymentIntents:{create:m.create}}}));
vi.mock('@/lib/ops-log',()=>({logOps:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({
  data:{id:'synthetic',status:'confirmed',is_deposit_paid:false,total_price:1000,
    start_time:'2099-01-01T00:00:00Z',room:{branch_id:m.branch}},error:null,
})})})})})}));
import { POST } from './route';
const request=(branchId:string)=>new NextRequest('http://localhost/api/payment/create-intent',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({reservationId:'synthetic',branchId,amount:500}),
});
beforeEach(()=>{vi.clearAllMocks();m.branch='daan';});
describe('Stripe creation with the real branch configuration',()=>{
  it('does not call Stripe when the actual daan flag is disabled',async()=>{
    expect((await POST(request('daan'))).status).toBe(503);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('does not enable an unknown UUID branch through a caller-supplied slug',async()=>{
    m.branch='00000000-0000-4000-8000-000000000111';
    expect((await POST(request('daan'))).status).toBe(403);
    expect(m.create).not.toHaveBeenCalled();
  });
  it('fails closed when the actual UUID has no explicit enabled configuration',async()=>{
    m.branch='00000000-0000-4000-8000-000000000111';
    expect((await POST(request(m.branch))).status).toBe(503);
    expect(m.create).not.toHaveBeenCalled();
  });
});
