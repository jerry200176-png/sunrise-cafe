import { describe, expect, it, vi } from 'vitest';
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:{message:'synthetic database read failure'}})})})})})}));
vi.mock('@/lib/payment-log',()=>({logDepositStatusChange:()=>{}}));
vi.mock('@/lib/payment-notify',()=>({notifyPaymentApproved:async()=>({ok:true})}));
import { verifyStripeIntentForReservation } from './deposit-paid';
describe('Stripe binding database failure',()=>{
 it('must not accept payment when both binding and amount reads fail',async()=>{
   const result=await verifyStripeIntentForReservation({id:'pi_fixture',object:'payment_intent',status:'succeeded',amount:100,amount_received:100,currency:'twd',metadata:{reservationId:'r_fixture'}},'r_fixture');
   expect(result).toMatchObject({ok:false,status:503});
 });
});
