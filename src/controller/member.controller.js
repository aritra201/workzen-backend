const memberService = require('../service/member.service');
const { AppError } = require('../utils/AppError');

async function list(req, res) {
  const members = await memberService.listMembers(req.company._id);
  res.status(200).json({ members });
}

async function invite(req, res) {
  const { email } = req.body;
  if (!email) {
    throw new AppError('email is required', 400);
  }

  const result = await memberService.inviteMember({
    company: req.company,
    adminUserId: req.user._id,
    email,
  });

  res.status(201).json({
    message: 'Member invitation sent',
    ...result,
  });
}

async function resendInvite(req, res) {
  const { email } = req.body;
  if (!email) {
    throw new AppError('email is required', 400);
  }

  const result = await memberService.resendMemberInvitation({
    company: req.company,
    adminUserId: req.user._id,
    email,
  });

  res.status(200).json({
    message: 'Member invitation resent',
    ...result,
  });
}

async function updateStatus(req, res) {
  const { isActive } = req.body;
  const member = await memberService.setMemberActive({
    company: req.company,
    adminUserId: req.user._id,
    memberId: req.params.memberId,
    isActive,
  });

  res.status(200).json(member);
}

module.exports = {
  list,
  invite,
  resendInvite,
  updateStatus,
};
