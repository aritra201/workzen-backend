const { Company } = require('../models');
const { CURRENCY, COMPANY_ROLE } = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { resolveCompanyTimezone } = require('../utils/timezone.helper');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { uploadImageBuffer } = require('../helper/cloudinary.helper');

const PROFILE_FIELDS = [
  'company_name',
  'company_profile_picture',
  'owner_name',
  'country_code',
  'personal_email_id',
  'phone_number',
  'country',
  'state',
  'pin_code',
  'full_address',
  'timezone',
];

const API_TO_DB = {
  companyName: 'company_name',
  ownerName: 'owner_name',
  countryCode: 'country_code',
  personalEmailId: 'personal_email_id',
  phoneNumber: 'phone_number',
  country: 'country',
  state: 'state',
  pinCode: 'pin_code',
  fullAddress: 'full_address',
  timezone: 'timezone',
};

function serializeCompany(company) {
  const doc = company.toObject ? company.toObject() : company;
  const payload = {
    id: doc._id,
    companyName: doc.company_name,
    companyProfilePicture: doc.company_profile_picture ?? null,
    ownerName: doc.owner_name ?? null,
    countryCode: doc.country_code ?? null,
    personalEmailId: doc.personal_email_id ?? null,
    phoneNumber: doc.phone_number ?? null,
    country: doc.country ?? null,
    state: doc.state ?? null,
    pinCode: doc.pin_code ?? null,
    fullAddress: doc.full_address ?? null,
    timezone: doc.timezone,
    currency: doc.currency,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
  return payload;
}

function pickProfileSnapshot(company) {
  const snap = {};
  for (const field of PROFILE_FIELDS) {
    snap[field] = company[field] ?? null;
  }
  snap.currency = company.currency;
  return snap;
}

function buildUpdatesFromBody(body) {
  const updates = {};

  for (const [apiKey, dbKey] of Object.entries(API_TO_DB)) {
    if (Object.prototype.hasOwnProperty.call(body, apiKey)) {
      updates[dbKey] = body[apiKey];
    }
  }

  return updates;
}

async function logProfileChanges({ company, adminUserId, before, after }) {
  const beforeChanges = {};
  const afterChanges = {};
  for (const field of PROFILE_FIELDS) {
    if (before[field] !== after[field]) {
      beforeChanges[field] = before[field];
      afterChanges[field] = after[field];
    }
  }

  if (Object.keys(afterChanges).length === 0) {
    return;
  }

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType: 'company.profile_updated',
    targetType: 'Company',
    targetId: company._id,
    beforeValue: beforeChanges,
    afterValue: afterChanges,
  });
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * FR-010/011/012: admin views the company profile (includes read-only currency).
 */
async function getCompanyProfile(company) {
  return serializeCompany(company);
}

/**
 * FR-010: optional profile fields; FR-011 timezone; FR-012 currency not editable.
 * Also allows setting company_name (FR-005) for Google onboarding.
 */
async function updateCompanyProfile({ company, adminUserId, body }) {
  if (body.currency !== undefined) {
    throw new AppError('Currency cannot be changed in v1', 400);
  }
  if (body.companyProfilePicture !== undefined) {
    throw new AppError(
      'Use POST /api/company/profile-picture with multipart form-data (field: companyProfilePicture)',
      400
    );
  }

  const updates = buildUpdatesFromBody(body);
  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  if (updates.company_name !== undefined) {
    const name = normalizeOptionalString(updates.company_name);
    if (!name) {
      throw new AppError('companyName cannot be empty', 400);
    }
    updates.company_name = name;
  }

  const optionalStringFields = [
    'owner_name',
    'country_code',
    'personal_email_id',
    'phone_number',
    'country',
    'state',
    'pin_code',
    'full_address',
  ];

  for (const field of optionalStringFields) {
    if (updates[field] !== undefined) {
      updates[field] = normalizeOptionalString(updates[field]);
    }
  }

  if (updates.personal_email_id) {
    const emailPattern = /^\S+@\S+\.\S+$/;
    if (!emailPattern.test(updates.personal_email_id)) {
      throw new AppError('personalEmailId must be a valid email', 400);
    }
  }

  const explicitTimezone = Object.prototype.hasOwnProperty.call(body, 'timezone')
    ? body.timezone
    : undefined;

  const countryForTimezone =
    updates.country !== undefined ? updates.country : company.country;

  updates.timezone = resolveCompanyTimezone({
    explicitTimezone,
    country: countryForTimezone,
    currentTimezone: company.timezone,
  });

  const before = pickProfileSnapshot(company);

  for (const [key, value] of Object.entries(updates)) {
    company[key] = value;
  }

  if (company.currency !== CURRENCY.INR) {
    company.currency = CURRENCY.INR;
  }

  await company.save();

  const after = pickProfileSnapshot(company);
  await logProfileChanges({ company, adminUserId, before, after });

  return serializeCompany(company);
}

/**
 * Upload company logo/profile image via multipart form-data → Cloudinary URL (FR-010).
 */
async function uploadCompanyProfilePicture({ company, adminUserId, file }) {
  if (!file || !file.buffer) {
    throw new AppError('companyProfilePicture file is required', 400);
  }

  const before = pickProfileSnapshot(company);

  const folder = `workzen/companies/${company._id.toString()}/profile`;
  const publicId = 'company_profile_picture';

  let uploadResult;
  try {
    uploadResult = await uploadImageBuffer(file.buffer, { folder, publicId });
  } catch (err) {
    throw new AppError('Failed to upload image — try again later', 502);
  }

  company.company_profile_picture = uploadResult.secure_url;
  await company.save();

  const after = pickProfileSnapshot(company);
  await logProfileChanges({ company, adminUserId, before, after });

  return serializeCompany(company);
}

module.exports = {
  getCompanyProfile,
  updateCompanyProfile,
  uploadCompanyProfilePicture,
  serializeCompany,
};
