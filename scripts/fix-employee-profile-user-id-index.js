/**
 * Fixes E11000 duplicate key on employeeprofiles.user_id when inviting multiple employees.
 *
 * Cause: an old non-sparse unique index on user_id treats every null/missing user_id as one key.
 * Fix: drop user_id_1 and recreate as unique + sparse (matches EmployeeProfile schema).
 *
 * Usage: node scripts/fix-employee-profile-user-id-index.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

const COLLECTION = 'employeeprofiles';
const INDEX_NAME = 'user_id_1';

async function main() {
  await connectDB();
  const collection = mongoose.connection.collection(COLLECTION);

  const indexes = await collection.indexes();
  const userIdIndex = indexes.find((idx) => idx.name === INDEX_NAME);

  if (userIdIndex) {
    const isSparse = Boolean(userIdIndex.sparse);
    const isUnique = Boolean(userIdIndex.unique);
    if (isSparse && isUnique && Object.keys(userIdIndex.key).join() === 'user_id') {
      console.log(`[OK] ${INDEX_NAME} is already unique + sparse — no change needed.`);
      await mongoose.disconnect();
      return;
    }
    console.log(`[drop] ${INDEX_NAME}:`, JSON.stringify(userIdIndex));
    await collection.dropIndex(INDEX_NAME);
  } else {
    console.log(`[skip] ${INDEX_NAME} not found (will create sparse unique index).`);
  }

  const result = await collection.createIndex(
    { user_id: 1 },
    { unique: true, sparse: true, name: INDEX_NAME }
  );
  console.log('[create]', result);

  const after = await collection.indexes();
  const fixed = after.find((idx) => idx.name === INDEX_NAME);
  console.log('[verify]', JSON.stringify(fixed));

  const nullCount = await collection.countDocuments({
    $or: [{ user_id: null }, { user_id: { $exists: false } }],
  });
  console.log(`[info] employee profiles without user_id: ${nullCount}`);

  await mongoose.disconnect();
  console.log('[done]');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
