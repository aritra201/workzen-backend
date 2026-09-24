const { User, EmployeeProfile, Invitation } = require('../models');
const {
  COMPANY_ROLE,
  INVITATION_ROLE,
  INVITATION_STATUS,
} = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { sendEmployeeInvitationEmail } = require('../helper/email.helper');
const { uploadImageBuffer } = require('../helper/cloudinary.helper');
const {
  assertEmployeeProfileIsActive,
  findActiveEmployeeProfileByUserId,
  findActiveEmployeeProfileById,
} = require('../helper/employeeAccess.helper');

function serializeEmployee(employee) {
  const company = employee.company_id;
  return {
    employeeId: employee._id,
    employeeName: employee.employee_name,
    employeeEmail: employee.employee_email,
    profilePicture: employee.employee_profile_picture ?? null,
    countryCode: employee.country_code ?? null,
    phoneNumber: employee.phone_number ?? null,
    country: employee.country ?? null,
    state: employee.state ?? null,
    pinCode: employee.pin_code ?? null,
    fullAddress: employee.full_address ?? null,
    companyId: company._id,
    companyName: company.company_name ?? null,
    role: COMPANY_ROLE.EMPLOYEE,
    isActive: employee.is_active,
    joinedAt: employee.created_at,
  };
}

function normalizeEmployeeEmail(email) {
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    throw new AppError('A valid employeeEmail is required', 400);
  }
  return normalized;
}

function normalizeEmployeeName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized) {
    throw new AppError('employeeName is required', 400);
  }
  return normalized;
}

async function assertEmployeeInviteAllowed(company, employeeEmail) {
  const adminUser = await User.findById(company.admin_user_id);
  if (adminUser.email === employeeEmail) {
    throw new AppError('You cannot add yourself as an employee', 400);
  }

  const existingInCompany = await EmployeeProfile.findOne({
    company_id: company._id,
    employee_email: employeeEmail,
  });

  if (existingInCompany?.is_active) {
    throw new AppError('This email is already an active employee in your company', 409);
  }

  const existingUser = await User.findOne({ email: employeeEmail });
  if (existingUser) {
    const linkedEmployee = await EmployeeProfile.findOne({ user_id: existingUser._id });
    if (
      linkedEmployee &&
      linkedEmployee.is_active &&
      linkedEmployee.company_id.toString() !== company._id.toString()
    ) {
      throw new AppError(
        'This user is already an active employee at another company in WorkZen',
        409
      );
    }
  }

  return existingInCompany;
}

async function revokeSupersededEmployeeInvites(companyId, employeeEmail) {
  const openInvites = await Invitation.find({
    company_id: companyId,
    invited_email: employeeEmail,
    invited_role: INVITATION_ROLE.EMPLOYEE,
    status: INVITATION_STATUS.PENDING,
  });

  const now = new Date();
  for (const invite of openInvites) {
    invite.status = invite.expires_at < now ? INVITATION_STATUS.EXPIRED : INVITATION_STATUS.REVOKED;
    await invite.save();
  }
}

async function createAndEmailEmployeeInvitation({
  company,
  adminUserId,
  employeeEmail,
  employeeName,
  employeeProfile,
  actionType,
}) {
  const { rawToken, tokenHash } = Invitation.generateToken();

  const invitation = await Invitation.create({
    company_id: company._id,
    invited_email: employeeEmail,
    invited_role: INVITATION_ROLE.EMPLOYEE,
    invited_name: employeeName,
    token_hash: tokenHash,
    status: INVITATION_STATUS.PENDING,
    expires_at: Invitation.defaultExpiry(),
  });

  await sendEmployeeInvitationEmail({
    to: employeeEmail,
    rawToken,
    companyName: company.company_name || 'your company',
    employeeName,
  });

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType,
    targetType: 'Invitation',
    targetId: invitation._id,
    metadata: {
      invited_email: employeeEmail,
      invited_role: INVITATION_ROLE.EMPLOYEE,
      employee_profile_id: employeeProfile._id,
    },
  });

  return {
    invitationId: invitation._id,
    employeeProfileId: employeeProfile._id,
    employeeEmail,
    employeeName,
    expiresAt: invitation.expires_at,
  };
}

/**
 * FR-030: create pending EmployeeProfile + send invitation.
 */
