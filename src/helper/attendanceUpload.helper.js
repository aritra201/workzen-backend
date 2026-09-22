const multer = require('multer');
const { AppError } = require('../utils/AppError');
const env = require('../config/env');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_WORK_PICTURES = 10;

const workPictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxImageBytes },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new AppError('workPicture must be a JPEG, PNG, WebP, or GIF image', 400));
      return;
    }
    cb(null, true);
  },
}).array('workPicture', MAX_WORK_PICTURES);

function handleWorkPictureUpload(req, res, next) {
  workPictureUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            `Image must be ${Math.round(env.upload.maxImageBytes / (1024 * 1024))} MB or smaller`,
            400
          )
        );
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(
          new AppError(
            `Send up to ${MAX_WORK_PICTURES} files under the form field name workPicture`,
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

module.exports = { handleWorkPictureUpload, MAX_WORK_PICTURES };
