// Course enrollment — one-time purchase confirmation email (Confidentist).
// Pure render function — no side effects. Returns { subject, html, text }.
// Used by the Stripe webhook for checkout sessions coming from a course "Buy Now"
// page (identified by a client_reference_id starting "acj-").

export type CourseReceiptData = {
  courseName: string; // e.g. "ACJ Comprehensive Program (6-month)"
  customerEmail: string; // collected by Stripe Checkout
  amountLabel: string; // pre-formatted, e.g. "$3,434.07 CAD"
  reference: string; // Stripe checkout session id, e.g. "cs_live_..."
  customerPhone?: string; // only if Stripe collected one
  hashtag?: string; // defaults to "#Confidentist"
};

const BRAND = "#072C5E";
const GREEN = "#0b8a3b";

export function renderCourseReceipt(data: CourseReceiptData): {
  subject: string;
  html: string;
  text: string;
} {
  const {
    courseName,
    customerEmail,
    amountLabel,
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
            <p style="font-size:16px;line-height:1.55;margin:0 0 6px;font-weight:bold;">Thank you for enrolling in the ${courseName}!</p>
            <p style="font-size:15px;line-height:1.55;margin:0 0 22px;">Your payment has been received. Here is your receipt — our team will be in touch with onboarding and schedule details shortly.</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e9ee;border-radius:8px;">
              <tr><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;color:#5b6b7c;">Program</td><td style="padding:14px 18px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;">${courseName}</td></tr>
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

Your payment for the ${courseName} has been received. Our team will be in touch with onboarding and schedule details shortly.

Program:     ${courseName}
Amount paid: ${amountLabel}

${hashtag}

Confirmation — details on file:
Email: ${customerEmail}
${phoneLineText}Reference: ${reference}

Questions about your enrollment? Just reply to this email.

Confidentist · confidentist.ca`;

  const subject = `Enrollment confirmed — ${courseName}`;

  return { subject, html, text };
}
