// ============ State ============
let currentUser = null;
let currentFolder = 'inbox';
let currentEmail = null;
let emails = [];
let displayedCount = 25; // emails shown at a time; grows when user clicks Load More
let hasMoreOnServer = false; // true when Gmail has more pages beyond what's loaded
let currentPage = 0;        // tracked at module level so folder changes reset it correctly
let threatFilterActive = false; // true when showing only flagged/threat emails
let autoSpamSweepInProgress = false;
let lastAutoSpamSweepAt = 0;
let autoSpamSensitivity = localStorage.getItem('autoSpamSensitivity') || 'normal';
let autoRefreshTimer = null; // Timer for automatic inbox refresh
let lastPageVisibility = 'visible'; // Track when user switches tabs

// ============ DOM Elements ============
const loginScreen = document.getElementById('loginScreen');
const mainApp = document.getElementById('mainApp');
const logoutBtn = document.getElementById('logoutBtn');
const userEmail = document.getElementById('userEmail');
const composeBtn = document.getElementById('composeBtn');
const closeComposeBtn = document.getElementById('closeComposeBtn');
const composeModal = document.getElementById('composeModal');
const composeForm = document.getElementById('composeForm');
const cancelBtn = document.getElementById('cancelBtn');
const draftBtn = document.getElementById('draftBtn');
const emailList = document.getElementById('emailList');
const emailViewer = document.getElementById('emailViewer');
const emptyState = document.getElementById('emptyState');
const backBtn = document.getElementById('backBtn');
const deleteBtn = document.getElementById('deleteBtn');
const starBtn = document.getElementById('starBtn');
const replyBtn = document.getElementById('replyBtn');
const searchInput = document.getElementById('searchInput');
const folderBtns = document.querySelectorAll('.folder-btn');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const refreshBtn = document.getElementById('refreshBtn');
const userAvatar = document.getElementById('userAvatar');
const userMenu = document.getElementById('userMenu');
const userDropdown = document.getElementById('userDropdown');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');
const emailListContainer = document.getElementById('emailListContainer');
const loadingSpinner = document.getElementById('loadingSpinner');
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');
const headerLogo = document.getElementById('headerLogo');
const headerBrand = document.getElementById('headerBrand');
const settingsBtn = document.getElementById('settingsBtn');

// Avatar color palette
const avatarColors = ['#1a73e8','#ea4335','#34a853','#fbbc04','#ff6d01','#46bdc6','#7b1fa2','#c2185b'];
function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
function getInitial(name) {
  if (!name) return '?';
  const clean = name.replace(/<.*?>/g, '').replace(/"/g, '').trim();
  return (clean[0] || '?').toUpperCase();
}

// HTML-escape utility — prevents XSS when inserting user-controlled strings into innerHTML
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function applyTheme(theme) {
  const targetTheme = theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', targetTheme === 'light');
  localStorage.setItem('uiTheme', targetTheme);

  if (settingsBtn) {
    const icon = settingsBtn.querySelector('.material-icons-outlined');
    settingsBtn.title = targetTheme === 'light' ? 'Switch to Dark Pro' : 'Switch to Light Pro';
    settingsBtn.setAttribute('aria-label', settingsBtn.title);
    if (icon) icon.textContent = targetTheme === 'light' ? 'dark_mode' : 'light_mode';
  }
}

function toggleTheme() {
  const isLight = document.body.classList.contains('theme-light');
  applyTheme(isLight ? 'dark' : 'light');
}

function normalizeSpamSensitivity(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'strict' || v === 'lenient' || v === 'normal') return v;
  return 'normal';
}

function getSpamSensitivityLabel(mode) {
  if (mode === 'strict') return 'Strict';
  if (mode === 'lenient') return 'Lenient';
  return 'Normal';
}

function updateSpamSensitivityUI() {
  autoSpamSensitivity = normalizeSpamSensitivity(autoSpamSensitivity);
  const btn = document.getElementById('spamSensitivityBtn');
  const icon = document.getElementById('spamSensitivityIcon');
  const label = getSpamSensitivityLabel(autoSpamSensitivity);
  const title = `Spam sensitivity: ${label} (click to change)`;
  if (btn) {
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }
  if (icon) {
    icon.textContent = autoSpamSensitivity === 'strict'
      ? 'verified_user'
      : autoSpamSensitivity === 'lenient'
        ? 'shield'
        : 'gpp_good';
  }
}

function cycleSpamSensitivity() {
  const next = autoSpamSensitivity === 'strict'
    ? 'normal'
    : autoSpamSensitivity === 'normal'
      ? 'lenient'
      : 'strict';
  autoSpamSensitivity = next;
  localStorage.setItem('autoSpamSensitivity', autoSpamSensitivity);
  updateSpamSensitivityUI();
  showToast(`Spam auto-scan set to ${getSpamSensitivityLabel(autoSpamSensitivity)}`, 'warning', 3500);
}

// ============ Toast ============
function showToast(msg, type = 'success', duration) {
  const icon = toast.querySelector('.toast-icon');
  if (type === 'error') {
    icon.textContent = 'error';
    icon.style.color = '#f28b82';
  } else if (type === 'warning') {
    icon.textContent = 'warning';
    icon.style.color = '#fdd663';
  } else {
    icon.textContent = 'check_circle';
    icon.style.color = '#81c995';
  }
  toastMessage.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  // Warnings/errors stay for 8s; normal success stays for 3s
  const delay = duration ?? (type === 'success' ? 3000 : 8000);
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, delay);
}

