'use strict';

/**
 * Shared email route utilities
 * Extracted from emailsRestructured.js to avoid duplication across route modules.
 */

function sanitizeHeader(str) {
  return String(str || '').replace(/[\r\n]/g, '').trim();
}

function escapeHtmlEntities(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFilename(str) {
  return String(str || '')
    .replace(/[\r\n]/g, '')
    .replace(/"/g, '_')
    .trim() || 'attachment';
}

const VALID_FOLDERS = new Set(['inbox', 'sent', 'drafts', 'trash', 'snoozed', 'spam', 'starred', 'important', 'all', 'archive']);

const QUERY_MAP = {
  inbox:     'in:inbox -in:trash -in:spam',
  starred:   'is:starred -in:trash -in:spam',
  snoozed:   'in:snoozed',
  important: 'is:important -in:trash -in:spam',
  spam:      'in:spam',
  sent:      'in:sent',
  trash:     'in:trash',
  all:       'in:anywhere -in:trash -in:spam',
  archive:   'label:archive -in:inbox'
};

const MAX_MAP = { inbox: 50, starred: 50, snoozed: 50, important: 50, spam: 50, sent: 50, trash: 50, all: 80, archive: 50 };

const SESSION_KEY_MAP = { inbox: 'userEmails', sent: 'sentEmails', trash: 'trashEmails', snoozed: 'snoozedEmails', spam: 'spamEmails', archive: 'archivedEmails' };

function findEmailInSession(session, id) {
  const allEmailArrays = [
    session.userEmails,
    session.sentEmails,
    session.spamEmails,
    session.trashEmails,
    session.snoozedEmails,
    session.archivedEmails
  ];
  for (const arr of allEmailArrays) {
    if (arr) {
      const email = arr.find(e => e.id === id);
      if (email) return { email, arr };
    }
  }
  return null;
}

module.exports = {
  sanitizeHeader,
  escapeHtmlEntities,
  sanitizeFilename,
  VALID_FOLDERS,
  QUERY_MAP,
  MAX_MAP,
  SESSION_KEY_MAP,
  findEmailInSession
};
