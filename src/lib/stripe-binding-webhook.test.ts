import { expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const m=vi.hoisted(()=>({paid:false,deposit:'pending'}));
vi.mock('@/lib/stripe',()=>({stripe:{webhooks:{constructEvent:()=>({type:'payment_intent.succeeded',data:{object:{id:'pi_synthetic',object:'payment_intent',status:'succeeded',currency:'twd',amount:1,amount_received:1,metadata:{reservationId:'synthetic'}}}})}},isStripeEnabled:()=>true}));
vi.mock('@/lib/ops-log',()=>({logOps:vi.fn()}));
vi.mock('@/lib/payment-log',()=>({logDepositStatusChange:vi.fn()}));
vi.mock('@/lib/payment-notify',()=>({notifyPaymentApproved:vi.fn(async()=>({ok:true}))}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:(name:string)=>({
 update:(patch:{deposit_status?:string,is_deposit_paid?:boolean})=>({eq:async()=>{if(name==='reservations'){m.deposit=patch.deposit_status??m.deposit;m.paid=patch.is_deposit_paid??m.paid}return {error:null};}}),
 select:(columns:string)=>({eq:()=>({maybeSingle:async()=>name==='payment_intents'||columns==='total_price'?{data:null,error:{message:'synthetic read failure'}}:{data:{total_price:200,is_deposit_paid:false,deposit_payment_note:null,deposit_paid_on:null,deposit_last_five:null,status:'confirmed',booking_code:'synthetic'},error:null}})}),
})})}));
import { POST } from '@/app/api/webhooks/stripe/route';
it('does not acknowledge or mark paid if binding reads fail',async()=>{
 const res=await POST(new NextRequest('http://localhost/api/webhooks/stripe',{method:'POST',body:'{}'}));
 expect(res.status).toBe(500);expect(m.paid).toBe(false);expect(m.deposit).toBe('pending');
});