// ============ Init ============
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('uiTheme') || 'dark';
  applyTheme(savedTheme);
  autoSpamSensitivity = normalizeSpamSensitivity(localStorage.getItem('autoSpamSensitivity') || 'normal');
  updateSpamSensitivityUI();

  if (googleSignInBtn) googleSignInBtn.addEventListener('click', handleGoogleSignIn);
  if (settingsBtn) settingsBtn.addEventListener('click', toggleTheme);
  logoutBtn.addEventListener('click', handleLogout);
  composeBtn.addEventListener('click', openCompose);
  closeComposeBtn.addEventListener('click', closeCompose);
  cancelBtn.addEventListener('click', closeCompose);
  composeForm.addEventListener('submit', handleSendEmail);
  draftBtn.addEventListener('click', handleSaveDraft);
  backBtn.addEventListener('click', backToList);
  deleteBtn.addEventListener('click', handleDeleteEmail);
  starBtn.addEventListener('click', handleToggleStar);
  if (replyBtn) replyBtn.addEventListener('click', handleReply);
  let _searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(handleSearch, 300);
  });
  if (refreshBtn) refreshBtn.addEventListener('click', refreshAllEmails);
  const refreshBtn2 = document.getElementById('refreshBtn2');
  if (refreshBtn2) refreshBtn2.addEventListener('click', refreshAllEmails);
  const spamSensitivityBtn = document.getElementById('spamSensitivityBtn');
  if (spamSensitivityBtn) spamSensitivityBtn.addEventListener('click', cycleSpamSensitivity);
  const securityAlertDismiss = document.getElementById('securityAlertDismiss');
  if (securityAlertDismiss) securityAlertDismiss.addEventListener('click', () => {
    const bar = document.getElementById('securityAlertBar');
    if (bar) bar.classList.add('hidden');
  });
  const viewThreatBtn = document.getElementById('viewThreatBtn');
  if (viewThreatBtn) viewThreatBtn.addEventListener('click', () => {
    threatFilterActive = true;
    renderEmailList();
  });
  const clearThreatFilter = document.getElementById('clearThreatFilter');
  if (clearThreatFilter) clearThreatFilter.addEventListener('click', () => {
    threatFilterActive = false;
    renderEmailList();
    updateEmailCount();
  });
  if (headerLogo) headerLogo.addEventListener('click', refreshAllEmails);
  if (headerBrand) headerBrand.addEventListener('click', refreshAllEmails);
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => {
      sidebar.classList.toggle('sidebar-hidden');
    });
  }

  // Bind ALL folder buttons (including dynamically added ones)
  document.querySelectorAll('.folder-btn:not(.more-toggle)').forEach(btn => {
    btn.addEventListener('click', handleFolderChange);
  });

  // More toggle in sidebar
  const moreToggle = document.getElementById('moreToggle');
  const moreFolders = document.getElementById('moreFolders');
  if (moreToggle && moreFolders) {
    moreToggle.addEventListener('click', () => {
      moreFolders.classList.toggle('hidden');
      moreToggle.classList.toggle('expanded');
    });
  }

  // Forward button
  const forwardBtn = document.getElementById('forwardBtn');
  if (forwardBtn) forwardBtn.addEventListener('click', handleForward);
  const archiveBtn     = document.getElementById('archiveBtn');
  const reportSpamBtn  = document.getElementById('reportSpamBtn');
  const markUnreadBtn  = document.getElementById('markUnreadBtn');
  const snoozeBtn      = document.getElementById('snoozeBtn');
  const moveToBtn      = document.getElementById('moveToBtn');
  const labelBtn_      = document.getElementById('labelBtn');

  if (archiveBtn) archiveBtn.addEventListener('click', async () => {
    if (!currentEmail) return;
    const jwtToken = localStorage.getItem('jwtToken');
    const headers  = jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {};
    try {
      const res = await fetch(`/api/email/${currentEmail.id}/archive`, { method: 'PUT', headers });
      if (res.ok) {
        emails = emails.filter(e => e.id !== currentEmail.id);
        showToast('Archived');
        backToList();
        updateUnreadCount();
        updateEmailCount();
      } else {
        showToast('Failed to archive', 'error');
      }
    } catch { showToast('Failed to archive', 'error'); }
  });
  if (reportSpamBtn) reportSpamBtn.addEventListener('click', async () => {
    if (!currentEmail) return;
    const jwtToken = localStorage.getItem('jwtToken');
    const headers  = jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {};
    try {
      await fetch(`/api/email/${currentEmail.id}/spam`, { method: 'PUT', headers });
      emails = emails.filter(e => e.id !== currentEmail.id);
      showToast('Reported as spam');
      backToList();
    } catch { showToast('Failed to report spam', 'error'); }
  });
  if (markUnreadBtn) markUnreadBtn.addEventListener('click', async () => {
    if (!currentEmail) return;
    const jwtToken = localStorage.getItem('jwtToken');
    const headers  = jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {};
    try {
      await fetch(`/api/email/${currentEmail.id}/read`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: false })
      });
    } catch { /* silent — update locally anyway */ }
    currentEmail.read = false;
    currentEmail.unread = true;
    const localEmail = emails.find(e => e.id === currentEmail.id);
    if (localEmail) { localEmail.read = false; localEmail.unread = true; }
    showToast('Marked as unread');
    renderEmailList();
    updateUnreadCount();
  });
  if (snoozeBtn) snoozeBtn.addEventListener('click', () => {
    showToast('Snooze coming soon');
  });
  if (moveToBtn) moveToBtn.addEventListener('click', () => {
    showToast('Move coming soon');
  });
  if (labelBtn_) labelBtn_.addEventListener('click', () => {
    showToast('Labels coming soon');
  });

  // ── Compose minimize / expand ────────────────────────────────────────
  const minimizeComposeBtn = document.getElementById('minimizeComposeBtn');
  const expandComposeBtn   = document.getElementById('expandComposeBtn');
  const composeWindow      = document.querySelector('.compose-window');

  if (minimizeComposeBtn && composeWindow) {
    minimizeComposeBtn.addEventListener('click', () => {
      composeWindow.classList.toggle('compose-minimized');
      const icon = minimizeComposeBtn.querySelector('.material-icons-outlined');
      if (icon) icon.textContent = composeWindow.classList.contains('compose-minimized') ? 'expand_less' : 'minimize';
    });
  }
  if (expandComposeBtn && composeWindow) {
    expandComposeBtn.addEventListener('click', () => {
      composeWindow.classList.toggle('compose-expanded');
      const icon = expandComposeBtn.querySelector('.material-icons-outlined');
      if (icon) icon.textContent = composeWindow.classList.contains('compose-expanded') ? 'close_fullscreen' : 'open_in_full';
    });
  }

  // ── Toolbar pagination (Newer / Older) ───────────────────────────────
  const newerBtn = document.getElementById('newerBtn');
  const olderBtn = document.getElementById('olderBtn');
  const PAGE_SIZE = 25;

  if (newerBtn) newerBtn.addEventListener('click', () => {
    if (currentPage <= 0) return;
    currentPage--;
    displayedCount = (currentPage + 1) * PAGE_SIZE;
    renderEmailList();
    updateEmailCount();
    document.getElementById('emailList').scrollTop = 0;
  });
  if (olderBtn) olderBtn.addEventListener('click', () => {
    const maxPage = Math.ceil(emails.length / PAGE_SIZE) - 1;
    if (currentPage >= maxPage) return;
    currentPage++;
    displayedCount = (currentPage + 1) * PAGE_SIZE;
    renderEmailList();
    updateEmailCount();
    document.getElementById('emailList').scrollTop = 0;
  });

  // ── Select All checkbox ──────────────────────────────────────────────
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
      document.querySelectorAll('.email-item-checkbox').forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
      });
    });
  }

  // ── Support button ───────────────────────────────────────────────────
  const supportBtn = document.getElementById('supportBtn');
  if (supportBtn) supportBtn.addEventListener('click', () => {
    showToast('For help, check the README or project docs');
  });

  // ── Apps button ──────────────────────────────────────────────────────
  const appsBtn = document.getElementById('appsBtn');
  if (appsBtn) appsBtn.addEventListener('click', () => {
    showToast('Google Apps shortcut — configure in settings');
  });

  // User menu toggle
  if (userAvatar) {
    userAvatar.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('hidden');
    });
  }
  document.addEventListener('click', () => {
    if (userDropdown) userDropdown.classList.add('hidden');
  });

  initComposeToolbar();

  // ── Auto-refresh inbox when user returns to browser tab ────────────────────
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lastPageVisibility = 'hidden';
      // Stop auto-refresh timer when tab is not visible
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    } else {
      lastPageVisibility = 'visible';
      // Refresh immediately when user returns
      if (currentFolder === 'inbox' && currentUser) {
        loadEmails();
      }
      // Restart auto-refresh timer
      setupAutoRefreshTimer();
    }
  });

  // Check saved session
  const savedUser = localStorage.getItem('currentUser');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    showMainApp();
    loadEmails();
    setupAutoRefreshTimer();
  }

  checkOAuthCallback();
});

