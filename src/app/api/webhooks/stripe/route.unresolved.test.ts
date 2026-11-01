import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m = vi.hoisted(() => ({ state: null as string | null, event: null as unknown, dbError: false, markPaid: vi.fn() }));
vi.mock('@/lib/stripe',()=>({stripe:{webhooks:{constructEvent:()=>m.event}},isStripeEnabled:()=>true}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:()=>({select:()=>({eq:()=>({single:async()=>({data:{reservation_id:'r_fixture'},error:null})})}),update:(patch:{status:string})=>({eq:async()=>{
  if (m.dbError) return {error:{message:'synthetic database failure'}};
  if (m.state===null) return {error:null,count:0};
  m.state=patch.status; return {error:null,count:1};
}})})})}));
vi.mock('@/lib/deposit-paid',()=>({markDepositPaid:m.markPaid,verifyStripeIntentForReservation:async()=>({ok:true})}));
vi.mock('@/lib/ops-log',()=>({logOps:()=>{}}));
import { POST } from './route';
const request=()=>new NextRequest('http://localhost/api/webhooks/stripe',{method:'POST',body:'{}'});
beforeEach(()=>{vi.clearAllMocks();m.state=null;m.dbError=false;m.event={type:'payment_intent.succeeded',data:{object:{id:'pi_fixture',metadata:{reservationId:'r_fixture'}}}};m.markPaid.mockResolvedValue({changed:true,notification:null});});
describe('synthetic safety expectations (one remains RED)',()=>{
 it('must not acknowledge and mark paid when ledger matched zero rows',async()=>{
   const response=await POST(request());
   expect(response.status).not.toBe(200);
   expect(m.markPaid).not.toHaveBeenCalled();
 });
 it('must not overwrite a prior refunded state with a late success',async()=>{
   m.state='refunded';
   await POST(request());
   expect(m.state).toBe('refunded');
   expect(m.markPaid).not.toHaveBeenCalled();
 });
 it('must not acknowledge a failed-event ledger DB error',async()=>{
   m.event={type:'payment_intent.payment_failed',data:{object:{id:'pi_fixture'}}};
   m.dbError=true;
   const response=await POST(request());
   expect(response.status).not.toBe(200);
 });
 it('must not acknowledge an expanded refund object without recording the refund',async()=>{
   m.state='succeeded';
   m.event={type:'charge.refunded',data:{object:{id:'ch_fixture',payment_intent:{id:'pi_fixture'}}}};
   const response=await POST(request());
   expect(response.status).not.toBe(200);
 });
 it('must not acknowledge a refund when both local writes return DB errors',async()=>{
   m.event={type:'charge.refunded',data:{object:{id:'ch_fixture',payment_intent:'pi_fixture'}}};
   m.dbError=true;
   const response=await POST(request());
   expect(response.status).not.toBe(200);
 });
});
