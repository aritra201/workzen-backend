const { parseObjectId } = require('../utils/objectId.helper');

/**
 * Parse employeeId query: single id or comma-separated ids.
 * @returns {import('mongoose').Types.ObjectId[]}
 */
function parseEmployeeIdsFromQuery(employeeIdRaw) {
  if (employeeIdRaw == null || String(employeeIdRaw).trim() === '') {
    return [];
  }
  const parts = String(employeeIdRaw)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((id) => parseObjectId(id, 'employeeId'));
}

module.exports = {
  parseEmployeeIdsFromQuery,
};
