const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true, // true for 465
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_PASSWORD,
  },
});

/**
 * Send password reset email
 */
async function sendPasswordResetEmail({ to, resetUrl }) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#150f19;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#150f19;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#221828;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
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
              <a href="${resetUrl}"
                 style="display:inline-block;background:#eab54d;color:#241800;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;">
                Reset Password
              </a>
            </td>
          </tr>

          <tr>
            <td style="padding:0 28px 24px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#a1a1aa;text-align:center;">
                This link will expire in <strong style="color:#e4e4e7;">15 minutes</strong>.
                If you didn’t request this, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 28px 28px;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;text-align:center;word-break:break-all;">
                Or copy and paste this link into your browser:<br/>
                <a href="${resetUrl}" style="color:#eab54d;text-decoration:none;">${resetUrl}</a>
              </p>
            </td>
          </tr>
        </table>

        <p style="margin:24px 0 0;font-size:12px;color:#52525b;">
          © ${new Date().getFullYear()} Triple M
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  await transporter.sendMail({
    from: `"Triple M" <${process.env.ZOHO_EMAIL}>`,
    to,
    subject: "Reset your Triple M password",
    html,
  });
}

module.exports = { sendPasswordResetEmail };