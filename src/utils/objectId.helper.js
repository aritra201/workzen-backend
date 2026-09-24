const mongoose = require('mongoose');
const { AppError } = require('./AppError');

function parseObjectId(value, fieldName = 'id') {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new AppError(`Invalid ${fieldName}`, 400);
  }
  return String(value);
}

module.exports = { parseObjectId };
