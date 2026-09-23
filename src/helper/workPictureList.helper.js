const { AppError } = require('../utils/AppError');

function parseWorkPictureUrlList(input, fieldLabel = 'urls') {
  if (input === undefined || input === null || input === '') {
    return [];
  }

  let list = input;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      throw new AppError(`${fieldLabel} must be a JSON array of URL strings`, 400);
    }
  }

  if (!Array.isArray(list)) {
    throw new AppError(`${fieldLabel} must be an array of URL strings`, 400);
  }

  const normalized = list
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return [...new Set(normalized)];
}

module.exports = { parseWorkPictureUrlList };
