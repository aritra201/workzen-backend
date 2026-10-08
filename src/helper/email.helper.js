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
  const minutes = env.tokenExpiry.emailVerificationOtpMinutes;
  return sendMail({
    to,
    subject: 'Your WorkZen verification code',
    html: buildVerificationOtpEmail({ otp, minutes }),
  });
}

function sendMemberInvitationEmail({ to, rawToken, companyName, memberName }) {
  const link = `${env.clientUrl}/invite/member?token=${encodeURIComponent(rawToken)}`;
  return sendMail({
    to,
    subject: `You're invited to view ${companyName} on WorkZen`,
    html: buildMemberInvitationEmail({
      memberName,
      companyName,
      inviteUrl: link,
    }),
  });
}

function sendEmployeeInvitationEmail({ to, rawToken, companyName, employeeName }) {
  const link = `${env.clientUrl}/invite/employee?token=${encodeURIComponent(rawToken)}`;
  return sendMail({
    to,
    subject: `You're invited to join ${companyName} on WorkZen`,
    html: buildEmployeeInvitationEmail({
      employeeName,
      companyName,
      inviteUrl: link,
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
