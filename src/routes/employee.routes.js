const express = require('express');
const rateLimit = require('express-rate-limit');
const employeeController = require('../controller/employee.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAdmin } = require('../helper/companyAdmin.helper');
const { requireActiveEmployee } = require('../helper/membership.guard');
const { handleMemberProfilePictureUpload } = require('../helper/imageUpload.helper');

const router = express.Router();

const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many invitations — please try again later.' },
});

const activeEmployeeMiddleware = [requireAuth, requireActiveEmployee];

router.get('/me', activeEmployeeMiddleware, asyncHandler(employeeController.getMyProfile));
router.patch('/me', activeEmployeeMiddleware, asyncHandler(employeeController.updateMyProfile));
router.post(
  '/me/profile-picture',
  ...activeEmployeeMiddleware,
  handleMemberProfilePictureUpload,
  asyncHandler(employeeController.uploadMyProfilePicture)
);

router.use(requireAuth, requireCompanyAdmin);

router.get('/', asyncHandler(employeeController.list));
router.get('/present', asyncHandler(employeeController.listPresent));
router.post('/invitations', inviteLimiter, asyncHandler(employeeController.invite));
router.post('/invitations/resend', inviteLimiter, asyncHandler(employeeController.resendInvite));
router.patch('/:employeeId', asyncHandler(employeeController.updateStatus));

module.exports = router;
