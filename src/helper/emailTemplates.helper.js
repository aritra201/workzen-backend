/**
 * WorkZen transactional email layout — aligned with frontend light theme (index.css @theme).
 * Table-based HTML for broad client support; inline styles only.
 */

const BRAND = {
  logoUrl:
    'https://res.cloudinary.com/jrfg8gkx/image/upload/v1790473248/favicon.png',
  name: 'WorkZen',
  tagline: 'Attendance, verification & payroll',
  primary: '#00685f',
  primaryHover: '#005249',
  onPrimary: '#ffffff',
  surface: '#f8f9ff',
  card: '#ffffff',
  containerLow: '#eff4ff',
  text: '#0b1c30',
  textMuted: '#3d4947',
  textSubtle: '#6d7a77',
  border: '#bcc9c6',
  error: '#ba1a1a',
  success: '#00685f',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPrimaryButton(href, label) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
      <tr>
        <td align="center" style="border-radius:8px;background-color:${BRAND.primary};">
          <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
            style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:${BRAND.onPrimary};text-decoration:none;border-radius:8px;">
            ${safeLabel}
          </a>
        </td>
      </tr>
    </table>`;
}

function renderOtpBlock(otp) {
  const safeOtp = escapeHtml(otp);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr>
        <td align="center" style="padding:20px 16px;background-color:${BRAND.containerLow};border:1px solid ${BRAND.border};border-radius:8px;">
          <span style="font-family:'JetBrains Mono',Consolas,Monaco,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:${BRAND.text};">
            ${safeOtp}
          </span>
        </td>
      </tr>
    </table>`;
}

/**
 * @param {object} options
 * @param {string} [options.preheader] - Inbox preview (hidden in body)
 * @param {string} options.title - Headline in card
 * @param {string} options.bodyHtml - Inner HTML (already escaped where needed)
 * @param {{ href: string, label: string }} [options.cta]
 * @param {string} [options.footerNote]
 */
function renderEmailLayout({ preheader, title, bodyHtml, cta, footerNote }) {
  const safeTitle = escapeHtml(title);
  const preheaderText = escapeHtml(preheader || title);
  const ctaHtml = cta ? renderPrimaryButton(cta.href, cta.label) : '';
  const footerExtra = footerNote
    ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${BRAND.textMuted};">${footerNote}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${safeTitle}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BRAND.surface};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheaderText}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.surface};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <img src="${BRAND.logoUrl}" width="40" height="40" alt="${escapeHtml(BRAND.name)}" style="display:block;border:0;border-radius:8px;" />
              <p style="margin:12px 0 0;font-size:18px;font-weight:700;color:${BRAND.text};letter-spacing:-0.02em;">${escapeHtml(BRAND.name)}</p>
              <p style="margin:4px 0 0;font-size:12px;color:${BRAND.textSubtle};">${escapeHtml(BRAND.tagline)}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;padding:32px 28px;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;line-height:1.3;color:${BRAND.text};">${safeTitle}</h1>
              <div style="font-size:15px;line-height:1.6;color:${BRAND.textMuted};">
                ${bodyHtml}
              </div>
              ${ctaHtml}
              ${footerExtra}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 8px 0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.textSubtle};">
                You received this email because of activity on your ${escapeHtml(BRAND.name)} account.<br />
                If you did not expect it, you can safely ignore this message.
              </p>
              <p style="margin:12px 0 0;font-size:11px;color:${BRAND.textSubtle};">&copy; ${new Date().getFullYear()} ${escapeHtml(BRAND.name)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 16px;">${text}</p>`;
}

function buildVerificationOtpEmail({ otp, minutes }) {
  return renderEmailLayout({
    preheader: `Your verification code is ${otp}`,
    title: 'Verify your email',
    bodyHtml: `
      ${paragraph('Welcome to WorkZen. Enter this code on the verification screen to activate your account:')}
      ${renderOtpBlock(otp)}
      ${paragraph(`This code expires in <strong>${escapeHtml(String(minutes))} minutes</strong>.`)}
    `,
  });
}

function buildPasswordResetOtpEmail({ otp, minutes }) {
  return renderEmailLayout({
    preheader: `Password reset code: ${otp}`,
    title: 'Reset your password',
    bodyHtml: `
      ${paragraph('We received a request to reset your WorkZen password. Enter this code in the app:')}
      ${renderOtpBlock(otp)}
      ${paragraph(`This code expires in <strong>${escapeHtml(String(minutes))} minutes</strong>. If you did not request a reset, you can ignore this email.`)}
    `,
  });
}

function webInviteFallback(inviteUrl) {
  const safe = escapeHtml(inviteUrl);
  return paragraph(
    `On a computer or without the app, <a href="${safe}" style="color:${BRAND.primary};">accept in your browser</a>.`
  );
}

