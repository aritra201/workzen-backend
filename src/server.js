const createApp = require('./app');
const connectDB = require('./config/db');
const env = require('./config/env');
const { startAttendanceLockJob } = require('./jobs/attendanceLock.job');
const { startAttendanceProvisionJob } = require('./jobs/attendanceProvision.job');

async function start() {
  // Fail fast if critical secrets are missing, rather than booting into a
  // broken state that only surfaces on the first login attempt.
  env.required('JWT_ACCESS_SECRET');
  env.required('JWT_REFRESH_SECRET');
  env.required('MONGODB_URI');

  if (env.nodeEnv === 'production') {
    const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
    const allowSmtp = process.env.ALLOW_PRODUCTION_SMTP === 'true';
    const hasSmtp =
      process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASSWORD?.trim();

    if (hasResend) {
      // eslint-disable-next-line no-console
      console.log('Email: Resend API (HTTPS)');
      if (!process.env.MAIL_FROM?.trim()) {
        // eslint-disable-next-line no-console
        console.warn('MAIL_FROM is not set — set it to a verified Resend sender address.');
      }
    } else if (allowSmtp && hasSmtp) {
      // eslint-disable-next-line no-console
      console.log('Email: SMTP (ALLOW_PRODUCTION_SMTP=true)');
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        'Email not configured: invites / forgot-password will fail until you set ' +
          'RESEND_API_KEY + MAIL_FROM on Render (free tier). ' +
          'Or SMTP_* + ALLOW_PRODUCTION_SMTP=true on a paid instance.'
      );
    }
  }

  await connectDB();

  startAttendanceLockJob();
  startAttendanceProvisionJob();

  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`WorkZen backend listening on port ${env.port} [${env.nodeEnv}]`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
