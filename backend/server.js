'use strict';

// Email storage via Gmail API + Session cache (Stateless design for cloud deployment)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

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
      "form-action 'self' https://accounts.google.com",
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

// ── CSRF protection: reject cross-origin mutations ───────────────────────────
// Session cookie uses sameSite:'strict' (primary defense), this is a second layer.
app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return next();

  // Skip CSRF for OAuth callback (Google redirects here without our Origin)
  if (req.path === '/callback') return next();

  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next(); // Non-browser clients (curl, Postman) — rely on JWT auth

  try {
    const url = new URL(origin);
    const requestOrigin = url.origin;
    if (requestOrigin === ALLOWED_ORIGIN) return next();
  } catch { /* invalid URL — reject */ }

  return res.status(403).json({ error: 'Cross-origin request rejected' });
});

// ── Body parser + static files ────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '../frontend'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

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

  // Pre-warm ML model after brief delay to allow ML API startup
  const { warmupMLModel } = require('./services/spamDetection');
  setTimeout(warmupMLModel, 2000);
});
