'use strict';

const express          = require('express');
const crypto           = require('crypto');
const https            = require('https');
const { OAuth2Client } = require('google-auth-library');
const { google }       = require('googleapis');
const jwt              = require('jsonwebtoken');

const { BASE_URL }                                    = require('../config');
const { sessions, upsertSession, getAllEmailsDeduped } = require('../utils/session');
const { fetchGmailEmails }                             = require('../services/gmail');

const router = express.Router();

// ── OAuth CSRF state store (nonce → expiry timestamp) ────────────────────────
const oauthStates = new Map();

function generateOAuthState() {
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, Date.now() + 10 * 60 * 1000); // 10-min TTL
  return state;
}

function consumeOAuthState(state) {
  const expiry = oauthStates.get(state);
  if (!expiry) return false;
  oauthStates.delete(state);
  return Date.now() < expiry;
}

// ── One-time JWT exchange codes (never put the JWT in the URL) ────────────────
const authExchangeCodes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of authExchangeCodes) {
    if (data.expiry < now) authExchangeCodes.delete(code);
  }
}, 5 * 60 * 1000);

function newGoogleClient() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BASE_URL}/callback`
  );
}

// ── POST /api/auth/exchange (redeem one-time code for JWT) ───────────────────
router.post('/exchange', (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') return res.status(400).json({ error: 'Missing code' });
  const data = authExchangeCodes.get(code);
  if (!data || data.expiry < Date.now()) {
    authExchangeCodes.delete(code);
    return res.status(400).json({ error: 'Invalid or expired exchange code' });
  }
  authExchangeCodes.delete(code); // one-time use
  res.json({ token: data.token, user: data.user, emailCount: data.emailCount });
});

// ── GET /api/auth/google-url ──────────────────────────────────────────────────
router.get('/google-url', (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.json({ url: `${BASE_URL}/callback?code=demo_code&demo=true`, demo: true });
    }
    const url = newGoogleClient().generateAuthUrl({
      access_type: 'offline',
      prompt:      'consent',
      state:       generateOAuthState(),
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'openid'
      ]
    });
    res.json({ url });
  } catch (err) {
    console.error('OAuth URL error:', err.message);
    res.status(500).json({ error: 'Failed to generate sign-in URL' });
  }
});

// ── POST /api/auth/firebase-google ───────────────────────────────────────────
router.post('/firebase-google', async (req, res) => {
  try {
    const { accessToken, user } = req.body;
    if (!accessToken || !user?.id || !user?.email) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    const userObj = {
      id:          String(user.id),
      email:       String(user.email),
      name:        String(user.name || user.email),
      picture:     String(user.picture || ''),
      provider:    'google',
      accessToken: String(accessToken)
    };
    const session  = upsertSession(userObj);
    await fetchGmailEmails(session, accessToken);
    const token    = jwt.sign({ id: session.user.id, email: session.user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const safeUser = { id: userObj.id, email: userObj.email, name: userObj.name, picture: userObj.picture, provider: 'google' };
    res.json({ success: true, token, user: safeUser, emailCount: session.userEmails.length });
  } catch (err) {
    console.error('Firebase Auth Error:', err.message);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
});

// ── POST /api/auth/google (ID-token login) ───────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { tokenId, accessToken } = req.body;
    if (!tokenId) return res.status(400).json({ error: 'Token ID is required' });
    const ticket  = await newGoogleClient().verifyIdToken({ idToken: tokenId, audience: process.env.GOOGLE_CLIENT_ID });
    const p       = ticket.getPayload();
    const userObj = {
      id:          p['sub'],
      email:       p['email'],
      name:        p['name'] || p['email'],
      picture:     p['picture'] || '',
      provider:    'google',
      accessToken: accessToken || ''
    };
    const session  = upsertSession(userObj);
    if (accessToken) await fetchGmailEmails(session, accessToken);
    const token    = jwt.sign({ id: session.user.id, email: session.user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const safeUser = { id: userObj.id, email: userObj.email, name: userObj.name, picture: userObj.picture, provider: 'google' };
    res.json({ success: true, user: safeUser, jwtToken: token, emailCount: session.userEmails.length });
  } catch (err) {
    console.error('Google Auth Error:', err.message);
    res.status(401).json({ error: 'Invalid token or authentication failed' });
  }
});

// ── GET /callback (OAuth2 redirect from Google) ──────────────────────────────
const callbackHandler = async (req, res) => {
  const { code, error, state, demo } = req.query;
  const isDemo = demo === 'true';

  if (error && !isDemo) {
    console.error('Google OAuth error:', error);
    return res.redirect('/?error=Sign-in+failed');
  }
  if (!code) return res.redirect('/?error=Authorization+code+not+found');

  if (!isDemo && code !== 'demo_code') {
    if (!state || !consumeOAuthState(state)) {
      console.error('OAuth state mismatch — possible CSRF attempt');
      return res.redirect('/?error=Sign-in+failed');
    }
  }

  try {
    let googleId, email, name, picture, accessToken, fullTokens;

    if (isDemo || code === 'demo_code') {
      googleId    = 'google_demo_123456789';
      email       = 'googledemo@gmail.com';
      name        = 'Google Demo User';
      picture     = '';
      accessToken = 'demo_access_token_' + Date.now();
    } else {
      const client     = newGoogleClient();
      const { tokens } = await client.getToken(code);
      fullTokens       = tokens;
      accessToken      = tokens.access_token;
      if (!accessToken) throw new Error('No access token received from Google');

      const tmpClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
      tmpClient.setCredentials(tokens);

      let profile;
      try {
        profile = await new Promise((resolve, reject) => {
          const req2 = https.request({
            hostname: 'www.googleapis.com',
            path:     '/oauth2/v2/userinfo',
            method:   'GET',
            headers:  { Authorization: `Bearer ${accessToken}` }
          }, (response) => {
            let data = '';
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => {
              if (response.statusCode === 200) resolve(JSON.parse(data));
              else reject(new Error(`Userinfo ${response.statusCode}`));
            });
          });
          req2.on('error', reject);
          req2.end();
        });
      } catch {
        const oauth2 = google.oauth2({ version: 'v2', auth: tmpClient });
        const info   = await oauth2.userinfo.get();
        profile      = info.data;
      }

      googleId = profile.id;
      email    = profile.email;
      name     = profile.name;
      picture  = profile.picture;
      if (!email || !googleId) throw new Error('Missing user info from Google');
    }

    console.log(`Authenticated user: ${email}`);
    const userObj  = { id: googleId, email, name: name || email, picture: picture || '', provider: 'google', accessToken };
    const session  = upsertSession(userObj);

    if (!isDemo && code !== 'demo_code') {
      await fetchGmailEmails(session, fullTokens || accessToken);
    }

    const token    = jwt.sign({ id: session.user.id, email: session.user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    const total    = getAllEmailsDeduped(session).length;
    const safeUser = { id: googleId, email, name: name || email, picture: picture || '', provider: 'google' };

    // Issue a one-time exchange code so the JWT is never exposed in the URL
    // (browser history, server logs, and Referer headers won't capture the token)
    const exchangeCode = crypto.randomBytes(32).toString('hex');
    authExchangeCodes.set(exchangeCode, { token, user: safeUser, emailCount: total, expiry: Date.now() + 2 * 60 * 1000 });
    res.redirect(`/?auth=${exchangeCode}`);
  } catch (err) {
    console.error('OAuth Callback Error:', err.message);
    res.redirect('/?error=Sign-in+failed');
  }
};

// ── POST /api/logout ──────────────────────────────────────────────────────────
const logoutHandler = (req, res) => {
  const raw   = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      sessions.delete(String(decoded.id));
    } catch { /* token already invalid, nothing to remove */ }
  }
  res.json({ success: true });
};

module.exports = { router, callbackHandler, logoutHandler };
