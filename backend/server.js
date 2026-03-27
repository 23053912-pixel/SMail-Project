// Email storage via Gmail API + Session cache (Stateless design for cloud deployment)
const path = require('path');

// ── Pre-warm ML model at startup for instant first prediction ────────────────
function warmupMLModel() {
  const https = require('https');
  const ML_HOST = process.env.ML_API_HOST || 'localhost';
  const ML_PORT = parseInt(process.env.ML_API_PORT || '5001', 10);
  const warmupText = 'This is a test email for model warmup';
  const body = JSON.stringify({ text: warmupText });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  const opts = { hostname: ML_HOST, port: ML_PORT, path: '/predict', method: 'POST', headers };
  const req = require('http').request(opts, (r) => {
    let data = '';
    r.on('data', chunk => { data += chunk; });
    r.on('end', () => console.log('✓ ML model pre-warmed (first prediction cached)'));
  });
  req.on('error', () => console.log('⚠ ML model warmup skipped (API not ready)'));
  req.setTimeout(3000, () => req.abort());
  req.write(body);
  req.end();
}

// Warmup after brief delay to allow ML API startup
setTimeout(warmupMLModel, 2000);
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// ── Fail fast if JWT_SECRET is missing ───────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}


const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const compression = require('compression');
const session    = require('express-session');

const { PORT, BASE_URL }                                     = require('./config');
const { router: authRouter, callbackHandler, logoutHandler } = require('./routes/auth');
const emailsRouter                                           = require('./routes/emailsRestructured');

const app = express();

// ── Enable gzip compression for responses (reduces bandwidth by ~60%) ────────
app.use(compression({ level: 6, threshold: 1024 })); // Only compress > 1KB

// ── Security headers ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || BASE_URL;
app.use(cors({
  origin:         ALLOWED_ORIGIN,
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Body parser + static files ────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Session middleware ────────────────────────────────────────────────────────
// Store user sessions with email cache across requests
app.use(session({
  secret: process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000  // 24 hours
  },
  store: new (require('express-session').MemoryStore)()
}));

// ── Request timeout middleware ────────────────────────────────────────────────
app.use((req, res, next) => {
  // Set timeout: 60 seconds for normal requests, 120 for refresh/scan
  const timeout = req.path.includes('refresh') || req.path.includes('auto-spam-scan') ? 120000 : 60000;
  req.setTimeout(timeout);
  res.setTimeout(timeout);
  next();
});

// ── Rate limiters ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 25,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 500,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' }
});
app.use('/api/auth', authLimiter);
app.use('/callback', authLimiter);
app.use('/api',      apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRouter);
app.get('/callback',    callbackHandler);
app.post('/api/logout', logoutHandler);
app.use('/api',         emailsRouter);

// ── Frontend entry point ──────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SMail Server running — open in browser: ${BASE_URL}`);
});
