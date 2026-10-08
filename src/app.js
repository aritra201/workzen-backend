const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const companyRoutes = require('./routes/company.routes');
const memberRoutes = require('./routes/member.routes');
const invitationRoutes = require('./routes/invitation.routes');
const employeeRoutes = require('./routes/employee.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const extraShiftRoutes = require('./routes/extraShift.routes');
const unlockRequestRoutes = require('./routes/unlockRequest.routes');
const attendanceVerificationRoutes = require('./routes/attendanceVerification.routes');
const payrollRoutes = require('./routes/payroll.routes');
const activityLogRoutes = require('./routes/activityLog.routes');
const errorHandler = require('./helper/errorHandler.helper');
const env = require('./config/env');

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true);
        }
        if (origin === env.clientUrl) {
          return callback(null, true);
        }
        if (env.nodeEnv === 'development') {
          if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
            return callback(null, true);
          }
          if (/\.ngrok-free\.app$/.test(origin) || /\.ngrok\.io$/.test(origin)) {
            return callback(null, true);
          }
        }
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/company', companyRoutes);
  app.use('/api/members', memberRoutes);
  app.use('/api/invitations', invitationRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/extra-shifts', extraShiftRoutes);
  app.use('/api/unlock-requests', unlockRequestRoutes);
  app.use('/api/company-attendance', attendanceVerificationRoutes);
  app.use('/api/payroll', payrollRoutes);
  app.use('/api/activity-logs', activityLogRoutes);

  app.use((req, res) => res.status(404).json({ message: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