async function inviteEmployee({ company, adminUserId, employeeName, employeeEmail }) {
  const name = normalizeEmployeeName(employeeName);
  const email = normalizeEmployeeEmail(employeeEmail);

  let employeeProfile = await assertEmployeeInviteAllowed(company, email);

  const pendingInvite = await Invitation.findOne({
    company_id: company._id,
    invited_email: email,
    invited_role: INVITATION_ROLE.EMPLOYEE,
    status: INVITATION_STATUS.PENDING,
    expires_at: { $gt: new Date() },
  });

  if (pendingInvite) {
    throw new AppError(
      'An invitation is already pending for this email — use resend invitation instead',
      409
    );
  }

  if (!employeeProfile) {
    employeeProfile = await EmployeeProfile.create({
      company_id: company._id,
      employee_name: name,
      employee_email: email,
      is_active: false,
    });
  } else {
    employeeProfile.employee_name = name;
    await employeeProfile.save();
  }

  return createAndEmailEmployeeInvitation({
    company,
    adminUserId,
    employeeEmail: email,
    employeeName: name,
    employeeProfile,
    actionType: 'invitation.sent',
  });
}

async function resendEmployeeInvitation({ company, adminUserId, employeeEmail }) {
  const email = normalizeEmployeeEmail(employeeEmail);

  let employeeProfile = await assertEmployeeInviteAllowed(company, email);

  const hadPriorInvite = await Invitation.exists({
    company_id: company._id,
    invited_email: email,
    invited_role: INVITATION_ROLE.EMPLOYEE,
  });

  if (!employeeProfile) {
    employeeProfile = await EmployeeProfile.findOne({
      company_id: company._id,
      employee_email: email,
      is_active: false,
    });
  }

  if (!hadPriorInvite && !employeeProfile) {
    throw new AppError(
      'No prior invitation found for this email — send a new invitation instead',
      404
    );
  }

  if (!employeeProfile) {
    throw new AppError('Employee record not found for this email', 404);
  }

  await revokeSupersededEmployeeInvites(company._id, email);

  return createAndEmailEmployeeInvitation({
    company,
    adminUserId,
    employeeEmail: email,
    employeeName: employeeProfile.employee_name,
    employeeProfile,
    actionType: 'invitation.resent',
  });
}

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

async function listEmployees(companyId) {
  const employees = await EmployeeProfile.find({ company_id: companyId })
    .populate('company_id', 'company_name')
    .sort({ created_at: -1 });

  return employees.map(serializeEmployee);
}

/**
 * Paginated roster of active (present) employees for the company admin.
 */
async function listPresentEmployees(companyId, { page, limit }) {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_LIST_LIMIT,
    Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIST_LIMIT)
  );
  const skip = (pageNum - 1) * limitNum;

  const filter = { company_id: companyId, is_active: true };

  const [total, employees] = await Promise.all([
    EmployeeProfile.countDocuments(filter),
    EmployeeProfile.find(filter)
      .populate('company_id', 'company_name')
      .sort({ employee_name: 1, created_at: -1 })
      .skip(skip)
      .limit(limitNum),
  ]);

  return {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limitNum),
    items: employees.map(serializeEmployee),
  };
}

/**
 * FR-036: deactivate / reactivate employee.
 */
async function setEmployeeActive({ company, adminUserId, employeeId, isActive }) {
  if (typeof isActive !== 'boolean') {
    throw new AppError('isActive must be a boolean', 400);
  }

  const employee = await EmployeeProfile.findOne({
    _id: employeeId,
    company_id: company._id,
  }).populate('company_id', 'company_name');

  if (!employee) {
    throw new AppError('Employee not found', 404);
  }

  if (!employee.user_id && isActive) {
    throw new AppError('Cannot activate an employee who has not accepted the invitation yet', 400);
  }

  if (employee.is_active === isActive) {
    return serializeEmployee(employee);
  }

  const before = employee.is_active;
  employee.is_active = isActive;
  await employee.save();

  if (employee.user_id) {
    const user = await User.findById(employee.user_id);
    if (user) {
      user.current_refresh_token_hash = undefined;
      await user.save();
    }
  }

  await writeActivityLog({
    companyId: company._id,
    actorUserId: adminUserId,
    actorRole: COMPANY_ROLE.ADMIN,
    actionType: isActive ? 'employee.reactivated' : 'employee.deactivated',
    targetType: 'EmployeeProfile',
    targetId: employee._id,
    beforeValue: { is_active: before },
    afterValue: { is_active: isActive },
    metadata: { employee_email: employee.employee_email },
  });

  return serializeEmployee(employee);
}

