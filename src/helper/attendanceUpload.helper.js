const path = require('path');
const is = require('type-is');
const multer = require('multer');
const { AppError } = require('../utils/AppError');
const env = require('../config/env');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXTENSION_TO_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const MAX_WORK_PICTURES = 10;

function normalizeWorkPictureFieldName(fieldname) {
  if (!fieldname) return '';
  return String(fieldname).replace(/\[\]$/, '');
}

function isAllowedWorkPictureField(fieldname) {
  const base = normalizeWorkPictureFieldName(fieldname);
  return base === 'workPicture' || base === 'workPictures' || base === 'work_picture';
}

function isAllowedImageFile(file) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return true;
  }
  const ext = path.extname(file.originalname || '').toLowerCase();
  const inferred = EXTENSION_TO_MIME[ext];
  return Boolean(inferred && ALLOWED_MIME_TYPES.has(inferred));
}

const workPictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxImageBytes, files: MAX_WORK_PICTURES },
  fileFilter(req, file, cb) {
    if (!isAllowedWorkPictureField(file.fieldname)) {
      cb(
        new AppError(
          `Unexpected file field "${file.fieldname}". Use form field name workPicture (repeat for multiple files)`,
          400
        )
      );
      return;
    }
    if (!isAllowedImageFile(file)) {
      cb(new AppError('workPicture must be a JPEG, PNG, WebP, or GIF image', 400));
      return;
    }
    cb(null, true);
  },
}).any();

function handleWorkPictureUpload(req, res, next) {
  if (!is(req, ['multipart'])) {
    return next(
      new AppError(
        'Work picture upload requires multipart/form-data with one or more files in field workPicture',
        400
      )
    );
  }

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
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(
          new AppError(
            `Send up to ${MAX_WORK_PICTURES} image files under the form field name workPicture`,
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

/** Normalize multer output (array, fields object, or single file). */
function collectWorkPictureFiles(req) {
  const files = [];

  const push = (file) => {
    if (file?.buffer && isAllowedWorkPictureField(file.fieldname)) {
      files.push(file);
    }
  };

  if (Array.isArray(req.files)) {
    req.files.forEach(push);
  } else if (req.files && typeof req.files === 'object') {
    for (const [fieldname, group] of Object.entries(req.files)) {
      if (!isAllowedWorkPictureField(fieldname)) {
        continue;
      }
      if (Array.isArray(group)) {
        group.forEach(push);
      } else {
        push(group);
      }
    }
  }

  if (req.file) {
    push(req.file);
  }

  return files;
}

module.exports = {
  handleWorkPictureUpload,
  collectWorkPictureFiles,
  MAX_WORK_PICTURES,
};
