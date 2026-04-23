import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendBookingConfirmation(opts: {
  to: string;
  customerName: string;
  bookingCode: string;
  roomName: string;
  dateLabel: string;
  startLabel: string;
  endLabel: string;
  totalPrice: number | null;
}): Promise<void> {
  const { to, customerName, bookingCode, roomName, dateLabel, startLabel, endLabel, totalPrice } = opts;
  const deposit = totalPrice ? Math.ceil(totalPrice * 0.5) : null;

  const priceSection = totalPrice
    ? `<p>💰 <strong>總金額：</strong>NT$${totalPrice}</p>
       <p>💳 <strong>訂金（50%）：</strong>NT$${deposit}</p>`
    : "";

  await resend.emails.send({
    from: process.env.RESEND_FROM ?? "昇咖啡 <onboarding@resend.dev>",
    to,
    subject: `昇咖啡包廂訂位確認 — 訂位代號 ${bookingCode}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#333">
        <h2 style="color:#b45309">您的包廂預約已成功 🎉</h2>
        <p>您好，${customerName}！</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
        <p>📋 <strong>訂位代號：</strong>${bookingCode}</p>
        <p>🏠 <strong>包廂：</strong>${roomName}</p>
        <p>📅 <strong>日期：</strong>${dateLabel}</p>
        <p>⏰ <strong>時段：</strong>${startLabel} ～ ${endLabel}</p>
        ${priceSection}
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
        <p style="color:#888;font-size:13px">如需更改或取消，請來電洽詢。謝謝！</p>
        <p style="color:#888;font-size:13px">— 昇咖啡</p>
      </div>
    `,
  });
}