async function loadEmployeeForUser(userId, employeeProfileId) {
  if (employeeProfileId) {
    return findActiveEmployeeProfileById(employeeProfileId, userId, true);
  }
  return findActiveEmployeeProfileByUserId(userId, true);
}

async function getMyEmployeeProfile({ userId, employeeProfileId }) {
  const employee = await loadEmployeeForUser(userId, employeeProfileId);
  return serializeEmployee(employee);
}

const PROFILE_PATCH_MAP = {
  countryCode: 'country_code',
  phoneNumber: 'phone_number',
  country: 'country',
  state: 'state',
  pinCode: 'pin_code',
  fullAddress: 'full_address',
};

/**
 * FR-035: optional profile fields (not email / not profile picture via JSON).
 */
async function updateMyEmployeeProfile({ userId, employeeProfileId, body }) {
  if (body.profilePicture !== undefined || body.employeeProfilePicture !== undefined) {
    throw new AppError(
      'Use POST /api/employees/me/profile-picture with multipart form-data (field: profilePicture)',
      400
    );
  }
  if (body.employeeEmail !== undefined || body.employeeName !== undefined) {
    throw new AppError('employeeEmail and employeeName cannot be changed here', 400);
  }

  const updates = {};
  for (const [apiKey, dbKey] of Object.entries(PROFILE_PATCH_MAP)) {
    if (Object.prototype.hasOwnProperty.call(body, apiKey)) {
      const val = body[apiKey];
      if (val === null || val === undefined) {
        updates[dbKey] = null;
      } else if (typeof val === 'string') {
        const trimmed = val.trim();
        updates[dbKey] = trimmed === '' ? null : trimmed;
      } else {
        throw new AppError(`${apiKey} must be a string or null`, 400);
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid profile fields to update', 400);
  }

  const employee = await loadEmployeeForUser(userId, employeeProfileId);
  assertEmployeeProfileIsActive(employee);

  const before = {};
  const after = {};
  for (const [dbKey, value] of Object.entries(updates)) {
    before[dbKey] = employee[dbKey] ?? null;
    employee[dbKey] = value;
    after[dbKey] = value;
  }

  await employee.save();

  await writeActivityLog({
    companyId: employee.company_id._id,
    actorUserId: userId,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: 'employee.profile_updated',
    targetType: 'EmployeeProfile',
    targetId: employee._id,
    beforeValue: before,
    afterValue: after,
  });

  return serializeEmployee(
    await EmployeeProfile.findById(employee._id).populate('company_id', 'company_name')
  );
}

async function uploadMyEmployeeProfilePicture({ userId, employeeProfileId, file }) {
  if (!file || !file.buffer) {
    throw new AppError('profilePicture file is required', 400);
  }

  const employee = await loadEmployeeForUser(userId, employeeProfileId);
  assertEmployeeProfileIsActive(employee);

  const before = employee.employee_profile_picture ?? null;
  const folder = `workzen/employees/${employee._id.toString()}/profile`;
  const publicId = 'employee_profile_picture';

  let uploadResult;
  try {
    uploadResult = await uploadImageBuffer(file.buffer, { folder, publicId });
  } catch (err) {
    throw new AppError('Failed to upload image — try again later', 502);
  }

  employee.employee_profile_picture = uploadResult.secure_url;
  await employee.save();

  await writeActivityLog({
    companyId: employee.company_id._id,
    actorUserId: userId,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: 'employee.profile_updated',
    targetType: 'EmployeeProfile',
    targetId: employee._id,
    beforeValue: { employee_profile_picture: before },
    afterValue: { employee_profile_picture: employee.employee_profile_picture },
  });

  return serializeEmployee(
    await EmployeeProfile.findById(employee._id).populate('company_id', 'company_name')
  );
}

module.exports = {
  listEmployees,
  listPresentEmployees,
  inviteEmployee,
  resendEmployeeInvitation,
  setEmployeeActive,
  getMyEmployeeProfile,
  updateMyEmployeeProfile,
  uploadMyEmployeeProfilePicture,
  serializeEmployee,
};
