const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not set in the environment');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 10,
  });

  // eslint-disable-next-line no-console
  console.log(`[MongoDB] connected (${mongoose.connection.host})`);

  mongoose.connection.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[MongoDB] connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    // eslint-disable-next-line no-console
    console.warn('[MongoDB] disconnected');
  });

  return mongoose.connection;
}

module.exports = connectDB;
