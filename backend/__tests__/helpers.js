'use strict';

/**
 * Test helpers — mock Express req/res objects and session fixtures
 */

function createMockSession(userEmails = []) {
  return {
    user: {
      id: 'test-user-123',
      email: 'test@gmail.com',
      name: 'Test User',
      picture: '',
      provider: 'google',
      accessToken: 'mock-access-token'
    },
    userEmails,
    sentEmails: [],
    spamEmails: [],
    trashEmails: [],
    snoozedEmails: [],
    archivedEmails: [],
    draftEmails: [],
    lastEmailRefresh: {},
    nextPageTokens: {}
  };
}

function createMockReq(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
    setHeader(name, value) { res.headers[name] = value; return res; },
    redirect(url) { res._redirect = url; return res; }
  };
  return res;
}

function sampleEmail(overrides = {}) {
  return {
    id: 'email-' + Date.now(),
    subject: 'Test Subject',
    from: 'sender@example.com',
    to: 'test@gmail.com',
    body: 'This is a test email body.',
    date: new Date().toISOString(),
    read: false,
    starred: false,
    labels: [],
    ...overrides
  };
}

module.exports = { createMockSession, createMockReq, createMockRes, sampleEmail };