// ── Setup auto-refresh timer for inbox ───────────────────────────────────────
function setupAutoRefreshTimer() {
  // Clear existing timer
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  
  // Auto-refresh inbox every 60 seconds (if not hidden)
  autoRefreshTimer = setInterval(() => {
    if (currentFolder === 'inbox' && currentUser && !document.hidden) {
      loadEmails();
    }
  }, 60000); // 60 seconds
}

// ============ OAuth ============
function checkOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const authCode = params.get('auth');   // one-time exchange code
  const errorMsg = params.get('error');

  if (errorMsg) {
    window.history.replaceState({}, document.title, '/');
    showLoginMessage('Google Sign-In error: ' + errorMsg, 'error');
    return;
  }

  if (authCode) {
    // Clear the code from the URL immediately so it never lingers in browser history
    window.history.replaceState({}, document.title, '/');
    // Exchange the one-time code for the JWT (token never travels in the URL)
    fetch('/api/auth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: authCode })
    })
      .then(r => r.json())
      .then(data => {
        if (!data.token || !data.user) throw new Error('Invalid exchange response');
        const safeUser = { id: data.user.id, email: data.user.email, name: data.user.name, picture: data.user.picture, provider: data.user.provider };
        currentUser = safeUser;
        localStorage.setItem('currentUser', JSON.stringify(safeUser));
        localStorage.setItem('jwtToken', data.token);
        showMainApp();
        loadEmails();
        showToast(`Welcome, ${safeUser.name}! Loaded ${data.emailCount || '?'} emails`);
      })
      .catch(e => {
        console.error('Error processing OAuth callback:', e);
        showLoginMessage('Sign-in failed. Please try again.', 'error');
      });
  }
}

async function handleGoogleSignIn() {
  try {
    showLoginMessage('Redirecting to Google Sign-In...', 'info');
    const response = await fetch('/api/auth/google-url');
    if (!response.ok) throw new Error(`Failed to get sign-in URL (${response.status})`);
    const data = await response.json();
    if (!data.url) {
      showLoginMessage('Google Sign-In not configured: ' + (data.error || 'No URL'), 'error');
      return;
    }
    window.location.href = data.url;
  } catch (error) {
    showLoginMessage('Sign-in error: ' + error.message, 'error');
  }
}

function showLoginMessage(message, type) {
  const el = document.getElementById('loginMessage');
  el.textContent = message;
  el.className = `login-message ${type}`;
  el.classList.remove('hidden');
  if (type === 'error') setTimeout(() => el.classList.add('hidden'), 4000);
}

// ============ Auth ============
async function handleLogout() {
  try {
    const jwtToken = localStorage.getItem('jwtToken');
    await fetch('/api/logout', {
      method: 'POST',
      headers: jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {}
    });
  } catch (e) {}
  
  // Clear auto-refresh timer
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  
  localStorage.removeItem('currentUser');
  localStorage.removeItem('jwtToken');
  currentUser = null;
  currentEmail = null;
  showLoginScreen();
}

function showLoginScreen() {
  loginScreen.classList.remove('hidden');
  mainApp.classList.add('hidden');
}

function showMainApp() {
  loginScreen.classList.add('hidden');
  mainApp.classList.remove('hidden');

  // Set user info
  if (userEmail) userEmail.textContent = currentUser.email;
  const initial = getInitial(currentUser.name || currentUser.email);
  if (userAvatar) userAvatar.textContent = initial;

  const dropdownAvatar = document.getElementById('dropdownAvatar');
  const dropdownName = document.getElementById('dropdownName');
  const dropdownEmail = document.getElementById('dropdownEmail');
  if (dropdownAvatar) dropdownAvatar.textContent = initial;
  if (dropdownName) dropdownName.textContent = currentUser.name || '';
  if (dropdownEmail) dropdownEmail.textContent = currentUser.email || '';

  showEmailList();
}

function showEmailList() {
  emailListContainer.classList.remove('hidden');
  emailViewer.classList.add('hidden');
}

