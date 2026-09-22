const { ActivityLog } = require('../models');

/**
 * Append a single audit entry (FR-080). Failures bubble up so mutations
 * are not silently unaudited.
 */
async function writeActivityLog({
  companyId,
  actorUserId,
  actorRole,
  actionType,
  targetType,
  targetId,
  beforeValue,
  afterValue,
  metadata,
}) {
  await ActivityLog.create({
    company_id: companyId,
    actor_user_id: actorUserId,
    actor_role: actorRole,
    action_type: actionType,
    target_type: targetType,
    target_id: targetId,
    before_value: beforeValue,
    after_value: afterValue,
    metadata,
  });
}

module.exports = { writeActivityLog };
