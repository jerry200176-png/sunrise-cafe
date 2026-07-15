# Market parity loop — agent backlog

**Created:** 2026-07-15  
**Compare vs:** inline / TableCheck cancel-protection / TW LINE OA 包廂訂位 / EZTABLE 訂金體驗

## Gap vs market (actionable)

| # | Market standard | Our gap | Loop fix | Status |
|---|-----------------|---------|----------|--------|
| 1 | Deposit deadline exact time on confirm | 話術寫「今日內」與實際 `min(+24h,start)` 不符 | payment-message + Flex | **DONE** |
| 2 | Success page shows pay-by countdown | 成功頁無截止倒數 | /book/success + receipt copy | **DONE** |
| 3 | Waitlist notify only if delivered | 失敗仍標 `notified` | waitlist.ts | **DONE** |
| 4 | Mobile wizard survives refresh | 重整丟步驟 | sessionStorage draft | **DONE** |
| 5 | Self-serve shows payment review state | query 多半只有 is_deposit_paid | query + my-bookings | **DONE** |
| 6 | Waitlist confirm window → next guest | 逾時不自動下一位 | confirm route → notifyWaitlist | **DONE** |
| 7 | Guest Confirm attendance D-1 | 只有提醒無 Confirm CTA | later iteration | OPEN |
| 8 | Policy before submit (editable) | 部分有條款 | later | OPEN |
| 9 | `.ics` calendar link | 無 | later | OPEN |
| 10 | Admin tomorrow board chips | 儀表板已有明日提醒 | polish later | OPEN |

Stop list this loop: LINE Pay native (#99), SMS OTP, Google Reserve, WCAG AA program.
