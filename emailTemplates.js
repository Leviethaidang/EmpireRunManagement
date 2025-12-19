function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildLicenseEmailHtml(orderCode, licenseKey) {
  const year = new Date().getFullYear();

  return `
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Empire Run - License Key</title>
  </head>
  <body style="margin:0;padding:0;background-color:#7b0000;">
    <div style="max-width:640px;margin:0 auto;padding:24px;font-family:'Segoe UI',Arial,sans-serif;">

      <div style="background:linear-gradient(135deg,#b30000,#ff3300);padding:24px 16px;text-align:center;border-radius:4px 4px 0 0;">
        <h1 style="margin:0 0 12px 0;font-size:18px;text-transform:uppercase;letter-spacing:2px;color:#ffd966;text-align:center;">
          LICENSE KEY ISSUED
        </h1>
        <div style="margin-top:8px;font-size:12px;color:#ffe9b3;letter-spacing:2px;text-transform:uppercase;">
          Workers of the world, unite!
        </div>
      </div>

      <div style="background-color:#1b0f0f;padding:20px 16px;border-radius:0 0 4px 4px;color:#fbead1;">

        <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;text-align:center;">
          Comrade, your payment has been confirmed.<br/>
          Below is your <strong>Empire Run License Key</strong>.
        </p>

        <div style="margin:10px 0 18px 0;font-size:12px;line-height:1.4;color:#e6cbb0;text-align:center;">
          Order Code: <strong style="color:#ffffff;">${escapeHtml(orderCode || "")}</strong>
        </div>

        <div style="margin:20px auto 16px auto;max-width:360px;border:2px solid #ffd966;padding:12px 16px;text-align:center;background-color:#660000;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#ffd966;margin-bottom:6px;">
            Your license key
          </div>
          <div style="font-size:22px;font-weight:900;letter-spacing:3px;color:#ffffff;">
            ${escapeHtml(licenseKey || "")}
          </div>
        </div>

        <p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;text-align:center;">
          How to activate:
        </p>

        <div style="margin:0 auto 14px auto;max-width:520px;font-size:12px;line-height:1.6;color:#fbead1;">
          <ul style="margin:8px 0 0 18px;padding:0;">
            <li>Open the game and go to <strong>Activate Key</strong>.</li>
            <li>Paste the key above and press <strong>Activate</strong>.</li>
            <li>Keep this email for future reference.</li>
          </ul>
        </div>

        <p style="margin:16px 0 0 0;font-size:11px;line-height:1.4;color:#e6cbb0;text-align:center;">
          If you didn't request this purchase, please reply to this email.
        </p>
      </div>

      <div style="margin-top:12px;text-align:center;font-size:10px;color:#f5d6b0;">
        &copy; ${year} Empire Run · All rights reserved.
      </div>

    </div>
  </body>
  </html>`;
}

function buildLicenseEmailText(orderCode, licenseKey) {
  return `Empire Run - License Key

Order Code: ${orderCode || ""}
Your license key: ${licenseKey || ""}

How to activate:
1) Open the game -> Activate Key
2) Paste the key and press Activate

If you didn't request this purchase, please reply to this email.
`;
}

module.exports = {
  buildLicenseEmailHtml,
  buildLicenseEmailText,
};
