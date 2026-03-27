/**
 * SMAIL Backend Server - Scaled for 100+ Concurrent Users
 * 
 * Features:
 * - Node.js clustering (multiple worker processes)
 * - PostgreSQL with connection pooling
 * - Redis for session & cache management
 * - Rate limiting & request queuing
 * - Graceful shutdown & health checks
 */

'use strict';

const cluster = require('cluster');
const os = require('os');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { Pool } = require('pg');
const redis = require('redis');
const dotenv = require('dotenv');

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────
// CLUSTERING SETUP (Primary Process)
// ─────────────────────────────────────────────────────────────────────────

const NUM_WORKERS = process.env.NUM_WORKERS || os.cpus().length;
const PORT = process.env.PORT || 3000;

if (cluster.isMaster) {
  console.log(`\n🚀 SMAIL System - Scaled Edition`);
  console.log(`📊 Deploying ${NUM_WORKERS} worker processes...`);
  console.log(`🖥️  CPU cores available: ${os.cpus().length}\n`);

  // Spawn workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork();
  }

  // Handle worker crashes
  cluster.on('exit', (worker, code, signal) => {
    if (!worker.exitedAfterDisconnect) {
      console.log(`⚠️  Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
      cluster.fork();
    }
  });

  // Graceful cluster shutdown
  process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received. Graceful shutdown...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });

  return;
}

// ─────────────────────────────────────────────────────────────────────────
// WORKER PROCESS SETUP
// ─────────────────────────────────────────────────────────────────────────

console.log(`✅ Worker ${process.pid} started`);

const app = express();

// ─────────────────────────────────────────────────────────────────────────
// DATABASE CONNECTION POOL (PostgreSQL)
// ─────────────────────────────────────────────────────────────────────────

const pool = new Pool({
  user: process.env.DB_USER || 'smail_user',
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'smail_db',
  max: 20, // max connections per worker
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Expose pool globally (but use it through utilities)
global.db = { pool };

// ─────────────────────────────────────────────────────────────────────────
// REDIS CLIENT (Session & Cache)
// ─────────────────────────────────────────────────────────────────────────

const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'redis',
    port: process.env.REDIS_PORT || 6379
  },
  password: process.env.REDIS_PASSWORD || undefined,
  retry_strategy: (opts) => {
    if (opts.total_retry_time > 1000 * 60 * 60) return new Error('Redis connection failed');
    if (opts.attempt > 10) return undefined;
    return Math.min(opts.attempt * 100, 3000);
  }
});

redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.on('ready', () => console.log(`✅ Redis connected`));

// Promisify Redis for async/await
const redis_get = (key) => new Promise((resolve, reject) => {
  redisClient.get(key, (err, data) => err ? reject(err) : resolve(data));
});
const redis_set = (key, value, ttl) => new Promise((resolve, reject) => {
  if (ttl) {
    redisClient.setex(key, ttl, value, (err) => err ? reject(err) : resolve());
  } else {
    redisClient.set(key, value, (err) => err ? reject(err) : resolve());
  }
});

global.redis = { get: redis_get, set: redis_set, client: redisClient };

// ─────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────

// Compression
app.use(compression());

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || ['http://localhost:3000', 'http://localhost:5000'],
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Session store in Redis
const RedisStore = require('connect-redis')(session);
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// Static files
app.use(express.static('frontend'));

// ─────────────────────────────────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────────────────────────────────

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  store: new (require('rate-limit-redis'))({
    client: redisClient,
    prefix: 'rl:',
  })
});

app.use(limiter);

// ─────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────

const authRoutes = require('./routes/auth');
const emailRoutes = require('./routes/emails');

app.use('/api/auth', authRoutes);
app.use('/api', emailRoutes);

// ─────────────────────────────────────────────────────────────────────────
// HEALTH CHECK & METRICS
// ─────────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    worker_pid: process.pid,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.get('/metrics', async (req, res) => {
  try {
    const poolStats = pool.totalCount ? {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount
    } : null;

    res.json({
      worker: process.pid,
      memory: process.memoryUsage(),
      database_pool: poolStats,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SERVER STARTUP
// ─────────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Worker ${process.pid} listening on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`\n🛑 Worker ${process.pid} shutting down...`);
  server.close(async () => {
    await pool.end();
    redisClient.quit();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log(`\n🛑 Worker ${process.pid} interrupted...`);
  await pool.end();
  redisClient.quit();
  process.exit(0);
});

module.exports = { app, pool };
