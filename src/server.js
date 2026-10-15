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

    if (!hasResend && !(allowSmtp && hasSmtp)) {
      throw new Error(
        'Production email: set RESEND_API_KEY + MAIL_FROM (required on Render free tier). ' +
          'Paid Render + Gmail SMTP: set SMTP_* and ALLOW_PRODUCTION_SMTP=true.'
      );
    }
    if (hasResend) {
      // eslint-disable-next-line no-console
      console.log('Email: Resend API (HTTPS)');
    } else {
      // eslint-disable-next-line no-console
      console.log('Email: SMTP (ALLOW_PRODUCTION_SMTP=true)');
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
