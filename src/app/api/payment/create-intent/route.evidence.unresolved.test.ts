import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
// These scenarios exercise payment logic after successful guest authorization.
vi.mock("@/lib/guest-auth", () => ({ verifyGuestBookingByTokenOrCredentials: async () => ({ ok: true, reservation: { id: "fixture" } }) }));
vi.mock("@/lib/guest-rate-limit", () => ({ enforceGuestLookupLimit: async () => null }));
const m=vi.hoisted(()=>({create:vi.fn(async()=>({id:'pi_fixture',client_secret:'synthetic-client-secret'}))}));
vi.mock('@/lib/stripe',()=>({isStripeEnabled:()=>true,stripe:{paymentIntents:{create:m.create}}}));
vi.mock('@/lib/constants',()=>({getBranchDepositConfig:()=>({stripeEnabled:true,isDepositRequired:true,defaultDepositAmount:500})}));
vi.mock('@/lib/ops-log',()=>({logOps:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:()=>({
 select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'synthetic',status:'confirmed',is_deposit_paid:false,
   total_price:1000,start_time:'2099-01-01T00:00:00Z',room:{branch_id:'fixture-branch'}},error:null})})}),
 insert:async()=>({error:{message:'synthetic insert failure'}}),
 update:()=>({eq:async()=>({error:null})}),
})})}));
import { POST } from './route';
it('must not return a client secret when the new payment intent was not saved - expected RED',async()=>{
 const res=await POST(new NextRequest('http://localhost/api/payment/create-intent',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({reservationId:'synthetic',branchId:'fixture-branch',amount:500}),
 }));
 expect(res.status).not.toBe(200);
 expect(await res.text()).not.toContain('synthetic-client-secret');
});
