// Installment payment receipt email (Confidentist).
// Pure render function — no side effects, no deps. Returns { subject, html, text }
// ready to hand to Resend (or any transport). The sender reads process.env.confi
// for the Resend API key; from address should be an @confidentist.ca sender
// (the verified Resend domain).

export type NextInstallment = {
  sequence: number; // e.g. 4
  dueDate: Date | string; // due date of the next installment
  amountLabel: string; // pre-formatted, e.g. "$744.45 CAD"
  link: string; // Stripe payment link URL for the next installment
};

export type InstallmentReceiptData = {
  customerName: string;
  course: string; // e.g. "AFK Comprehensive – Feb 2027"
  totalInstallments: number; // e.g. 6
  paidSequence: number; // installment just paid, e.g. 3
  reference: string; // e.g. "Order #58428 · Payment 58428-3"
  amountPaidLabel: string; // pre-formatted, e.g. "$744.45 CAD"
  next?: NextInstallment; // omitted when this was the final installment
  // "today" is injectable so the countdown is testable/deterministic; defaults to now.
  now?: Date;
};

const BRAND = "#0b2a5b";
const GREEN = "#0b8a3b";

function fmtDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Toronto",
  });
}

function daysBetween(from: Date, to: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((b - a) / MS));
}

export function renderInstallmentReceipt(data: InstallmentReceiptData): {
  subject: string;
  html: string;
  text: string;
} {
  const {
    customerName,
    course,
    totalInstallments,
    paidSequence,
    reference,
    amountPaidLabel,
    next,
    now = new Date(),
  } = data;

  const nextBlockHtml = next
    ? `
            <!-- Next payment counter -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;background:#eef4ff;border:1px solid #d6e2ff;border-radius:10px;">
              <tr><td style="padding:22px 24px;text-align:center;">
                <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#5b6b7c;">Your next payment is due in</div>
                <div style="font-size:40px;font-weight:bold;color:${BRAND};line-height:1.1;margin:6px 0 2px;">${daysBetween(
                  now,
                  typeof next.dueDate === "string" ? new Date(next.dueDate) : next.dueDate,
                )} days</div>
                <div style="font-size:15px;color:#1a2b3c;">${fmtDate(next.dueDate)} &nbsp;&middot;&nbsp; Installment ${next.sequence} of ${totalInstallments} &nbsp;&middot;&nbsp; <strong>${next.amountLabel}</strong></div>
              </td></tr>
            </table>

            <!-- Important notice -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:#fff4f4;border:1px solid #f5d2d2;border-radius:8px;">
              <tr><td style="padding:16px 18px;font-size:14px;line-height:1.55;color:#8a2b2b;">
                <strong>Please note:</strong> we do <strong>not</strong> accept preauthorized or automatic payments. On your due date, please use the payment link we provide below to complete your next installment.
              </td></tr>
            </table>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr><td align="center">
              <a href="${next.link}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 34px;border-radius:8px;">Pay next installment (${next.amountLabel})</a>
              <div style="font-size:12px;color:#8a97a6;margin-top:8px;">Please use this link on or after your due date.</div>
            </td></tr></table>`
    : `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;background:#eefcf3;border:1px solid #c7ecd5;border-radius:10px;">
              <tr><td style="padding:20px 24px;text-align:center;font-size:15px;color:${GREEN};font-weight:bold;">
                🎉 This was your final installment — your payment plan is complete. Thank you!
              </td></tr>
            </table>`;

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1a2b3c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e6e9ee;">
        <tr>
          <td style="background:${BRAND};padding:28px 32px;color:#ffffff;">
            <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.8;">Confidentist</div>
            <div style="font-size:24px;font-weight:bold;margin-top:6px;">Payment successful ✅</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="font-size:16px;line-height:1.55;margin:0 0 6px;font-weight:bold;">Thank you for your payment, ${customerName}!</p>
            <p style="font-size:15px;line-height:1.55;margin:0 0 22px;">We've received your installment for <strong>${course}</strong>. Here is your receipt.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e9ee;border-radius:8px;">
              <tr><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;color:#5b6b7c;">Name</td><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;font-weight:bold;">${customerName}</td></tr>
              <tr><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;color:#5b6b7c;">Course</td><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;">${course}</td></tr>
              <tr><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;color:#5b6b7c;">Installment paid</td><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;">${paidSequence} of ${totalInstallments}</td></tr>
              <tr><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;color:#5b6b7c;">Reference</td><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;">${reference}</td></tr>
              <tr><td style="padding:16px 18px;font-size:16px;font-weight:bold;">Amount paid</td><td style="padding:16px 18px;font-size:16px;font-weight:bold;text-align:right;color:${GREEN};">${amountPaidLabel}</td></tr>
            </table>
${nextBlockHtml}
            <p style="font-size:13px;line-height:1.55;color:#5b6b7c;margin:24px 0 0;">Questions about your payment plan? Just reply to this email.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f4f6f8;padding:18px 32px;font-size:12px;color:#8a97a6;text-align:center;">Confidentist &middot; confidentist.ca</td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const nextBlockText = next
    ? `

YOUR NEXT PAYMENT IS DUE IN ${daysBetween(now, typeof next.dueDate === "string" ? new Date(next.dueDate) : next.dueDate)} DAYS
${fmtDate(next.dueDate)} - Installment ${next.sequence} of ${totalInstallments} - ${next.amountLabel}

Please note: we do NOT accept preauthorized or automatic payments. On your due date, please use the payment link below to complete your next installment.

Pay next installment: ${next.link}
(Please use this link on or after your due date.)`
    : `

This was your final installment — your payment plan is complete. Thank you!`;

  const text = `Thank you for your payment, ${customerName}!

We've received your installment for ${course}. Here is your receipt.

Name:             ${customerName}
Course:           ${course}
Installment paid: ${paidSequence} of ${totalInstallments}
Reference:        ${reference}
Amount paid:      ${amountPaidLabel}${nextBlockText}

Questions about your payment plan? Just reply to this email.

Confidentist · confidentist.ca`;

  const subject = next
    ? `Payment received — thank you, ${customerName} (next due ${fmtDate(next.dueDate)})`
    : `Payment received — thank you, ${customerName} (plan complete)`;

  return { subject, html, text };
}
