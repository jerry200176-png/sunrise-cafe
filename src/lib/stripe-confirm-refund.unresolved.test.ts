import { expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const state=vi.hoisted(()=>({deposit:'refunded',paid:true,ledger:'refunded'}));
vi.mock('@/lib/stripe',()=>({isStripeEnabled:()=>true,stripe:{paymentIntents:{retrieve:async()=>({id:'pi_synthetic',object:'payment_intent',status:'succeeded',currency:'twd',amount:10000,amount_received:10000,metadata:{reservationId:'synthetic'}})}}}));
vi.mock('@/lib/ops-log',()=>({logOps:vi.fn()}));
vi.mock('@/lib/payment-log',()=>({logDepositStatusChange:vi.fn()}));
vi.mock('@/lib/payment-notify',()=>({notifyPaymentApproved:vi.fn(async()=>({ok:true}))}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:(name:string)=>({
 update:(patch:{status?:string,deposit_status?:string,is_deposit_paid?:boolean})=>({eq:async()=>{if(name==='payment_intents'&&patch.status)state.ledger=patch.status;if(name==='reservations'&&patch.deposit_status)state.deposit=patch.deposit_status;if(name==='reservations'&&patch.is_deposit_paid!==undefined)state.paid=patch.is_deposit_paid;return {error:null};}}),
 select:()=>({eq:()=>({single:async()=>({data:{id:"synthetic",total_price:200,is_deposit_paid:state.paid,deposit_status:state.deposit,deposit_payment_note:null,deposit_paid_on:null,deposit_last_five:null,status:"confirmed",booking_code:"synthetic"},error:null}),maybeSingle:async()=>({data:name==='payment_intents'?{reservation_id:'synthetic'}:{id:'synthetic',total_price:200,is_deposit_paid:state.paid,deposit_status:state.deposit,deposit_payment_note:null,deposit_paid_on:null,deposit_last_five:null,status:'confirmed',booking_code:'synthetic'},error:null})})}),
})})}));
import { POST } from '@/app/api/payment/confirm-deposit/route';
it('must not revert a refunded reservation when provider PI remains succeeded - expected RED',async()=>{
 const request=new NextRequest('http://localhost/api/payment/confirm-deposit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reservationId:'synthetic',paymentIntentId:'pi_synthetic'})});
 const res=await POST(request);expect(res.status).not.toBe(200);expect(state.deposit).toBe('refunded');expect(state.ledger).toBe('refunded');
});
