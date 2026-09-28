// AFK Mock Exams — one-time purchase confirmation email (Confidentist).
// Pure render function — no side effects. Returns { subject, html, text }.
// Used by the Stripe webhook for checkout sessions coming from the
// /afk-mock-exams/ page (identified by a client_reference_id starting "mocks-").

export type MockExamReceiptData = {
  customerEmail: string; // collected by Stripe Checkout
  amountLabel: string; // pre-formatted, e.g. "$1,700.00 CAD"
  selectionLabel: string; // e.g. "Full Mock 1, 3, 4 + Mini Mock Pack"
  reference: string; // Stripe checkout session id, e.g. "cs_live_..."
  customerPhone?: string; // only if Stripe collected one
  hashtag?: string; // defaults to "#Confidentist"
};

const BRAND = "#072C5E";
const GREEN = "#0b8a3b";

// Turn a client_reference_id like "mocks-134-mini-1" into a human label.
export function selectionFromRef(ref: string): string {
  const m = /^mocks-([0-9]*)-mini-([01])$/.exec(ref || "");
  if (!m) return "AFK Mock Exams";
  const digits = m[1] === "0" ? "" : m[1];
  const fulls = digits ? digits.split("").filter((d) => d !== "0") : [];
  const parts: string[] = [];
  if (fulls.length) parts.push(`Full Mock ${fulls.join(", ")}`);
  if (m[2] === "1") parts.push("Mini Mock Pack (all 4)");
  return parts.join(" + ") || "AFK Mock Exams";
}

export function renderMockExamReceipt(data: MockExamReceiptData): {
  subject: string;
  html: string;
  text: string;
} {
  const {
    customerEmail,
    amountLabel,
    selectionLabel,
    reference,
    customerPhone,
    hashtag = "#Confidentist",
  } = data;

  const phoneRowHtml = customerPhone
    ? `<tr><td style="padding:12px 18px;border-bottom:1px solid #eef1f5;font-size:14px;color:#5b6b7c;">Telephone</td><td style="padding:12px 18px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;font-weight:bold;">${customerPhone}</td></tr>`
    : "";
  const phoneLineText = customerPhone ? `Telephone: ${customerPhone}\n` : "";

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1a2b3c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e6e9ee;">
        <tr>
          <td style="background:${BRAND};padding:28px 32px;color:#ffffff;">
            <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.8;">Confidentist</div>
            <div style="font-size:24px;font-weight:bold;margin-top:6px;">Enrollment confirmed ✅</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="font-size:16px;line-height:1.55;margin:0 0 6px;font-weight:bold;">Thank you for enrolling in the AFK Mock Exams!</p>
            <p style="font-size:15px;line-height:1.55;margin:0 0 22px;">Your payment has been received. Here is your receipt — session details are sent at least one week before your first exam date.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e9ee;border-radius:8px;">
              <tr><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;color:#5b6b7c;">Your selection</td><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;">${selectionLabel}</td></tr>
              <tr><td style="padding:16px 18px;font-size:16px;font-weight:bold;">Amount paid</td><td style="padding:16px 18px;font-size:16px;font-weight:bold;text-align:right;color:${GREEN};">${amountLabel}</td></tr>
            </table>

            <!-- Hashtag after payment -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;"><tr><td align="center">
              <span style="display:inline-block;font-size:15px;font-weight:bold;color:${BRAND};">${hashtag}</span>
            </td></tr></table>

            <!-- Confirmation: details on file -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border:1px solid #e6e9ee;border-radius:8px;">
              <tr><td colspan="2" style="padding:12px 18px;border-bottom:1px solid #eef1f5;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#5b6b7c;">Confirmation — details on file</td></tr>
              <tr><td style="padding:12px 18px;border-bottom:1px solid #eef1f5;font-size:14px;color:#5b6b7c;">Email</td><td style="padding:12px 18px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;font-weight:bold;">${customerEmail}</td></tr>
              ${phoneRowHtml}
              <tr><td style="padding:12px 18px;font-size:14px;color:#5b6b7c;">Reference</td><td style="padding:12px 18px;font-size:14px;text-align:right;font-weight:bold;">${reference}</td></tr>
            </table>

            <p style="font-size:13px;line-height:1.55;color:#5b6b7c;margin:24px 0 0;">Questions about your enrollment? Just reply to this email.</p>
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

  const text = `Enrollment confirmed — thank you!

Your payment for the AFK Mock Exams has been received. Session details are sent at least one week before your first exam date.

Your selection: ${selectionLabel}
Amount paid:    ${amountLabel}

${hashtag}

Confirmation — details on file:
Email: ${customerEmail}
${phoneLineText}Reference: ${reference}

Questions about your enrollment? Just reply to this email.

Confidentist · confidentist.ca`;

  const subject = `Enrollment confirmed — AFK Mock Exams (${selectionLabel})`;

  return { subject, html, text };
}
