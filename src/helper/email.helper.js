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

function sendVerificationEmail({ to, rawToken }) {
  const link = `${env.clientUrl}/verify-email?token=${rawToken}`;
  return sendMail({
    to,
    subject: 'Verify your WorkZen account',
    html: `
      <p>Welcome to WorkZen. Please verify your email to activate your account.</p>
      <p><a href="${link}">Verify my email</a></p>
      <p>This link expires in ${env.tokenExpiry.emailVerificationHours} hours. If you didn't request this, you can ignore this email.</p>
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

function sendPasswordResetEmail({ to, rawToken }) {
  const link = `${env.clientUrl}/reset-password?token=${rawToken}`;
  return sendMail({
    to,
    subject: 'Reset your WorkZen password',
    html: `
      <p>We received a request to reset your WorkZen password.</p>
      <p><a href="${link}">Reset my password</a></p>
      <p>This link expires in ${env.tokenExpiry.passwordResetMinutes} minutes. If you didn't request this, you can ignore this email.</p>
    `,
  });
}

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendMemberInvitationEmail,
};
