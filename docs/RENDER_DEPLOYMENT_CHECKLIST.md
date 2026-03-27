# Render Deployment Checklist

## Pre-Deployment

- [ ] **Git Setup**
  - [ ] Git installed on your machine
  - [ ] Git repository initialized locally
  - [ ] All code committed

- [ ] **Accounts Created**
  - [ ] GitHub account created
  - [ ] Repository created on GitHub
  - [ ] Render account created (free at render.com)

## Step 1: Push Code to GitHub

```powershell
# In PowerShell, run these commands:
git remote add origin https://github.com/YOUR_USERNAME/SMAIL.git
git branch -M main
git push -u origin main
```

- [ ] Code pushed to GitHub
- [ ] Repository is PUBLIC (Render can access it)

## Step 2: Create Backend Service on Render

**Dashboard:** https://dashboard.render.com

1. [ ] Click "New +"
2. [ ] Select "Web Service"
3. [ ] Connect GitHub repository (SMAIL repo)
4. [ ] Configure Service:
   - [ ] Name: `smail-backend`
   - [ ] Environment: `Node`
   - [ ] Build Command: `npm install`
   - [ ] Start Command: `npm start`
   - [ ] Plan: **Free**
   - [ ] Runtime: Node.js 18+
5. [ ] Add Environment Variables:
   - [ ] `NODE_ENV` = `production`
   - [ ] `PORT` = `10000`
   - [ ] `DB_HOST` = (will set after DB created)
   - [ ] `DB_USER` = `smail_user`
   - [ ] `DB_PASSWORD` = (secure password)
   - [ ] `DB_NAME` = `smail_db`
   - [ ] `JWT_SECRET` = (secure JWT secret)
   - [ ] `ML_API_HOST` = `smail-ml-api.onrender.com`
   - [ ] `ML_API_PORT` = `443`
6. [ ] Click "Create Web Service"
7. [ ] Wait for deployment (2-5 minutes)
8. [ ] Copy service URL: `https://smail-backend.onrender.com`

## Step 3: Create ML API Service on Render

1. [ ] Click "New +"
2. [ ] Select "Web Service"
3. [ ] Connect same GitHub repo
4. [ ] Configure Service:
   - [ ] Name: `smail-ml-api`
   - [ ] Environment: `Python 3.11`
   - [ ] Build Command: `pip install -r ml-engine/core/predictive/requirements.txt`
   - [ ] Start Command: `cd ml-engine/core/predictive && gunicorn -w 4 -b 0.0.0.0:10000 predict_api:app`
   - [ ] Plan: **Free**
   - [ ] Python Version: 3.11
5. [ ] Add Environment Variables:
   - [ ] `FLASK_ENV` = `production`
   - [ ] `WORKERS` = `4`
6. [ ] Click "Create Web Service"
7. [ ] Wait for deployment (2-5 minutes)
8. [ ] Copy service URL: `https://smail-ml-api.onrender.com`

## Step 4: Create PostgreSQL Database

1. [ ] Click "New +"
2. [ ] Select "PostgreSQL"
3. [ ] Configure Database:
   - [ ] Name: `smail-postgres`
   - [ ] Database: `smail_db`
   - [ ] User: `smail_user`
   - [ ] Plan: **Free**
   - [ ] PostgreSQL Version: 15
4. [ ] Click "Create Database"
5. [ ] Wait for creation (1-2 minutes)
6. [ ] Copy **Internal Database URL** (looks like: `postgresql://user:pass@host:5432/db`)

## Step 5: Update Environment Variables

**For Backend (smail-backend):**

1. [ ] Go to Backend service settings
2. [ ] Update Environment Variables:
   - [ ] `DB_HOST` = (hostname from Internal DB URL)
   - [ ] `DB_PASSWORD` = (password set during DB creation)

**For ML API (smail-ml-api):**

1. [ ] Go to ML API service settings
2. [ ] No changes needed (stateless service)

## Step 6: Verify Deployment

Wait 2-3 minutes for services to redeploy with updated variables.

### Test Backend

```bash
curl https://smail-backend.onrender.com/health
```

Expected response: `{"status":"ok"}`

### Test ML API

```bash
curl https://smail-ml-api.onrender.com/health
```

Expected response: Success status

### View Logs

- [ ] Backend Logs: Dashboard > smail-backend > Logs
- [ ] ML API Logs: Dashboard > smail-ml-api > Logs
- [ ] Database Health: Check Render Dashboard

## Troubleshooting

### Service not starting?

1. Check Build Command output in Logs
2. Verify dependencies in `package.json` and `requirements.txt`
3. Check environment variables are set correctly

### Database connection error?

1. Verify `DB_HOST` matches Internal URL hostname
2. Verify username/password match
3. Wait a few minutes after DB creation

### Free tier cold start slow?

- This is normal! First request after 15 min of inactivity may take 30 seconds
- Upgrade to paid tier to avoid this

## After Deployment

- [ ] Test health endpoints
- [ ] Test spam detection with sample emails
- [ ] Monitor logs for errors
- [ ] Set up error alerts (optional, in Render dashboard)

## Scaling to 100+ Users

**Current Free Tier:**
- 0.5 CPU, 512MB RAM per service
- Supports ~50 concurrent users

**To scale to 100+ users, upgrade to:**
- Backend: **Standard** tier ($7/month, 2GB RAM)
- ML API: **Standard** tier ($7/month, 2GB RAM)
- Database: Paid PostgreSQL ($9/month)
- **Total: ~$23/month**

Upgrade in service settings > Pricing Plan

---

**Status:** Free tier deployment ready. Scalable to production with paid tier.

**Documentation:** See [RENDER_DEPLOYMENT_GUIDE.md](RENDER_DEPLOYMENT_GUIDE.md)
