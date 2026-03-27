'use strict';

// Per-user in-memory session store.  Key = Google user ID (string).
// Each entry: { user, userEmails, sentEmails, draftEmails, trashEmails,
//               snoozedEmails, spamEmails, archivedEmails, nextPageTokens, lastActive }
const sessions = new Map();

function getSession(userId) {
  return sessions.get(String(userId)) || null;
}

function upsertSession(user) {
  const key = String(user.id);
  if (!sessions.has(key)) {
    sessions.set(key, {
      user,
      userEmails:     [],
      sentEmails:     [],
      draftEmails:    [],
      trashEmails:    [],
      snoozedEmails:  [],
      spamEmails:     [],
      archivedEmails: [],
      nextPageTokens: {},
      lastActive:     Date.now()
    });
  } else {
    const s      = sessions.get(key);
    s.user       = { ...s.user, ...user }; // keeps accessToken fresh
    s.lastActive = Date.now();
  }
  return sessions.get(key);
}

// Purge sessions idle for more than 8 hours (prevents memory leak)
setInterval(() => {
  const cutoff = Date.now() - 8 * 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.lastActive < cutoff) sessions.delete(id);
  }
}, 60 * 60 * 1000);

function getAllEmailsDeduped(session) {
  const merged = [
    ...session.userEmails,
    ...session.sentEmails,
    ...session.draftEmails,
    ...session.trashEmails,
    ...session.snoozedEmails,
    ...session.spamEmails,
    ...(session.archivedEmails || [])
  ];
  const byId = new Map();
  for (const email of merged) {
    if (!byId.has(email.id)) byId.set(email.id, email);
  }
  return Array.from(byId.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function isGoogleVerifiedSpam(email) {
  return Array.isArray(email?.labels) && email.labels.includes('SPAM');
}

function getCachedFolder(session, folder) {
  switch (folder) {
    case 'inbox':     return session.userEmails;
    case 'sent':      return session.sentEmails;
    case 'drafts':    return session.draftEmails;
    case 'trash':     return session.trashEmails;
    case 'snoozed':   return session.snoozedEmails;
    case 'spam':      return session.spamEmails.filter(isGoogleVerifiedSpam);
    case 'starred':   return getAllEmailsDeduped(session).filter(
                        e => e.starred || (Array.isArray(e.labels) && e.labels.includes('STARRED'))
                      );
    case 'important': return getAllEmailsDeduped(session).filter(
                        e => Array.isArray(e.labels) && e.labels.includes('IMPORTANT')
                      );
    case 'archive':   return session.archivedEmails || [];
    case 'all':       return getAllEmailsDeduped(session);
    default:          return session.userEmails;
  }
}

module.exports = {
  sessions,
  getSession,
  upsertSession,
  getAllEmailsDeduped,
  isGoogleVerifiedSpam,
  getCachedFolder
};
