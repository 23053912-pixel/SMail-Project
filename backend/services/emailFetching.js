'use strict';

/**
 * Email Fetching Logic Service
 * Handles all Gmail API integration and email retrieval
 * Separates Gmail communication from business logic
 */

const { OAuth2Client } = require('google-auth-library');
const { google } = require('googleapis');
const { isGoogleVerifiedSpam } = require('../utils/session');

// ── Exponential-backoff retry for Gmail 429 errors ────────────────────────────
async function withRetry(fn, maxAttempts = 2) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.code === 429 || err.status === 429 ||
        (err.message && (
          err.message.includes('userRateLimitExceeded') ||
          err.message.includes('rateLimitExceeded')
        ));
      const isTimeout = err.message && (err.message.includes('timeout') || err.message.includes('Timeout'));
      
      if (isRateLimit && attempt < maxAttempts - 1) {
        const delay = Math.pow(2, attempt) * 500 + Math.random() * 500;
        console.log(`  Rate limit hit, retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxAttempts})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      if (isTimeout && attempt < maxAttempts - 1) {
        const delay = 100 + attempt * 200;
        console.log(`  Timeout hit, quick retry in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      throw err;
    }
  }
}

// ── Extract text / HTML body from a Gmail message payload ────────────────────
function extractBody(payload) {
  let textBody = '';
  let htmlBody = '';
  if (payload.parts && payload.parts.length > 0) {
    for (const part of payload.parts) {
      const mt = part.mimeType || '';
      if (mt === 'multipart/alternative' || mt === 'multipart/mixed' || mt === 'multipart/related') {
        const nested = extractBody(part);
        if (nested.text) textBody = nested.text;
        if (nested.html) htmlBody = nested.html;
      } else if (mt === 'text/plain' && part.body?.data) {
        textBody = Buffer.from(part.body.data, 'base64').toString('utf8');
      } else if (mt === 'text/html' && part.body?.data) {
        htmlBody = Buffer.from(part.body.data, 'base64').toString('utf8');
      }
    }
  } else if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, 'base64').toString('utf8');
    if (payload.mimeType === 'text/html') htmlBody = decoded;
    else textBody = decoded;
  }
  return { text: textBody, html: htmlBody };
}

