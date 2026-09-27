/** True when the employee has submitted at least amount or work comment for a shift. */
function shiftHasEmployeeSubmission(shift) {
  if (!shift) {
    return false;
  }
  if (shift.amount != null && !Number.isNaN(Number(shift.amount))) {
    return true;
  }
  const comment = typeof shift.comment === 'string' ? shift.comment.trim() : '';
  return comment.length > 0;
}

function shiftSubmitPayloadHasValue(amount, comment) {
  const hasAmount =
    amount !== undefined && amount !== null && String(amount).trim() !== '';
  const hasComment = typeof comment === 'string' && comment.trim().length > 0;
  return hasAmount || hasComment;
}

module.exports = {
  shiftHasEmployeeSubmission,
  shiftSubmitPayloadHasValue,
};
