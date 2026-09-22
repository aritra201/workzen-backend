const createApp = require('./app');
const connectDB = require('./config/db');
const env = require('./config/env');

async function start() {
  // Fail fast if critical secrets are missing, rather than booting into a
  // broken state that only surfaces on the first login attempt.
  env.required('JWT_ACCESS_SECRET');
  env.required('JWT_REFRESH_SECRET');
  env.required('MONGODB_URI');

  await connectDB();

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
