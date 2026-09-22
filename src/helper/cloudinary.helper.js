const cloudinary = require('cloudinary').v2;
const env = require('../config/env');
const { AppError } = require('../utils/AppError');

let configured = false;

function ensureCloudinaryConfig() {
  const { cloudName, apiKey, apiSecret } = env.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError(
      'Image upload is not configured — set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET',
      503
    );
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
    configured = true;
  }
}

/**
 * Uploads an image buffer to Cloudinary and returns the HTTPS URL.
 */
function uploadImageBuffer(buffer, { folder, publicId }) {
  ensureCloudinaryConfig();

  return new Promise((resolve, reject) => {
    const options = {
      folder,
      resource_type: 'image',
      overwrite: true,
    };
    if (publicId) {
      options.public_id = publicId;
    }

    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });

    uploadStream.end(buffer);
  });
}

module.exports = { uploadImageBuffer };
