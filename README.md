# SMail

A full-stack Gmail client with real Google OAuth 2.0 integration, scam detection, multi-user sessions, and unlimited email loading via Gmail API pagination.

## Project Structure

```
SMail-Project/
├── backend/
│   ├── middleware/
│   │   └── auth.js          # JWT auth helper (requireAuth)
│   ├── routes/
│   │   ├── auth.js          # OAuth routes + callback + logout
│   │   └── emails.js        # Email CRUD, search, send, drafts
│   ├── services/
│   │   └── gmail.js         # Gmail API + pagination logic
│   ├── utils/
│   │   └── session.js       # Per-user in-memory session store
│   ├── .env                 # Environment variables (not committed)
│   ├── config.js            # PORT & BASE_URL constants
│   ├── scamDetector.js      # Phishing / scam heuristics engine
│   └── server.js            # Express app — entry point (~70 lines)
├── frontend/
│   ├── index.html           # Main page
│   ├── app.js               # Frontend logic
│   └── styles.css           # Styles
├── package.json             # Root dependencies (canonical)
└── README.md
```

## Features

- **Google OAuth sign-in** — real Gmail access via OAuth 2.0
- **Multi-user** — per-user in-memory sessions, fully isolated email state
- **Unlimited email loading** — paginated with Gmail API `pageToken` (1000+ emails)
- **Compose & send** — via Gmail API
- **Folders** — Inbox, Sent, Drafts, Trash, Starred, Spam, Snoozed, Important
- **Search** — full-text across all loaded emails
- **Scam detection** — heuristic analysis with visual warning banners
- **Theme toggle** — light / dark mode
- **Security** — rate limiting, CORS lock, security headers, sandboxed iframe for HTML emails

## Quick Start

### Requirements
- Node.js ≥ 18
- Google Cloud project with Gmail API + OAuth credentials

### 1. Install

```bash
npm install
```

### 2. Configure

Edit `backend/.env`:

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
JWT_SECRET=your-random-64-char-secret
PORT=3000
```

### 3. Run

```bash
npm start
```

Open **http://localhost:3000**

## Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable **Gmail API**
3. OAuth consent screen → add Gmail scopes
4. Create OAuth 2.0 credentials (Web application)
5. Add `http://localhost:3000/callback` as an Authorized redirect URI
6. Copy Client ID + Client Secret to `backend/.env`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ✓ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✓ | Google OAuth client secret |
| `JWT_SECRET` | ✓ | Random 48+ char secret for JWT signing |
| `PORT` | | Server port (default: 3000) |
| `BASE_URL` | | Public URL for OAuth redirect (auto-detected on Render/Railway) |
| `ALLOWED_ORIGIN` | | CORS allowed origin (defaults to BASE_URL) |

## 🔐 Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable **Gmail API**
4. Create OAuth 2.0 credentials
5. Add `http://localhost:3000/callback` as authorized redirect URI
6. Copy Client ID and Secret to `.env` file

## 📧 Usage

1. Click **"Sign in with Google"**
2. Select your Google account
3. Allow Gmail access
4. Your real emails will load!

## 🛠️ Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: HTML, CSS, JavaScript
- **APIs**: Gmail API, Google OAuth 2.0
- **Auth**: JWT tokens

## 📝 License

MIT License