// ── Strip HTML tags for plain-text preview ───────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Create Gmail client from access token ──────────────────────────────────────
function createGmailClient(accessToken) {
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// ── Fetch a paginated list of Gmail messages and parse full details ───────────
async function fetchGmailMessageList(gmail, query, maxResults, userEmail, startPageToken = null) {
  const results = [];
  let pageToken = startPageToken;
  const timeout = 12000;
  const maxPerFetch = Math.min(maxResults, 30);

  try {
    do {
      // Ensure maxResults is always between 1 and 50 (Gmail API limit)
      const itemsRemaining = maxResults - results.length;
      if (itemsRemaining <= 0) break;
      
      const listParams = {
        userId:     'me',
        q:          query,
        maxResults: Math.min(itemsRemaining, 50)
      };
      if (pageToken) listParams.pageToken = pageToken;

      const listRes = await Promise.race([
        withRetry(() => gmail.users.messages.list(listParams)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Gmail list timeout')), timeout))
      ]).catch(err => {
        console.log(`  Gmail list error (${query}):`, err.message);
        return null;
      });

      if (!listRes || !listRes.data.messages) break;

      const messages = listRes.data.messages;
      console.log(`  Found ${messages.length} messages for query "${query}"...`);

      for (let i = 0; i < messages.length; i += 20) {
        const batch   = messages.slice(i, i + 20);
        const detailPromises = batch.map(msg => 
          Promise.race([
            gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Message fetch timeout')), timeout))
          ])
        );
        const details = await Promise.allSettled(detailPromises);
        for (const result of details) {
          if (result.status !== 'fulfilled') continue;
          const message = result.value;
          try {
            const headers  = message.data.payload.headers || [];
            const get      = name => headers.find(h => h.name.toLowerCase() === name)?.value;
            const labels   = message.data.labelIds || [];
            const { text, html } = extractBody(message.data.payload);
            const bodyText = text || (html ? stripHtml(html) : '');
            const cleanBody = (bodyText || '(No content)')
              .replace(/<[^>]*>/g, ' ')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/\s+/g, ' ')
              .trim();

            results.push({
              id:       message.data.id,
              threadId: message.data.threadId,
              from:     get('from')    || 'Unknown Sender',
              to:       get('to')      || userEmail,
              subject:  get('subject') || '(No Subject)',
              body:     bodyText || '(No content)',
              bodyHtml: html || '',
              preview:  cleanBody.substring(0, 200),
              date:     new Date(get('date') || new Date().toISOString()),
              read:     !labels.includes('UNREAD'),
              unread:   labels.includes('UNREAD'),
              starred:  labels.includes('STARRED'),
              labels:   labels.join(','),
              inSpamFolder: labels.includes('SPAM')
            });
          } catch (e) {
            console.log(`    Error parsing message ${message.data.id}:`, e.message);
          }
        }
      }

      pageToken = listRes.data.nextPageToken;

      if (!pageToken || results.length >= maxResults) break;
    } while (true);

    return { 
      messages: results.slice(0, maxResults), 
      nextPageToken: pageToken || null 
    };
  } catch (err) {
    console.error('fetchGmailMessageList error:', err.message);
    throw err;
  }
}

// ── Fetch draft emails ────────────────────────────────────────────────────────
async function fetchDraftEmails(gmail, userEmail) {
  try {
    const res = await withRetry(() => 
      gmail.users.drafts.list({ userId: 'me', maxResults: 10 })
    );
    
    const drafts = [];
    for (const draft of (res.data.drafts || [])) {
      try {
        const draftRes = await gmail.users.drafts.get({ userId: 'me', id: draft.id });
        const message = draftRes.data.message;
        const headers = message.payload.headers || [];
        const get = name => headers.find(h => h.name.toLowerCase() === name)?.value;
        const { text, html } = extractBody(message.payload);
        drafts.push({
          id: message.id,
          from: get('from') || userEmail,
          to: get('to') || '',
          subject: get('subject') || '(No Subject)',
          body: text || stripHtml(html || ''),
          date: new Date(get('date') || new Date().toISOString()),
          read: true,
          starred: false,
          isDraft: true
        });
      } catch (e) {
        console.log(`    Error parsing draft ${draft.id}:`, e.message);
      }
    }
    return drafts;
  } catch (err) {
    console.error('fetchDraftEmails error:', err.message);
    return [];
  }
}

// ── Full initial Gmail fetch for all folders ─────────────────────────────────
async function fetchGmailEmails(session, tokensOrAccessToken) {
  const { OAuth2Client } = require('google-auth-library');
  const { google } = require('googleapis');
  const { BASE_URL } = require('../config');
  const { isGoogleVerifiedSpam } = require('../utils/session');
  const https = require('https');

  const userEmail = session.user.email;
  try {
    const accessToken = typeof tokensOrAccessToken === 'object'
      ? tokensOrAccessToken.access_token
      : tokensOrAccessToken;

    if (!accessToken) { console.error('No access token available'); return; }

    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${BASE_URL}/callback`
    );
    if (typeof tokensOrAccessToken === 'object') {
      oauth2Client.setCredentials(tokensOrAccessToken);
    } else {
      oauth2Client.setCredentials({ access_token: accessToken });
    }
    oauth2Client.requestMetadata = async () => ({ headers: { Authorization: `Bearer ${accessToken}` } });

    const gmail = google.gmail({
      version: 'v1',
      auth:    oauth2Client,
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    // Quick auth test
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      console.log(`Gmail auth OK for ${userEmail} - total: ${profile.data.messagesTotal}`);
    } catch (authErr) {
      console.error('Gmail auth test failed:', authErr.message);
      const testResult = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'gmail.googleapis.com',
          path:     '/gmail/v1/users/me/profile',
          method:   'GET',
          headers:  { Authorization: `Bearer ${accessToken}` }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', reject);
        req.end();
      });
      if (testResult.status !== 200) throw authErr;
    }

    console.log(`Fetching all Gmail emails for ${userEmail}...`);

    const fetchAllEmails = Promise.all([
      fetchGmailMessageList(gmail, 'in:inbox -in:trash -in:spam', 50, userEmail),
      fetchGmailMessageList(gmail, 'in:sent',                     30, userEmail),
      fetchGmailMessageList(gmail, 'in:trash',                    20, userEmail),
      fetchGmailMessageList(gmail, 'in:snoozed',                  20, userEmail),
      fetchGmailMessageList(gmail, 'in:spam',                     20, userEmail)
    ]);

    // Overall fetch timeout: 90 seconds
    const [inboxResult, sentResult, trashResult, snoozedResult, spamResult] = await Promise.race([
      fetchAllEmails,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Overall Gmail fetch timeout')), 90000))
    ]);
    const draftResults = await fetchDraftEmails(gmail, userEmail, 20);

    const byDate = (a, b) => new Date(b.date) - new Date(a.date);
    session.userEmails    = inboxResult.messages.sort(byDate);
    session.sentEmails    = sentResult.messages.sort(byDate);
    session.draftEmails   = draftResults.sort(byDate);
    session.trashEmails   = trashResult.messages.sort(byDate);
    session.snoozedEmails = snoozedResult.messages.sort(byDate);
    session.spamEmails    = spamResult.messages.filter(isGoogleVerifiedSpam).sort(byDate);

    session.nextPageTokens = {
      inbox:   inboxResult.nextPageToken   || null,
      sent:    sentResult.nextPageToken    || null,
      trash:   trashResult.nextPageToken   || null,
      snoozed: snoozedResult.nextPageToken || null,
      spam:    spamResult.nextPageToken    || null
    };

    console.log(
      `Loaded emails for ${userEmail}:`,
      `inbox=${session.userEmails.length}`,
      `sent=${session.sentEmails.length}`,
      `drafts=${session.draftEmails.length}`,
      `trash=${session.trashEmails.length}`
    );
  } catch (err) {
    console.error(`Gmail API error for ${userEmail}:`, err.message);
    session.userEmails = session.sentEmails = session.draftEmails =
      session.trashEmails = session.snoozedEmails = session.spamEmails = [];
  }
}

module.exports = {
  createGmailClient,
  fetchGmailMessageList,
  fetchDraftEmails,
  fetchGmailEmails,
  extractBody,
  stripHtml,
  withRetry
};
