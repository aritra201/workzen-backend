const express = require('express');
const rateLimit = require('express-rate-limit');
const memberController = require('../controller/member.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAdmin } = require('../helper/companyAdmin.helper');
const { requireActiveMember } = require('../helper/membership.guard');
const { handleMemberProfilePictureUpload } = require('../helper/imageUpload.helper');

const router = express.Router();

const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many invitations — please try again later.' },
});

// FR-024: all member self-service routes require is_active === true on MemberProfile.
const activeMemberMiddleware = [requireAuth, requireActiveMember];

router.get('/me', activeMemberMiddleware, asyncHandler(memberController.getMyProfile));
router.patch('/me', activeMemberMiddleware, asyncHandler(memberController.updateMyProfile));
router.post(
  '/me/profile-picture',
  ...activeMemberMiddleware,
  handleMemberProfilePictureUpload,
  asyncHandler(memberController.uploadMyProfilePicture)
);

router.use(requireAuth, requireCompanyAdmin);

router.get('/', asyncHandler(memberController.list));
router.post('/invitations', inviteLimiter, asyncHandler(memberController.invite));
router.post('/invitations/resend', inviteLimiter, asyncHandler(memberController.resendInvite));
router.patch('/:memberId', asyncHandler(memberController.updateStatus));

module.exports = router;
