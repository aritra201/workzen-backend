const multer = require('multer');
const { AppError } = require('../utils/AppError');
const env = require('../config/env');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const companyProfilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxImageBytes },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new AppError('companyProfilePicture must be a JPEG, PNG, WebP, or GIF image', 400));
      return;
    }
    cb(null, true);
  },
}).single('companyProfilePicture');

/**
 * Wraps multer middleware so Multer errors become AppError responses.
 */
function handleCompanyProfilePictureUpload(req, res, next) {
  companyProfilePictureUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            `Image must be ${Math.round(env.upload.maxImageBytes / (1024 * 1024))} MB or smaller`,
            400
          )
        );
      }
      return next(new AppError(err.message, 400));
    }
    if (err) {
      return next(err);
    }
    return next();
  });
}

const memberProfilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxImageBytes },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new AppError('profilePicture must be a JPEG, PNG, WebP, or GIF image', 400));
      return;
    }
    cb(null, true);
  },
}).single('profilePicture');

function handleMemberProfilePictureUpload(req, res, next) {
  memberProfilePictureUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            `Image must be ${Math.round(env.upload.maxImageBytes / (1024 * 1024))} MB or smaller`,
            400
          )
        );
      }
      return next(new AppError(err.message, 400));
    }
    if (err) {
      return next(err);
    }
    return next();
  });
}

module.exports = { handleCompanyProfilePictureUpload, handleMemberProfilePictureUpload };
