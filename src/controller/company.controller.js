const companyService = require('../service/company.service');

async function getProfile(req, res) {
  const profile = await companyService.getCompanyProfile(req.company);
  res.status(200).json(profile);
}

async function updateProfile(req, res) {
  const profile = await companyService.updateCompanyProfile({
    company: req.company,
    adminUserId: req.user._id,
    body: req.body,
  });
  res.status(200).json(profile);
}

async function uploadProfilePicture(req, res) {
  const profile = await companyService.uploadCompanyProfilePicture({
    company: req.company,
    adminUserId: req.user._id,
    file: req.file,
  });
  res.status(200).json(profile);
}

module.exports = {
  getProfile,
  updateProfile,
  uploadProfilePicture,
};
