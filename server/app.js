require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');

const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const trucksRoutes = require('./src/routes/trucks');
const exportRoutes = require('./src/routes/export');
const settingsRoutes = require('./src/routes/settings');
const notificationsRoutes = require('./src/routes/notifications');
const reportsRoutes = require('./src/routes/reports');
const disposalRoutes = require('./src/routes/disposal');
const translateRoutes = require('./src/routes/translate');

const app = express();

const defaultOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];
const originEnv = process.env.CLIENT_ORIGIN;
const allowedOrigins = originEnv
  ? originEnv.split(',').map((value) => value.trim()).filter(Boolean)
  : defaultOrigins;
const allowAllOrigins = allowedOrigins.includes('*');
const corsOptions = {
  origin: allowAllOrigins ? true : allowedOrigins,
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.set('corsOptions', corsOptions);

// simple health endpoint so the client can detect backend availability
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Health check failed', err);
    res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/trucks', trucksRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/disposal', disposalRoutes);
app.use('/api/translate', translateRoutes);

// GET /api/municipalities – proxied to reports/municipalities for client convenience
const authMiddleware = require('./src/authMiddleware');
app.get('/api/municipalities', authMiddleware, async (req, res) => {
  try {
    const pool = require('./db');
    const { rows } = await pool.query(
      `SELECT id, name, municipality_code, country, city, state_region
       FROM municipalities
       ORDER BY name NULLS LAST, municipality_code NULLS LAST, id ASC`
    );
    return res.json({ data: rows });
  } catch (err) {
    console.error('Municipality list failed', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// serve uploaded assets
const uploadsDir = path.resolve(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir));

// Serve SPA in production and provide a fallback so client routes work on refresh
const clientDist = path.resolve(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.use((req, res, next) => {
  if (
    req.method !== 'GET' ||
    req.path.startsWith('/api') ||
    req.path.startsWith('/socket.io')
  ) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'));
});

module.exports = { app, corsOptions };
