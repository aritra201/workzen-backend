const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.routes');
const companyRoutes = require('./routes/company.routes');
const memberRoutes = require('./routes/member.routes');
const invitationRoutes = require('./routes/invitation.routes');
const errorHandler = require('./helper/errorHandler.helper');
const env = require('./config/env');

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.clientUrl, credentials: true }));
  app.use(express.json());
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/company', companyRoutes);
  app.use('/api/members', memberRoutes);
  app.use('/api/invitations', invitationRoutes);
  // Future modules mount here, e.g.:
  // app.use('/api/employees', employeeRoutes);
  // app.use('/api/attendance', attendanceRoutes);

  app.use((req, res) => res.status(404).json({ message: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