function buildMemberInvitationEmail({ memberName, companyName, inviteUrl, appInviteUrl }) {
  const greeting = memberName
    ? paragraph(`Hello <strong>${escapeHtml(memberName)}</strong>,`)
    : '';
  return renderEmailLayout({
    preheader: `Join ${companyName} on WorkZen as a member`,
    title: 'Member invitation',
    bodyHtml: `
      ${greeting}
      ${paragraph(`You have been invited to join <strong>${escapeHtml(companyName)}</strong> on WorkZen as a <strong>view-only member</strong>. You can review attendance and payroll for the company.`)}
      ${webInviteFallback(inviteUrl)}
    `,
    cta: appInviteUrl
      ? { href: appInviteUrl, label: 'Accept invitation' }
      : { href: inviteUrl, label: 'Accept invitation' },
    footerNote: 'This link expires in 72 hours.',
  });
}

function buildEmployeeInvitationEmail({ employeeName, companyName, inviteUrl, appInviteUrl }) {
  return renderEmailLayout({
    preheader: `Join ${companyName} on WorkZen`,
    title: 'Employee invitation',
    bodyHtml: `
      ${paragraph(`Hello <strong>${escapeHtml(employeeName)}</strong>,`)}
      ${paragraph(`You have been invited to join <strong>${escapeHtml(companyName)}</strong> on WorkZen as an employee. Accept the invitation to mark attendance and manage your profile.`)}
      ${webInviteFallback(inviteUrl)}
    `,
    cta: appInviteUrl
      ? { href: appInviteUrl, label: 'Accept invitation' }
      : { href: inviteUrl, label: 'Accept invitation' },
    footerNote: 'This link expires in 72 hours.',
  });
}

function buildUnlockRequestSubmittedEmail({
  adminName,
  employeeName,
  employeeEmail,
  dateKey,
  companyName,
}) {
  return renderEmailLayout({
    preheader: `Unlock request from ${employeeName} for ${dateKey}`,
    title: 'New unlock request',
    bodyHtml: `
      ${paragraph(`Hello <strong>${escapeHtml(adminName || 'Admin')}</strong>,`)}
      ${paragraph(`<strong>${escapeHtml(employeeName)}</strong> (${escapeHtml(employeeEmail)}) submitted an unlock request for attendance on <strong>${escapeHtml(dateKey)}</strong> at <strong>${escapeHtml(companyName || 'your company')}</strong>.`)}
      ${paragraph('Open WorkZen to approve or deny this request from the Unlock Requests screen.')}
    `,
  });
}

function buildUnlockRequestApprovedEmail({ employeeName, dateKey, decisionNote, expiresAt }) {
  const expiresLabel = expiresAt
    ? escapeHtml(new Date(expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))
    : '';
  const noteBlock = decisionNote
    ? paragraph(`<strong>Admin note:</strong> ${escapeHtml(decisionNote)}`)
    : '';
  return renderEmailLayout({
    preheader: `Your unlock request for ${dateKey} was approved`,
    title: 'Unlock request approved',
    bodyHtml: `
      ${paragraph(`Hello <strong>${escapeHtml(employeeName)}</strong>,`)}
      ${paragraph(`Your unlock request for <strong>${escapeHtml(dateKey)}</strong> was approved. You can now mark attendance for that date in the app.`)}
      ${expiresLabel ? paragraph(`This unlock window expires at <strong>${expiresLabel}</strong> (company timezone).`) : ''}
      ${noteBlock}
    `,
  });
}

function buildUnlockRequestDeniedEmail({ employeeName, dateKey, decisionNote }) {
  const noteBlock = decisionNote
    ? paragraph(`<strong>Admin response:</strong> ${escapeHtml(decisionNote)}`)
    : paragraph('No additional note was provided.');
  return renderEmailLayout({
    preheader: `Unlock request for ${dateKey} was denied`,
    title: 'Unlock request denied',
    bodyHtml: `
      ${paragraph(`Hello <strong>${escapeHtml(employeeName)}</strong>,`)}
      ${paragraph(`Your unlock request for <strong>${escapeHtml(dateKey)}</strong> was denied. That date remains locked for direct attendance entry unless you submit a new request.`)}
      ${noteBlock}
    `,
  });
}

module.exports = {
  escapeHtml,
  buildVerificationOtpEmail,
  buildPasswordResetOtpEmail,
  buildMemberInvitationEmail,
  buildEmployeeInvitationEmail,
  buildUnlockRequestSubmittedEmail,
  buildUnlockRequestApprovedEmail,
  buildUnlockRequestDeniedEmail,
};
