require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const { app, corsOptions } = require('../app');
const { initSimulator } = require('./services/koblenzSimulator');
const { startLiveOptimizationStream } = require('./services/routeOptimization');
const { runMigrations } = require('./migrate');

const server = http.createServer(app);

const pingIntervalEnv = Number(process.env.SOCKET_PING_INTERVAL_MS);
const pingTimeoutEnv = Number(process.env.SOCKET_PING_TIMEOUT_MS);
const pingInterval = Number.isFinite(pingIntervalEnv) && pingIntervalEnv > 0 ? pingIntervalEnv : 25000;
const pingTimeout = Number.isFinite(pingTimeoutEnv) && pingTimeoutEnv > 0 ? pingTimeoutEnv : 60000;

const keepAliveEnv = Number(process.env.SOCKET_KEEP_ALIVE_TIMEOUT_MS);
const headersEnv = Number(process.env.SOCKET_HEADERS_TIMEOUT_MS);
const keepAliveTimeout =
  Number.isFinite(keepAliveEnv) && keepAliveEnv > 0
    ? keepAliveEnv
    : Math.max(65000, pingInterval + pingTimeout);
const headersTimeout =
  Number.isFinite(headersEnv) && headersEnv > 0 ? headersEnv : keepAliveTimeout + 10000;

server.keepAliveTimeout = keepAliveTimeout;
server.headersTimeout = headersTimeout;

const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval,
  pingTimeout,
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected', socket.id));
});

// start Koblenz simulator (prototype)
initSimulator(io);
// emit live optimization snapshots while a user has triggered optimization
startLiveOptimizationStream(io, 3000);

const PORT = process.env.PORT || 5000;

// Run database migrations then start HTTP listener.
// Migrations are graceful — server starts even if they fail.
runMigrations()
  .catch((err) => {
    console.error('[startup] Migration error (non-fatal):', err.message);
  })
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