function showEmailViewer() {
  emailListContainer.classList.add('hidden');
  emailViewer.classList.remove('hidden');
}

// ============ Load Emails ============
async function loadEmails() {
  try {
    // Show loading spinner
    if (loadingSpinner) loadingSpinner.classList.remove('hidden');
    emailList.innerHTML = '';
    emptyState.classList.add('hidden');

    const jwtToken = localStorage.getItem('jwtToken');
    const headers = {};
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await fetch(`/api/emails/${currentFolder}`, { headers });
    if (response.status === 401) {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('jwtToken');
      currentUser = null;
      showLoginScreen();
      showLoginMessage('Session expired. Please sign in again.', 'error');
      return;
    }
    const data = await response.json();
    if (Array.isArray(data)) {
      emails = data;
      hasMoreOnServer = false;
    } else {
      emails = Array.isArray(data.emails) ? data.emails : [];
      hasMoreOnServer = !!data.hasMore;
    }
    displayedCount = 25;

    // Hide loading spinner
    if (loadingSpinner) loadingSpinner.classList.add('hidden');

    renderEmailList();
    updateUnreadCount();
    showEmailList();

    if (currentFolder === 'inbox' && emails.length > 0) {
      // Delay auto-spam sweep to avoid rate limit burst
      setTimeout(() => runAutoSpamSweep(), 600);
    }

    // Update folder title in sidebar
    updateEmailCount();

    // Auto-scan inbox on load — runs in background with optimized concurrency to avoid rate limiting
    if (currentFolder === 'inbox' && emails.length > 0) {
      setTimeout(() => {
        scanVisibleEmails(emails, {
          limit: Math.min(emails.length, 20),
          concurrency: 4,
          onComplete: ({ threats, critical }) => {
            const badge = document.getElementById('threatBadge');
            const alertBar = document.getElementById('securityAlertBar');
            const alertMsg = document.getElementById('securityAlertMsg');
            if (threats > 0) {
              if (badge) {
                badge.textContent = `⚠ ${threats}`;
                badge.classList.remove('hidden');
              }
              const msg = critical > 0
                ? `⚠️ ${critical} high-risk email${critical > 1 ? 's' : ''} found in inbox!`
                : `🔵 ${threats} suspicious email${threats > 1 ? 's' : ''} detected in inbox`;
              showToast(msg, critical > 0 ? 'error' : 'warning');
              // Also show persistent bar above the email list
              if (alertBar && alertMsg) {
                alertMsg.textContent = critical > 0
                  ? `⚠️ ${critical} high-risk + ${threats - critical} suspicious email${threats > 1 ? 's' : ''} in your inbox — scroll through and check flagged items`
                  : `🔵 ${threats} suspicious email${threats > 1 ? 's' : ''} detected — look for the warning badge on individual emails`;
                alertBar.classList.remove('hidden');
                alertBar.className = `security-alert-bar ${critical > 0 ? 'critical' : 'warning'}`;
              }
            } else {
              if (badge) badge.classList.add('hidden');
              if (alertBar) alertBar.classList.add('hidden');
            }
          }
        });
      }, 1500);
    }

  } catch (error) {
    console.error('Error loading emails:', error);
    if (loadingSpinner) loadingSpinner.classList.add('hidden');
    showToast('Failed to load emails. Please try refreshing.', 'error');
  }
}

async function refreshAllEmails() {
  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const headers = {};
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await fetch('/api/emails/refresh', {
      method: 'POST',
      headers
    });

    if (response.status === 401) {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('jwtToken');
      currentUser = null;
      showLoginScreen();
      showLoginMessage('Session expired. Please sign in again.', 'error');
      return;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Refresh failed');
    }

    await loadEmails();
    showToast('All mails refreshed');
  } catch (error) {
    console.error('Error refreshing emails:', error);
    showToast(error.message || 'Failed to refresh mails', 'error');
  }
}

