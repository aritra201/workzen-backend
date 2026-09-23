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

/**
 * Derives Cloudinary public_id from a secure_url returned by our uploader.
 */
function publicIdFromCloudinaryUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const marker = '/image/upload/';
  const markerIndex = url.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  let path = url.slice(markerIndex + marker.length);

  if (/^v\d+\//.test(path)) {
    path = path.replace(/^v\d+\//, '');
  } else {
    // Drop leading transformation segment(s), e.g. c_fill,w_500/
    const segments = path.split('/');
    while (segments.length > 1 && segments[0].includes(',')) {
      segments.shift();
    }
    path = segments.join('/');
  }

  return path.replace(/\.[a-z0-9]+$/i, '') || null;
}

function isCloudinaryUrlForAccount(url, cloudName) {
  if (!url || !cloudName) {
    return false;
  }
  return url.includes(`res.cloudinary.com/${cloudName}/`);
}

/**
 * Deletes an image by public_id. Missing assets are treated as success.
 */
async function deleteImageByPublicId(publicId) {
  ensureCloudinaryConfig();
  const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  return result;
}

/**
 * Deletes images by HTTPS URL (must belong to configured Cloudinary cloud).
 */
async function deleteImagesByUrls(urls) {
  const cloudName = env.cloudinary.cloudName;
  const uniqueUrls = [...new Set(urls.filter(Boolean))];

  for (const url of uniqueUrls) {
    if (!isCloudinaryUrlForAccount(url, cloudName)) {
      throw new AppError('One or more work picture URLs are not valid for this application', 400);
    }
    const publicId = publicIdFromCloudinaryUrl(url);
    if (!publicId) {
      throw new AppError('Could not resolve Cloudinary asset for a work picture URL', 400);
    }
    try {
      await deleteImageByPublicId(publicId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Cloudinary] delete failed for', publicId, err?.message || err);
    }
  }
}

module.exports = {
  uploadImageBuffer,
  publicIdFromCloudinaryUrl,
  isCloudinaryUrlForAccount,
  deleteImageByPublicId,
  deleteImagesByUrls,
};
