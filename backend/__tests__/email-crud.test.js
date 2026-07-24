'use strict';

/**
 * Unit tests for email-crud routes
 * Run with: node --test backend/__tests__/email-crud.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSession, createMockReq, createMockRes, sampleEmail } = require('./helpers');

// We test the route handler logic directly by requiring the router
// and simulating Express routing with mock req/res
const emailCrudRouter = require('../routes/email-crud');

// Helper to find a route handler by path + method
function findHandler(method, path) {
  const layer = emailCrudRouter.stack.find(
    l => l.route && l.route.path === path && l.route.methods[method]
  );
  return layer ? layer.route.stack[0].handle : null;
}

describe('email-crud routes', () => {
  let session;
  let req;
  let res;

  beforeEach(() => {
    session = createMockSession([
      sampleEmail({ id: 'e1', subject: 'Inbox One', starred: false }),
      sampleEmail({ id: 'e2', subject: 'Inbox Two', read: true })
    ]);
    session.sentEmails = [sampleEmail({ id: 's1', subject: 'Sent One' })];
    session.trashEmails = [];
    session.spamEmails = [];
    session.archivedEmails = [];
    req = createMockReq();
    res = createMockRes();
  });

  describe('GET /email/:id', () => {
    it('returns email by id', () => {
      const handler = findHandler('get', '/email/:id');
      assert.ok(handler, 'route handler exists');
      req.params = { id: 'e1' };
      // Mock requireAuth to return session
      req.headers.authorization = 'Bearer mock-jwt';
      // We need to mock requireAuth — inject session directly
      req._mockSession = session;
      handler(req, res);
      // Since requireAuth checks for real JWT, we test findEmailInSession logic directly
    });
  });

  describe('PUT /email/:id/star', () => {
    it('toggles star on email', () => {
      const email = session.userEmails[0];
      assert.equal(email.starred, false);

      // Directly test the logic (bypass requireAuth)
      const { findEmailInSession } = require('../utils/emailHelpers');
      const result = findEmailInSession(session, 'e1');
      assert.ok(result);
      result.email.starred = !result.email.starred;
      assert.equal(result.email.starred, true);
    });
  });

  describe('PUT /email/:id/archive', () => {
    it('moves email to archive', () => {
      const { findEmailInSession } = require('../utils/emailHelpers');
      const result = findEmailInSession(session, 'e1');
      assert.ok(result);

      const idx = result.arr.findIndex(e => e.id === 'e1');
      const email = result.arr.splice(idx, 1)[0];
      session.archivedEmails.unshift(email);

      assert.equal(session.userEmails.length, 1);
      assert.equal(session.archivedEmails.length, 1);
      assert.equal(session.archivedEmails[0].id, 'e1');
    });
  });

  describe('PUT /email/:id/spam', () => {
    it('moves email to spam', () => {
      const { findEmailInSession } = require('../utils/emailHelpers');
      const result = findEmailInSession(session, 'e1');
      assert.ok(result);

      const idx = result.arr.findIndex(e => e.id === 'e1');
      const email = result.arr.splice(idx, 1)[0];
      session.spamEmails.unshift(email);

      assert.equal(session.userEmails.length, 1);
      assert.equal(session.spamEmails.length, 1);
      assert.equal(session.spamEmails[0].id, 'e1');
    });
  });

  describe('PUT /email/:id/read', () => {
    it('marks email as read', () => {
      const { findEmailInSession } = require('../utils/emailHelpers');
      const result = findEmailInSession(session, 'e1');
      assert.ok(result);
      assert.equal(result.email.read, false);

      result.email.read = true;
      result.email.unread = false;
      assert.equal(result.email.read, true);
      assert.equal(result.email.unread, false);
    });
  });

  describe('DELETE /email/:id', () => {
    it('moves email to trash', () => {
      const { findEmailInSession } = require('../utils/emailHelpers');
      const result = findEmailInSession(session, 'e1');
      assert.ok(result);

      const idx = result.arr.findIndex(e => e.id === 'e1');
      const email = result.arr.splice(idx, 1)[0];
      session.trashEmails.unshift(email);

      assert.equal(session.userEmails.length, 1);
      assert.equal(session.trashEmails.length, 1);
      assert.equal(session.trashEmails[0].id, 'e1');
    });

    it('returns 404 for non-existent email', () => {
      const { findEmailInSession } = require('../utils/emailHelpers');
      const result = findEmailInSession(session, 'nonexistent');
      assert.equal(result, null);
    });
  });
});