async function runAutoSpamSweep() {
  // Avoid repeated sweep calls while user rapidly refreshes/navigates inbox.
  if (autoSpamSweepInProgress) return;
  if (Date.now() - lastAutoSpamSweepAt < 15_000) return;
  autoSpamSweepInProgress = true;
  lastAutoSpamSweepAt = Date.now();

  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const headers = jwtToken
      ? { 'Authorization': `Bearer ${jwtToken}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };

    const response = await fetch('/api/emails/inbox/auto-spam-scan', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sensitivity: autoSpamSensitivity })
    });
    if (!response.ok) return;

    const data = await response.json();
    if (!data.moved || data.moved <= 0 || !Array.isArray(data.movedIds)) return;

    const movedSet = new Set(data.movedIds);
    emails = emails.filter(e => !movedSet.has(e.id));
    renderEmailList();
    updateUnreadCount();
    updateEmailCount();
    showToast(`Auto-protected: moved ${data.moved} spam email${data.moved > 1 ? 's' : ''} to Spam`, 'warning', 5000);
  } catch {
    // Silent fallback; user can still manually report spam.
  } finally {
    autoSpamSweepInProgress = false;
  }
}
// ============ Render Email List ============
function renderEmailList() {
  emailList.innerHTML = '';

  // When threat filter is active, show only emails flagged in scamCache
  let source = emails;
  if (threatFilterActive) {
    source = emails.filter(e => {
      const r = scamCache[e.id];
      return r && r.level !== 'safe';
    });
    const strip = document.getElementById('threatFilterStrip');
    const countEl = document.getElementById('threatFilterCount');
    if (strip) strip.classList.remove('hidden');
    if (countEl) countEl.textContent = source.length === 0
      ? 'No flagged emails found'
      : `Showing ${source.length} flagged email${source.length > 1 ? 's' : ''}`;
  } else {
    const strip = document.getElementById('threatFilterStrip');
    if (strip) strip.classList.add('hidden');
  }

  if (source.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const toShow = threatFilterActive ? source : source.slice(0, displayedCount);
  toShow.forEach(email => {
    const isUnread = email.unread || email.read === false;
    const div = document.createElement('div');
    div.className = `email-item${isUnread ? ' unread' : ''}${email.id === currentEmail?.id ? ' selected' : ''}`;

    const fromName = (email.from || '').replace(/<.*?>/g, '').replace(/"/g, '').trim() || 'Unknown';
    const subject = email.subject || '(No Subject)';
    const snippet = email.preview || email.snippet || (email.body ? email.body.substring(0, 120) : '');

    div.innerHTML = `
      <input type="checkbox" class="email-item-checkbox" onclick="event.stopPropagation()">
      <span class="material-icons-outlined email-item-star${email.starred ? ' starred' : ''}" data-id="${escHtml(email.id)}">${email.starred ? 'star' : 'star_border'}</span>
      <span class="email-item-from">${escHtml(fromName)}</span>
      <div class="email-item-content">
        <span class="email-item-subject">${escHtml(subject)}</span>
        <span class="email-item-separator"> - </span>
        <span class="email-item-snippet">${escHtml(snippet)}</span>
      </div>
      <span class="scam-list-badge hidden" data-email-id="${escHtml(email.id)}" title="Scam warning"></span>
      <span class="email-item-date">${escHtml(formatDate(email.date))}</span>
      <div class="email-item-hover-actions">
        <button class="hover-action-btn" title="Archive" data-action="archive"><span class="material-icons-outlined">archive</span></button>
        <button class="hover-action-btn" title="Delete" data-action="delete"><span class="material-icons-outlined">delete</span></button>
        <button class="hover-action-btn" title="Mark as read" data-action="read"><span class="material-icons-outlined">drafts</span></button>
        <button class="hover-action-btn" title="Snooze" data-action="snooze"><span class="material-icons-outlined">schedule</span></button>
      </div>
    `;

    // Star click
    const starEl = div.querySelector('.email-item-star');
    starEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const jwtToken = localStorage.getItem('jwtToken');
        const res = await fetch(`/api/email/${email.id}/star`, {
          method: 'PUT',
          headers: jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {}
        });
        const data = await res.json();
        email.starred = data.starred;
        starEl.textContent = email.starred ? 'star' : 'star_border';
        starEl.classList.toggle('starred', email.starred);
        showToast(email.starred ? 'Starred' : 'Unstarred');
      } catch (err) { console.error(err); }
    });

    // Hover action buttons
    div.querySelectorAll('.hover-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'delete') {
          handleQuickDelete(email.id);
        } else if (action === 'archive') {
          const jwtToken = localStorage.getItem('jwtToken');
          const headers  = jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {};
          fetch(`/api/email/${email.id}/archive`, { method: 'PUT', headers })
            .then(r => {
              if (r.ok) {
                emails = emails.filter(e => e.id !== email.id);
                renderEmailList();
                showToast('Archived');
              } else {
                showToast('Failed to archive', 'error');
              }
            })
            .catch(() => showToast('Failed to archive', 'error'));
        } else if (action === 'read') {
          showToast('Marked as read');
        } else if (action === 'snooze') {
          showToast('Snoozed');
        }
      });
    });

    div.addEventListener('click', () => openEmail(email.id));
    emailList.appendChild(div);
  });

  // Load More button
  const oldLoadMore = document.getElementById('loadMoreBtn');
  if (oldLoadMore) oldLoadMore.remove();

  const allLocalShown = displayedCount >= emails.length;
  if (!threatFilterActive && (!allLocalShown || hasMoreOnServer)) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'loadMoreBtn';
    loadMoreBtn.className = 'load-more-btn';

    if (!allLocalShown) {
      // More local emails to show
      const remaining = emails.length - displayedCount;
      loadMoreBtn.textContent = `Show ${Math.min(25, remaining)} more`;
      loadMoreBtn.addEventListener('click', () => {
        displayedCount += 25;
        renderEmailList();
        updateEmailCount();
      });
    } else {
      // Need to fetch next page from Gmail
      loadMoreBtn.textContent = 'Load more from Gmail...';
      loadMoreBtn.addEventListener('click', async () => {
        loadMoreBtn.textContent = 'Loading...';
        loadMoreBtn.disabled = true;
        try {
          const jwtToken = localStorage.getItem('jwtToken');
          const headers = jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {};
          const res = await fetch(`/api/emails/${currentFolder}/more`, { headers });
          if (!res.ok) throw new Error('Server error');
          const data = await res.json();
          const newEmails = Array.isArray(data.emails) ? data.emails : [];
          hasMoreOnServer = !!data.hasMore;
          emails = [...emails, ...newEmails];
          displayedCount += newEmails.length || 25;
          renderEmailList();
          updateEmailCount();
          updateUnreadCount();
        } catch (err) {
          showToast('Failed to load more emails', 'error');
          loadMoreBtn.textContent = 'Load more from Gmail...';
          loadMoreBtn.disabled = false;
        }
      });
    }

    emailList.appendChild(loadMoreBtn);
  }

  // Scan visible emails for scam badges in background
  scanVisibleEmails(toShow);
}

// ============ Open Email ============
async function openEmail(id) {
  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const headers = {};
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await fetch(`/api/email/${id}`, { headers });
    currentEmail = await response.json();

    // Mark read in local array immediately so the bold/unread style updates
    const localEmail = emails.find(e => e.id === id);
    if (localEmail) { localEmail.read = true; localEmail.unread = false; }

    document.getElementById('emailSubject').textContent = currentEmail.subject || '(No Subject)';
    document.getElementById('emailFrom').textContent = currentEmail.from || '';
    document.getElementById('emailTo').textContent = currentEmail.to || '';
    document.getElementById('emailDate').textContent = formatDate(currentEmail.date);

    // Sender avatar
    const fromName = (currentEmail.from || '').replace(/<.*?>/g, '').replace(/"/g, '').trim();
    const senderAvatarEl = document.getElementById('senderAvatar');
    if (senderAvatarEl) {
      senderAvatarEl.textContent = getInitial(fromName);
      senderAvatarEl.style.background = getAvatarColor(fromName);
    }

    // Body — render HTML in a sandboxed iframe to prevent XSS
    const emailBodyEl = document.getElementById('emailBody');
    emailBodyEl.innerHTML = '';
    if (currentEmail.bodyHtml) {
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-same-origin';
      iframe.srcdoc  = currentEmail.bodyHtml;
      iframe.style.cssText = 'width:100%;border:none;min-height:200px;display:block;';
      iframe.onload = () => {
        try {
          const h = iframe.contentDocument.body.scrollHeight;
          if (h > 0) iframe.style.height = h + 'px';
        } catch { /* cross-origin guard */ }
      };
      emailBodyEl.appendChild(iframe);
    } else {
      emailBodyEl.textContent = currentEmail.body;
    }

    // Star button
    const starIcon = starBtn.querySelector('.material-icons-outlined');
    if (starIcon) {
      starIcon.textContent = currentEmail.starred ? 'star' : 'star_border';
      starIcon.style.color = currentEmail.starred ? '#f4b400' : '';
    }

    showEmailViewer();
    renderEmailList();

    // Run scam detection in background
    scanEmailForScam(currentEmail.id);
  } catch (error) {
    console.error('Error loading email:', error);
  }
}

// ============ Scam Detection ============
const scamCache = {};

async function scanEmailForScam(emailId) {
  const banner = document.getElementById('scamBanner');
  const scamIcon = document.getElementById('scamIcon');
  const scamLevel = document.getElementById('scamLevel');
  const scamScoreBadge = document.getElementById('scamScoreBadge');
  const scamSummary = document.getElementById('scamSummary');
  const scamDetails = document.getElementById('scamDetails');
  const scamIndicators = document.getElementById('scamIndicators');
  const scamRecommendations = document.getElementById('scamRecommendations');
  const scamToggleBtn = document.getElementById('scamToggleBtn');

  // Reset state
  banner.classList.add('hidden');
  scamDetails.classList.add('hidden');
  banner.className = 'scam-banner hidden';

  try {
    // Check cache first
    let result = scamCache[emailId];
    if (!result) {
      const jwtToken = localStorage.getItem('jwtToken');
      const headers = {};
      if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

      const res = await fetch(`/api/email/${emailId}/scan`, { headers });
      result = await res.json();
      scamCache[emailId] = result;
    }

    // Only show banner if there are indicators
    if (result.level === 'safe') {
      banner.classList.add('hidden');
      return;
    }

    // Show banner
    banner.classList.remove('hidden');
    banner.classList.add(`scam-${result.level}`);

    // Set icon
    const iconMap = {
      low: 'info',
      medium: 'warning',
      high: 'gpp_maybe',
      critical: 'gpp_bad'
    };
    scamIcon.textContent = iconMap[result.level] || 'shield';

    // Set level text
    const levelText = {
      low: 'Low Risk',
      medium: 'Suspicious',
      high: 'High Risk',
      critical: 'Likely Scam'
    };
    scamLevel.textContent = levelText[result.level] || result.level;
    scamScoreBadge.textContent = `Score: ${result.score}/100`;

    // Summary
    scamSummary.textContent = result.summary;

    // Indicators
    scamIndicators.innerHTML = result.indicators.map(ind => `
      <div class="scam-indicator scam-indicator-${escHtml(ind.severity)}">
        <span class="material-icons-outlined">${escHtml(ind.icon)}</span>
        <div>
          <strong>${escHtml(ind.category)}</strong>
          <p>${escHtml(ind.detail)}</p>
        </div>
      </div>
    `).join('');

    // Recommendations
    if (result.recommendations.length > 0) {
      scamRecommendations.innerHTML = `
        <h4><span class="material-icons-outlined">tips_and_updates</span> Recommendations</h4>
        <ul>${result.recommendations.map(r => `<li>${escHtml(r)}</li>`).join('')}</ul>
      `;
    } else {
      scamRecommendations.innerHTML = '';
    }

    // Toggle details button
    scamToggleBtn.onclick = () => {
      scamDetails.classList.toggle('hidden');
      const icon = scamToggleBtn.querySelector('.material-icons-outlined');
      icon.textContent = scamDetails.classList.contains('hidden') ? 'expand_more' : 'expand_less';
    };

    // Also update list badge
    updateListBadge(emailId, result);

  } catch (err) {
    console.error('Scam scan error:', err);
  }
}

function updateListBadge(emailId, result) {
  const badge = document.querySelector(`.scam-list-badge[data-email-id="${emailId}"]`);
  if (badge && result.level !== 'safe') {
    badge.classList.remove('hidden');
    const icons = { low: '🔵', medium: '🟡', high: '🟠', critical: '🔴' };
    const labels = { low: 'Low risk', medium: 'Suspicious', high: 'High risk', critical: 'Scam' };
    badge.textContent = icons[result.level] || '';
    badge.title = `${labels[result.level]}: Score ${result.score}/100`;
    badge.classList.add(`scam-badge-${result.level}`);
  }
}

// Background scan visible emails for list badges
// Run parallel scans (up to `concurrency` at once) on a list of emails.
// Calls optional onComplete({ threats, critical }) when all done.
async function scanVisibleEmails(emails, { limit = 20, concurrency = 2, onComplete } = {}) {
  const jwtToken = localStorage.getItem('jwtToken');
  const headers = {};
  if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

  const toScan = emails.slice(0, limit);
  let idx = 0;
  let threats = 0;
  let critical = 0;

  async function worker() {
    while (idx < toScan.length) {
      const email = toScan[idx++];
      if (scamCache[email.id]) {
        const r = scamCache[email.id];
        if (r.level !== 'safe') threats++;
        if (r.level === 'critical' || r.level === 'high') critical++;
        updateListBadge(email.id, r);
        continue;
      }
      try {
        const res = await fetch(`/api/email/${email.id}/scan`, { headers });
        const result = await res.json();
        scamCache[email.id] = result;
        if (result.level !== 'safe') threats++;
        if (result.level === 'critical' || result.level === 'high') critical++;
        updateListBadge(email.id, result);
      } catch (err) { /* silent */ }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  if (typeof onComplete === 'function') onComplete({ threats, critical });
}

// ============ Back to List ============
function backToList() {
  currentEmail = null;
  showEmailList();
  renderEmailList();
}

// ============ Delete Email ============
async function handleDeleteEmail() {
  if (!currentEmail) return;
  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const headers = {};
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await fetch(`/api/email/${currentEmail.id}`, { method: 'DELETE', headers });
    if (response.ok) {
      showToast('Moved to trash');
      backToList();
      loadEmails();
    } else {
      showToast('Failed to delete', 'error');
    }
  } catch (error) {
    console.error('Error deleting email:', error);
    showToast('Delete failed', 'error');
  }
}

// ============ Toggle Star ============
async function handleToggleStar() {
  if (!currentEmail) return;
  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const headers = {};
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await fetch(`/api/email/${currentEmail.id}/star`, { method: 'PUT', headers });
    const data = await response.json();
    currentEmail.starred = data.starred;
    const starIcon = starBtn.querySelector('.material-icons-outlined');
    if (starIcon) {
      starIcon.textContent = currentEmail.starred ? 'star' : 'star_border';
      starIcon.style.color = currentEmail.starred ? '#f4b400' : '';
    }
    showToast(currentEmail.starred ? 'Starred' : 'Unstarred');
  } catch (error) {
    console.error('Error toggling star:', error);
  }
}

// ============ Reply ============
function handleReply() {
  if (!currentEmail) return;
  openCompose();
  document.getElementById('composeTo').value = currentEmail.from || '';
  document.getElementById('composeSubject').value = 'Re: ' + (currentEmail.subject || '');
  document.getElementById('composeBody').value = `\n\n--- Original Message ---\nFrom: ${currentEmail.from}\nDate: ${formatDate(currentEmail.date)}\n\n${currentEmail.body || ''}`;
}

// ============ Compose ============
function openCompose() {
  composeForm.reset();
  const composeWindow = document.querySelector('.compose-window');
  if (composeWindow) {
    composeWindow.classList.remove('compose-minimized', 'compose-expanded');
    const minIcon = document.getElementById('minimizeComposeBtn')?.querySelector('.material-icons-outlined');
    const expIcon = document.getElementById('expandComposeBtn')?.querySelector('.material-icons-outlined');
    if (minIcon) minIcon.textContent = 'minimize';
    if (expIcon) expIcon.textContent = 'open_in_full';
  }
  // Reset compose extras
  const filesList = document.getElementById('composeFilesList');
  if (filesList) { filesList.innerHTML = ''; filesList.classList.add('hidden'); }
  document.getElementById('composeFormatBar')?.classList.add('hidden');
  const linkBar = document.getElementById('composeLinkBar');
  if (linkBar) { linkBar.classList.add('hidden'); const li = document.getElementById('composeLinkInput'); if (li) li.value = ''; }
  document.getElementById('composeEmojiPanel')?.classList.add('hidden');
  composeModal.classList.remove('hidden');
}

function closeCompose() {
  composeModal.classList.add('hidden');
}

// ============ Compose Toolbar ============
function insertTextAtCursor(text) {
  const ta = document.getElementById('composeBody');
  if (!ta) return;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
}

function wrapSelection(before, after) {
  const ta = document.getElementById('composeBody');
  if (!ta) return;
  const start    = ta.selectionStart;
  const end      = ta.selectionEnd;
  const selected = ta.value.slice(start, end) || 'text';
  ta.value = ta.value.slice(0, start) + before + selected + after + ta.value.slice(end);
  ta.selectionStart = start + before.length;
  ta.selectionEnd   = start + before.length + selected.length;
  ta.focus();
}

function _closeComposePanels(except) {
  const ids = ['composeFormatBar', 'composeLinkBar', 'composeEmojiPanel'];
  ids.filter(id => id !== except).forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

function initComposeToolbar() {
  const formatBtn  = document.getElementById('composeFormatBtn');
  const formatBar  = document.getElementById('composeFormatBar');
  const attachBtn  = document.getElementById('composeAttachBtn');
  const attachInput = document.getElementById('composeAttachInput');
  const linkBtn    = document.getElementById('composeLinkBtn');
  const linkBar    = document.getElementById('composeLinkBar');
  const emojiBtn   = document.getElementById('composeEmojiBtn');
  const emojiPanel = document.getElementById('composeEmojiPanel');
  const photoBtn   = document.getElementById('composePhotoBtn');
  const photoInput = document.getElementById('composePhotoInput');

  // Format toggle
  if (formatBtn && formatBar) {
    formatBtn.addEventListener('click', () => {
      const open = !formatBar.classList.contains('hidden');
      _closeComposePanels('composeFormatBar');
      formatBar.classList.toggle('hidden', open);
    });
  }
  // Format buttons (B/I/U/S)
  const fmtMap = [['fmtBold','<b>','</b>'],['fmtItalic','<i>','</i>'],['fmtUnderline','<u>','</u>'],['fmtStrike','<s>','</s>']];
  fmtMap.forEach(([id, b, a]) => document.getElementById(id)?.addEventListener('click', () => wrapSelection(b, a)));
  document.getElementById('fmtBullet')?.addEventListener('click', () => insertTextAtCursor('\u2022 '));
  document.getElementById('fmtQuote')?.addEventListener('click',  () => wrapSelection('> ', ''));

  // Attach files
  if (attachBtn && attachInput) {
    attachBtn.addEventListener('click', () => { _closeComposePanels(null); attachInput.click(); });
    attachInput.addEventListener('change', () => handleFileAttach(attachInput));
  }

  // Insert link
  if (linkBtn && linkBar) {
    linkBtn.addEventListener('click', () => {
      const open = !linkBar.classList.contains('hidden');
      _closeComposePanels('composeLinkBar');
      linkBar.classList.toggle('hidden', open);
      if (!open) document.getElementById('composeLinkInput')?.focus();
    });
  }
  document.getElementById('composeLinkInsertBtn')?.addEventListener('click', () => {
    const url = document.getElementById('composeLinkInput')?.value.trim();
    if (url) insertTextAtCursor(url);
    if (document.getElementById('composeLinkInput')) document.getElementById('composeLinkInput').value = '';
    linkBar?.classList.add('hidden');
  });
  document.getElementById('composeLinkCancelBtn')?.addEventListener('click', () => {
    if (document.getElementById('composeLinkInput')) document.getElementById('composeLinkInput').value = '';
    linkBar?.classList.add('hidden');
  });

  // Emoji picker
  if (emojiBtn && emojiPanel) {
    emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !emojiPanel.classList.contains('hidden');
      _closeComposePanels('composeEmojiPanel');
      emojiPanel.classList.toggle('hidden', open);
    });
    emojiPanel.addEventListener('click', (e) => {
      if (e.target.classList.contains('emoji-btn')) {
        insertTextAtCursor(e.target.textContent);
        emojiPanel.classList.add('hidden');
      }
    });
  }

  // Photo (treated same as file attach)
  if (photoBtn && photoInput) {
    photoBtn.addEventListener('click', () => { _closeComposePanels(null); photoInput.click(); });
    photoInput.addEventListener('change', () => handleFileAttach(photoInput));
  }

  // Close emoji panel on outside click
  document.addEventListener('click', (e) => {
    const ep = document.getElementById('composeEmojiPanel');
    if (ep && !ep.classList.contains('hidden') && !ep.closest('#composeForm')?.contains(e.target)) {
      ep.classList.add('hidden');
    }
  });
}

function handleFileAttach(input) {
  const list = document.getElementById('composeFilesList');
  if (!list || !input.files?.length) return;
  list.classList.remove('hidden');
  Array.from(input.files).forEach(file => {
    const tag = document.createElement('span');
    tag.className = 'compose-file-tag';
    const name = file.name.length > 28 ? file.name.slice(0, 25) + '…' : file.name;
    tag.innerHTML = `<span class="material-icons-outlined" style="font-size:12px;vertical-align:middle">attach_file</span> ${name} <button type="button" class="file-tag-remove" title="Remove">✕</button>`;
    tag.querySelector('.file-tag-remove').addEventListener('click', () => {
      tag.remove();
      if (!list.children.length) list.classList.add('hidden');
    });
    list.appendChild(tag);
  });
  input.value = '';
}

async function handleSendEmail(e) {
  e.preventDefault();
  const to = document.getElementById('composeTo').value;
  const subject = document.getElementById('composeSubject').value;
  const body = document.getElementById('composeBody').value;

  const sendBtn = composeForm.querySelector('.send-btn');
  sendBtn.disabled = true;
  const orig = sendBtn.innerHTML;
  sendBtn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 1s linear infinite">refresh</span> Sending...';

  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const response = await fetch('/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {})
      },
      body: JSON.stringify({ to, subject, body })
    });
    const data = await response.json();
    if (response.ok && data.success) {
      showToast('Email sent successfully!');
      closeCompose();
      if (currentFolder === 'sent') loadEmails();
    } else {
      showToast('Failed to send: ' + (data.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    showToast('Send failed: ' + error.message, 'error');
  } finally {
    sendBtn.disabled = false;
    sendBtn.innerHTML = orig;
  }
}

async function handleSaveDraft() {
  const to = document.getElementById('composeTo').value;
  const subject = document.getElementById('composeSubject').value;
  const body = document.getElementById('composeBody').value;
  if (!to && !subject && !body) { showToast('Draft is empty', 'error'); return; }
  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const response = await fetch('/api/draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jwtToken ? { 'Authorization': `Bearer ${jwtToken}` } : {})
      },
      body: JSON.stringify({ to, subject, body })
    });
    if (response.ok) {
      showToast('Draft saved');
      closeCompose();
      if (currentFolder === 'drafts') loadEmails();
    }
  } catch (error) {
    showToast('Failed to save draft', 'error');
  }
}

// ============ Folder Change ============
function handleFolderChange(e) {
  const btn = e.target.closest('.folder-btn');
  if (!btn || btn.classList.contains('more-toggle')) return;
  document.querySelectorAll('.folder-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFolder = btn.dataset.folder;
  currentEmail = null;
  displayedCount = 25;
  currentPage = 0;
  hasMoreOnServer = false;
  threatFilterActive = false;
  
  // Restart auto-refresh if going back to inbox
  if (currentFolder === 'inbox') {
    setupAutoRefreshTimer();
  } else {
    // Pause auto-refresh for other folders
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  }
  
  showEmailList();
  loadEmails();
}

// ============ Search ============
async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) { loadEmails(); return; }
  hasMoreOnServer = false; // search results don't have Gmail pagination
  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const headers = {};
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;

    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { headers });
    if (response.status === 401) {
      localStorage.removeItem('currentUser');
      localStorage.removeItem('jwtToken');
      currentUser = null;
      showLoginScreen();
      showLoginMessage('Session expired. Please sign in again.', 'error');
      return;
    }
    emails = await response.json();
    renderEmailList();
  } catch (error) {
    console.error('Error searching:', error);
  }
}

// ============ Unread Count ============
function updateUnreadCount() {
  const unread = emails.filter(e => e.unread || e.read === false).length;
  const badge = document.getElementById('inboxBadge');
  if (badge && currentFolder === 'inbox') {
    badge.textContent = unread > 0 ? unread : '';
  }
}

function updateEmailCount() {
  const countEl = document.getElementById('emailCount');
  if (countEl) {
    const total = emails.length;
    countEl.textContent = total > 0 ? `1–${Math.min(displayedCount, total)} of ${total}` : '';
  }
}

// ============ Format Date (Gmail-style) ============
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (isYesterday) {
    return 'Yesterday';
  }
  if (isThisYear) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============ Quick Delete from list ============
async function handleQuickDelete(emailId) {
  try {
    const jwtToken = localStorage.getItem('jwtToken');
    const headers = {};
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;
    const response = await fetch(`/api/email/${emailId}`, { method: 'DELETE', headers });
    if (response.ok) {
      showToast('Moved to trash');
      emails = emails.filter(e => e.id !== emailId);
      renderEmailList();
      updateEmailCount();
      updateUnreadCount();
    } else {
      showToast('Failed to delete', 'error');
    }
  } catch (error) {
    showToast('Delete failed', 'error');
  }
}

// ============ Forward ============
function handleForward() {
  if (!currentEmail) return;
  openCompose();
  document.getElementById('composeSubject').value = 'Fwd: ' + (currentEmail.subject || '');
  document.getElementById('composeBody').value = `\n\n---------- Forwarded message ----------\nFrom: ${currentEmail.from}\nDate: ${formatDate(currentEmail.date)}\nSubject: ${currentEmail.subject || ''}\nTo: ${currentEmail.to || ''}\n\n${currentEmail.body || ''}`;
}

