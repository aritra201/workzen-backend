const express = require('express');
const companyController = require('../controller/company.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../helper/authGuard.helper');
const { requireCompanyAdmin } = require('../helper/companyAdmin.helper');
const { forbidActiveMemberWriteAccess } = require('../helper/membership.guard');
const { handleCompanyProfilePictureUpload } = require('../helper/imageUpload.helper');

const router = express.Router();

router.use(requireAuth, forbidActiveMemberWriteAccess, requireCompanyAdmin);

router.get('/', asyncHandler(companyController.getProfile));
router.patch('/', asyncHandler(companyController.updateProfile));
router.post(
  '/profile-picture',
  handleCompanyProfilePictureUpload,
  asyncHandler(companyController.uploadProfilePicture)
);

module.exports = router;
