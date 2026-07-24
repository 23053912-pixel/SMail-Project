'use strict';

/**
 * Unit tests for emailHelpers utilities
 * Run with: node --test backend/__tests__/emailHelpers.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeHeader,
  escapeHtmlEntities,
  sanitizeFilename,
  findEmailInSession
} = require('../utils/emailHelpers');

// ── sanitizeHeader ───────────────────────────────────────────────────────────

describe('sanitizeHeader', () => {
  it('strips \\r\\n characters', () => {
    assert.equal(sanitizeHeader('Hello\r\nSubject: BCC evil@hacker.com'), 'HelloSubject: BCC evil@hacker.com');
  });

  it('strips newlines from to field', () => {
    assert.equal(sanitizeHeader('user@example.com\nBCC: spam@evil.com'), 'user@example.comBCC: spam@evil.com');
  });

  it('trims whitespace', () => {
    assert.equal(sanitizeHeader('  hello  '), 'hello');
  });

  it('handles null/undefined', () => {
    assert.equal(sanitizeHeader(null), '');
    assert.equal(sanitizeHeader(undefined), '');
  });

  it('converts non-string to string', () => {
    assert.equal(sanitizeHeader(123), '123');
  });

  it('passes through clean input unchanged', () => {
    assert.equal(sanitizeHeader('Normal Subject Line'), 'Normal Subject Line');
  });
});

// ── escapeHtmlEntities ───────────────────────────────────────────────────────

describe('escapeHtmlEntities', () => {
  it('escapes ampersands', () => {
    assert.equal(escapeHtmlEntities('A & B'), 'A &amp; B');
  });

  it('escapes angle brackets', () => {
    assert.equal(escapeHtmlEntities('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes double quotes', () => {
    assert.equal(escapeHtmlEntities('She said "hello"'), 'She said &quot;hello&quot;');
  });

  it('handles null/undefined', () => {
    assert.equal(escapeHtmlEntities(null), '');
    assert.equal(escapeHtmlEntities(undefined), '');
  });

  it('escapes all special chars together', () => {
    assert.equal(escapeHtmlEntities('<a&b"c">'), '&lt;a&amp;b&quot;c&quot;&gt;');
  });

  it('leaves clean text untouched', () => {
    assert.equal(escapeHtmlEntities('Hello World'), 'Hello World');
  });
});

// ── sanitizeFilename ─────────────────────────────────────────────────────────

describe('sanitizeFilename', () => {
  it('strips newlines from filename', () => {
    assert.equal(sanitizeFilename('file\r\nname.pdf'), 'filename.pdf');
  });

  it('replaces double quotes with underscore', () => {
    assert.equal(sanitizeFilename('my"file.txt'), 'my_file.txt');
  });

  it('trims whitespace', () => {
    assert.equal(sanitizeFilename('  file.txt  '), 'file.txt');
  });

  it('returns default for empty input', () => {
    assert.equal(sanitizeFilename(''), 'attachment');
    assert.equal(sanitizeFilename(null), 'attachment');
    assert.equal(sanitizeFilename(undefined), 'attachment');
  });

  it('preserves normal filenames', () => {
    assert.equal(sanitizeFilename('report-2024.pdf'), 'report-2024.pdf');
  });
});

// ── findEmailInSession ──────────────────────────────────────────────────────

describe('findEmailInSession', () => {
  const session = {
    userEmails: [{ id: '1', subject: 'Inbox Email' }],
    sentEmails: [{ id: '2', subject: 'Sent Email' }],
    spamEmails: [],
    trashEmails: [],
    snoozedEmails: [],
    archivedEmails: []
  };

  it('finds email in userEmails', () => {
    const result = findEmailInSession(session, '1');
    assert.ok(result);
    assert.equal(result.email.subject, 'Inbox Email');
    assert.equal(result.arr, session.userEmails);
  });

  it('finds email in sentEmails', () => {
    const result = findEmailInSession(session, '2');
    assert.ok(result);
    assert.equal(result.email.subject, 'Sent Email');
  });

  it('returns null for non-existent email', () => {
    const result = findEmailInSession(session, '999');
    assert.equal(result, null);
  });

  it('handles missing arrays gracefully', () => {
    const sparseSession = { userEmails: [{ id: '1' }] };
    const result = findEmailInSession(sparseSession, '1');
    assert.ok(result);
  });
});
