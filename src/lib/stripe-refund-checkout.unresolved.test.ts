import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const m=vi.hoisted(()=>({event:null as unknown, ledger:'succeeded', deposit:'paid', paid:true}));
vi.mock('@/lib/stripe',()=>({stripe:{webhooks:{constructEvent:()=>m.event}},isStripeEnabled:()=>true}));
vi.mock('@/lib/ops-log',()=>({logOps:vi.fn()}));
vi.mock('@/lib/payment-log',()=>({logDepositStatusChange:vi.fn()}));
vi.mock('@/lib/payment-notify',()=>({notifyPaymentApproved:vi.fn(async()=>({ok:true}))}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:(name:string)=>({
 update:(patch:{status?:string,deposit_status?:string,is_deposit_paid?:boolean})=>({eq:async()=>{if(name==='payment_intents'&&patch.status)m.ledger=patch.status;if(name==='reservations'&&patch.deposit_status)m.deposit=patch.deposit_status;if(name==='reservations'&&patch.is_deposit_paid!==undefined)m.paid=patch.is_deposit_paid;return {error:null,count:1};}}),
 select:()=>({eq:()=>({single:async()=>({data:{reservation_id:'synthetic'}}),maybeSingle:async()=>({data:name==='payment_intents'?{reservation_id:'synthetic'}:{total_price:400,is_deposit_paid:m.paid,deposit_payment_note:null,deposit_paid_on:null,deposit_last_five:null,status:'confirmed',booking_code:'synthetic'}})})}),
})})}));
import { POST } from '@/app/api/webhooks/stripe/route';
import { computeCheckoutBill } from '@/lib/room-checkout';
const request=()=>new NextRequest('http://localhost/api/webhooks/stripe',{method:'POST',body:'{}'});
it('must not credit an already refunded deposit after a late succeeded event - expected RED',async()=>{
 const bill=()=>computeCheckoutBill({room:{price_weekday:200,price_weekend:200},
   startTime:'2030-01-01T06:00:00Z',endTime:'2030-01-01T08:00:00Z',bookedTotal:400,
   isDepositPaid:m.paid && m.deposit!=='refunded',foodTotal:0});
 m.event={type:'charge.refunded',data:{object:{id:'ch_synthetic',payment_intent:'pi_synthetic'}}};
 expect((await POST(request())).status).toBe(200);
 const refundedDue=bill().due;
 expect(refundedDue).toBe(400);
 m.event={type:'payment_intent.succeeded',data:{object:{id:'pi_synthetic',object:'payment_intent',status:'succeeded',currency:'twd',amount:20000,amount_received:20000,metadata:{reservationId:'synthetic'}}}};
 await POST(request());
 // Mirrors loadBilling's current status-to-credit mapping, then calls the real
 // checkout calculator; the DB settlement RPC itself is not exercised here.
 expect(bill().due).toBe(refundedDue);
});
