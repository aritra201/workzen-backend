const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.port === 465,
      auth: {
        user: env.mail.user,
        pass: env.mail.password,
      },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const info = await getTransporter().sendMail({
    from: env.mail.fromAddress,
    to,
    subject,
    html,
  });
  return info;
}

function sendVerificationOtpEmail({ to, otp }) {
  const safeOtp = escapeHtml(otp);
  const minutes = env.tokenExpiry.emailVerificationOtpMinutes;
  return sendMail({
    to,
    subject: 'Your WorkZen verification code',
    html: `
      <p>Welcome to WorkZen. Enter this code on the verification screen to activate your account:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${safeOtp}</p>
      <p>This code expires in ${minutes} minutes. If you didn't create an account, you can ignore this email.</p>
    `,
  });
}

function sendMemberInvitationEmail({ to, rawToken, companyName }) {
  const link = `${env.clientUrl}/accept-member-invite?token=${rawToken}`;
  return sendMail({
    to,
    subject: `You're invited to view ${companyName} on WorkZen`,
    html: `
      <p>You have been invited to join <strong>${companyName}</strong> on WorkZen as a view-only member.</p>
      <p><a href="${link}">Accept invitation</a></p>
      <p>This link expires in 72 hours. If you did not expect this email, you can ignore it.</p>
    `,
  });
}

function sendEmployeeInvitationEmail({ to, rawToken, companyName, employeeName }) {
  const link = `${env.clientUrl}/accept-employee-invite?token=${rawToken}`;
  return sendMail({
    to,
    subject: `You're invited to join ${companyName} on WorkZen`,
    html: `
      <p>Hello ${employeeName},</p>
      <p>You have been invited to join <strong>${companyName}</strong> on WorkZen as an employee.</p>
      <p><a href="${link}">Accept invitation and set up your account</a></p>
      <p>This link expires in 72 hours. If you did not expect this email, you can ignore it.</p>
    `,
  });
}

function sendPasswordResetOtpEmail({ to, otp }) {
  const safeOtp = escapeHtml(otp);
  const minutes = env.tokenExpiry.passwordResetOtpMinutes;
  return sendMail({
    to,
    subject: 'Your WorkZen password reset code',
    html: `
      <p>We received a request to reset your WorkZen password. Enter this code in the app:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${safeOtp}</p>
      <p>This code expires in ${minutes} minutes. If you didn't request this, you can ignore this email.</p>
    `,
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
    html: `
      <p>Hello ${escapeHtml(adminName || 'Admin')},</p>
      <p><strong>${escapeHtml(employeeName)}</strong> (${escapeHtml(employeeEmail)}) submitted an unlock request for attendance on <strong>${escapeHtml(dateKey)}</strong> at ${escapeHtml(companyName || 'your company')}.</p>
      <p>Open WorkZen to approve or deny this request.</p>
    `,
  });
}

function sendUnlockRequestApprovedEmail({ to, employeeName, dateKey, decisionNote, expiresAt }) {
  const noteBlock = decisionNote
    ? `<p><strong>Admin note:</strong> ${escapeHtml(decisionNote)}</p>`
    : '';
  return sendMail({
    to,
    subject: `Unlock request approved for ${dateKey}`,
    html: `
      <p>Hello ${escapeHtml(employeeName)},</p>
      <p>Your unlock request for <strong>${escapeHtml(dateKey)}</strong> was approved. You can now mark attendance for that date.</p>
      <p>This window expires at ${escapeHtml(new Date(expiresAt).toISOString())}.</p>
      ${noteBlock}
    `,
  });
}

function sendUnlockRequestDeniedEmail({ to, employeeName, dateKey, decisionNote }) {
  const noteBlock = decisionNote
    ? `<p><strong>Admin response:</strong> ${escapeHtml(decisionNote)}</p>`
    : '<p>No additional note was provided.</p>';
  return sendMail({
    to,
    subject: `Unlock request denied for ${dateKey}`,
    html: `
      <p>Hello ${escapeHtml(employeeName)},</p>
      <p>Your unlock request for <strong>${escapeHtml(dateKey)}</strong> was denied. That date remains blocked for direct attendance entry.</p>
      ${noteBlock}
    `,
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
};
