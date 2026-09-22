const { User, Company, EmployeeProfile, Invitation } = require('../models');
const {
  AUTH_PROVIDER,
  COMPANY_ROLE,
  INVITATION_ROLE,
  INVITATION_STATUS,
} = require('../utils/enums');
const { AppError } = require('../utils/AppError');
const { loadPendingEmployeeInvitation } = require('../helper/invitation.helper');
const { verifyGoogleIdToken } = require('../helper/google.helper');
const { writeActivityLog } = require('../helper/activityLog.helper');
const { issueAndPersistTokens } = require('./auth.service');

async function getEmployeeInvitationPreview(rawToken) {
  const invitation = await loadPendingEmployeeInvitation(rawToken);
  const company = await Company.findById(invitation.company_id);
  const employee = await EmployeeProfile.findOne({
    company_id: invitation.company_id,
    employee_email: invitation.invited_email,
  });

  if (!employee) {
    throw new AppError('Employee record for this invitation was not found', 400);
  }

  const employeeName = employee.employee_name || invitation.invited_name || null;

  return {
    employeeName,
    employeeEmail: invitation.invited_email,
    role: INVITATION_ROLE.EMPLOYEE,
    companyId: invitation.company_id,
    companyName: company?.company_name ?? null,
    expiresAt: invitation.expires_at,
    needsEmployeeName: !employeeName,
  };
}

async function linkEmployeeToUser({ invitation, user, session, employeeNameOverride }) {
  const employee = await EmployeeProfile.findOne({
    company_id: invitation.company_id,
    employee_email: invitation.invited_email,
  }).session(session);

  if (!employee) {
    throw new AppError('Employee record for this invitation was not found', 400);
  }

  if (employee.is_active && employee.user_id) {
    throw new AppError('This employee invitation has already been accepted', 409);
  }

  const existingLink = await EmployeeProfile.findOne({ user_id: user._id }).session(session);
  if (existingLink && existingLink._id.toString() !== employee._id.toString()) {
    throw new AppError(
      'This account is already linked to another employee profile in WorkZen',
      409
    );
  }

  if (!employee.employee_name) {
    const name =
      employeeNameOverride?.trim() || invitation.invited_name?.trim() || '';
    if (!name) {
      throw new AppError('employeeName is required to complete signup', 400);
    }
    employee.employee_name = name;
  }

  employee.user_id = user._id;
  employee.is_active = true;
  await employee.save({ session });

  invitation.status = INVITATION_STATUS.ACCEPTED;
  invitation.accepted_at = new Date();
  await invitation.save({ session });

  await writeActivityLog({
    companyId: invitation.company_id,
    actorUserId: user._id,
    actorRole: COMPANY_ROLE.EMPLOYEE,
    actionType: 'invitation.accepted',
    targetType: 'Invitation',
    targetId: invitation._id,
    metadata: {
      invited_role: INVITATION_ROLE.EMPLOYEE,
      invited_email: invitation.invited_email,
      employee_profile_id: employee._id,
    },
  });

  return employee;
}

/**
 * FR-031: accept with password — creates/links User and activates EmployeeProfile.
 */
async function acceptEmployeeInvitationManual({ rawToken, password }) {
  if (!password || password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const invitation = await loadPendingEmployeeInvitation(rawToken);
  const email = invitation.invited_email;

  const session = await User.startSession();
  let user;
  let employee;

  try {
    await session.withTransaction(async () => {
      user = await User.findOne({ email }).select('+password_hash').session(session);

      if (!user) {
        user = new User({
          email,
          password_hash: password,
          auth_provider: AUTH_PROVIDER.LOCAL,
          is_active: true,
          is_email_verified: true,
        });
        await user.save({ session });
      } else if (user.auth_provider === AUTH_PROVIDER.GOOGLE) {
        throw new AppError(
          'This email uses Google sign-in — accept the invitation with Google instead',
          400
        );
      } else {
        const passwordMatches = await user.comparePassword(password);
        if (!passwordMatches) {
          throw new AppError(
            'An account with this email already exists — enter your current password to accept, or use forgot password',
            401
          );
        }
        if (!user.is_active) {
          user.is_active = true;
          user.is_email_verified = true;
          await user.save({ session });
        }
      }

      employee = await linkEmployeeToUser({ invitation, user, session });
    });
  } finally {
    session.endSession();
  }

  const tokens = await issueAndPersistTokens(user);

  return {
    ...tokens,
    role: COMPANY_ROLE.EMPLOYEE,
    companyId: invitation.company_id,
    employeeProfileId: employee._id,
    needsEmployeeName: false,
  };
}

/**
 * FR-033/034: Google accept — email must match invite; optional employeeName if missing.
 */
async function acceptEmployeeInvitationGoogle({ rawToken, idToken, employeeName }) {
  const invitation = await loadPendingEmployeeInvitation(rawToken);
  const { googleId, email } = await verifyGoogleIdToken(idToken);

  if (email !== invitation.invited_email) {
    throw new AppError('Google account email must match the invited employee email', 403);
  }

  const session = await User.startSession();
  let user;
  let employee;
  let needsEmployeeName = false;

  try {
    await session.withTransaction(async () => {
      user = await User.findOne({ google_id: googleId }).session(session);

      if (!user) {
        const existingLocal = await User.findOne({ email }).session(session);
        if (existingLocal) {
          throw new AppError(
            'An account with this email already exists — accept with your password instead',
            409
          );
        }

        user = new User({
          email,
          auth_provider: AUTH_PROVIDER.GOOGLE,
          google_id: googleId,
          is_active: true,
          is_email_verified: true,
        });
        await user.save({ session });
      } else if (!user.is_active) {
        user.is_active = true;
        await user.save({ session });
      }

      const pendingEmployee = await EmployeeProfile.findOne({
        company_id: invitation.company_id,
        employee_email: invitation.invited_email,
      }).session(session);

      needsEmployeeName =
        !pendingEmployee?.employee_name &&
        !invitation.invited_name &&
        !employeeName?.trim();

      if (needsEmployeeName) {
        throw new AppError('employeeName is required to complete signup', 400);
      }

      employee = await linkEmployeeToUser({
        invitation,
        user,
        session,
        employeeNameOverride: employeeName,
      });
    });
  } finally {
    session.endSession();
  }

  const tokens = await issueAndPersistTokens(user);

  return {
    ...tokens,
    role: COMPANY_ROLE.EMPLOYEE,
    companyId: invitation.company_id,
    employeeProfileId: employee._id,
    needsEmployeeName: false,
  };
}

module.exports = {
  getEmployeeInvitationPreview,
  acceptEmployeeInvitationManual,
  acceptEmployeeInvitationGoogle,
};
