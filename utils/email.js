const { Resend } = require("resend");

let resendClient;

function getResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  return resendClient;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });
}

/**
 * Centralized Triple M email sender.
 */
async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo = process.env.SUPPORT_EMAIL,
}) {
  const from = process.env.EMAIL_FROM;

  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  if (!to || !subject || (!html && !text)) {
    throw new Error("Recipient, subject and email content are required");
  }

  const { data, error } = await getResendClient().emails.send({
    from,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    console.error("Resend delivery error:", error);
    throw new Error(`Email delivery failed: ${error.message}`);
  }

  console.log("Triple M email accepted:", data.id);

  return {
    success: true,
    messageId: data.id,
  };
}

/**
 * Password reset email.
 * Existing auth.controller.js remains compatible.
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  const safeUrl = escapeHtml(resetUrl);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>

<body style="margin:0;padding:0;background:#150f19;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background:#150f19;padding:40px 16px;">
    <tr>
      <td align="center">

        <table width="100%"
          style="max-width:520px;background:#221828;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

          <tr>
            <td style="padding:32px 28px 16px;text-align:center;">
              <h1 style="margin:0;font-size:24px;line-height:1.3;color:#ffffff;">
                Reset your password
              </h1>

              <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#a1a1aa;">
                We received a request to reset the password for your Triple M account.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 28px 24px;text-align:center;">
              <a href="${safeUrl}"
                style="display:inline-block;background:#eab54d;color:#241800;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;">
                Reset Password
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:0 28px 24px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#a1a1aa;text-align:center;">
                This link expires in
                <strong style="color:#e4e4e7;">15 minutes</strong>.
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 28px 28px;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;text-align:center;word-break:break-all;">
                Or copy and paste this link into your browser:
                <br />
                <a href="${safeUrl}" style="color:#eab54d;text-decoration:none;">
                  ${safeUrl}
                </a>
              </p>
            </td>
          </tr>

        </table>

        <p style="margin:24px 0 0;font-size:12px;color:#52525b;">
          &copy; ${new Date().getFullYear()} Triple M
        </p>

      </td>
    </tr>
  </table>
</body>
</html>
`;

  const text = `
Reset your Triple M password

We received a request to reset your password.

Reset your password here:
${resetUrl}

This link expires in 15 minutes.

If you didn't request this, you can safely ignore this email.

Triple M
`;

  return sendEmail({
    to,
    subject: "Reset your Triple M password",
    html,
    text,
    replyTo: process.env.SUPPORT_EMAIL,
  });
}

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
};
