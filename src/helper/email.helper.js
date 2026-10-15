const nodemailer = require('nodemailer');
const env = require('../config/env');
const {
  buildVerificationOtpEmail,
  buildPasswordResetOtpEmail,
  buildMemberInvitationEmail,
  buildEmployeeInvitationEmail,
  buildUnlockRequestSubmittedEmail,
  buildUnlockRequestApprovedEmail,
  buildUnlockRequestDeniedEmail,
} = require('./emailTemplates.helper');

let transporter;

function useResendApi() {
  return Boolean(env.mail.resendApiKey);
}

async function sendMailViaResend({ to, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.mail.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.mail.fromAddress,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.message || body?.error || response.statusText;
    throw new Error(`Resend API failed (${response.status}): ${detail}`);
  }
  return body;
}

function getTransporter() {
  if (!transporter) {
    if (!env.mail.host || !env.mail.user || !env.mail.password) {
      throw new Error(
        'Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASSWORD). ' +
          'Add them to the server environment and redeploy.'
      );
    }
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.port === 465,
      requireTLS: env.mail.port === 587,
      auth: {
        user: env.mail.user,
        pass: env.mail.password,
      },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html }) {
  if (useResendApi()) {
    return sendMailViaResend({ to, subject, html });
  }
  const info = await getTransporter().sendMail({
    from: env.mail.fromAddress,
    to,
    subject,
    html,
  });
  return info;
}

function sendVerificationOtpEmail({ to, otp }) {
  const minutes = env.tokenExpiry.emailVerificationOtpMinutes;
  return sendMail({
    to,
    subject: 'Your WorkZen verification code',
    html: buildVerificationOtpEmail({ otp, minutes }),
  });
}

function mobileInviteUrl(kind, rawToken) {
  const scheme = env.mobileAppScheme;
  return `${scheme}://invite/${kind}?token=${encodeURIComponent(rawToken)}`;
}

function sendMemberInvitationEmail({ to, rawToken, companyName, memberName }) {
  const link = `${env.clientUrl}/invite/member?token=${encodeURIComponent(rawToken)}`;
  const appLink = mobileInviteUrl('member', rawToken);
  return sendMail({
    to,
    subject: `You're invited to view ${companyName} on WorkZen`,
    html: buildMemberInvitationEmail({
      memberName,
      companyName,
      inviteUrl: link,
      appInviteUrl: appLink,
    }),
  });
}

function sendEmployeeInvitationEmail({ to, rawToken, companyName, employeeName }) {
  const link = `${env.clientUrl}/invite/employee?token=${encodeURIComponent(rawToken)}`;
  const appLink = mobileInviteUrl('employee', rawToken);
  return sendMail({
    to,
    subject: `You're invited to join ${companyName} on WorkZen`,
    html: buildEmployeeInvitationEmail({
      employeeName,
      companyName,
      inviteUrl: link,
      appInviteUrl: appLink,
    }),
  });
}

function sendPasswordResetOtpEmail({ to, otp }) {
  const minutes = env.tokenExpiry.passwordResetOtpMinutes;
  return sendMail({
    to,
    subject: 'Your WorkZen password reset code',
    html: buildPasswordResetOtpEmail({ otp, minutes }),
  });
}

function sendUnlockRequestSubmittedEmail({
  to,
  adminName,
  employeeName,
  employeeEmail,
  dateKey,
  companyName,
}) {
  return sendMail({
    to,
    subject: `New unlock request from ${employeeName} for ${dateKey}`,
    html: buildUnlockRequestSubmittedEmail({
      adminName,
      employeeName,
      employeeEmail,
      dateKey,
      companyName,
    }),
  });
}

function sendUnlockRequestApprovedEmail({ to, employeeName, dateKey, decisionNote, expiresAt }) {
  return sendMail({
    to,
    subject: `Unlock request approved for ${dateKey}`,
    html: buildUnlockRequestApprovedEmail({
      employeeName,
      dateKey,
      decisionNote,
      expiresAt,
    }),
  });
}

function sendUnlockRequestDeniedEmail({ to, employeeName, dateKey, decisionNote }) {
  return sendMail({
    to,
    subject: `Unlock request denied for ${dateKey}`,
    html: buildUnlockRequestDeniedEmail({
      employeeName,
      dateKey,
      decisionNote,
    }),
  });
}

module.exports = {
  sendMail,
  sendVerificationOtpEmail,
  sendPasswordResetOtpEmail,
  sendMemberInvitationEmail,
  sendEmployeeInvitationEmail,
  sendUnlockRequestSubmittedEmail,
  sendUnlockRequestApprovedEmail,
  sendUnlockRequestDeniedEmail,
  escapeHtml: require('./emailTemplates.helper').escapeHtml,
};
