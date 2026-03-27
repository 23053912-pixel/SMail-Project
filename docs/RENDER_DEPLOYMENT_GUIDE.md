# Render Deployment Guide for SMAIL System

**Render** is a modern cloud platform with a **free tier** that doesn't require a credit card to get started.

## What's Included (Free Tier)

✅ **Web Services**: 0.5 CPU, 512MB RAM  
✅ **PostgreSQL**: Free tier database (30 days after creation)  
✅ **Auto-deploys**: From Git push  
✅ **SSL/HTTPS**: Automatic  
✅ **No credit card**: Required only for pro features  

## Prerequisites

1. **GitHub Account** (Render deploys from Git)
2. **Render Account** (free at render.com)
3. Your SMAIL code (already in this folder)

## Step-by-Step Deployment

### Step 1: Prepare Your Repository

```bash
# Initialize git if not already done
cd "c:\Users\bhand\Downloads\SMAIL SYSTEM\ml portion spam"
git init
git add .
git commit -m "Initial SMAIL deployment"
```

### Step 2: Push to GitHub

1. Create new repository on GitHub
2. Add remote:
```bash
git remote add origin https://github.com/YOUR_USERNAME/SMAIL.git
git branch -M main
git push -u origin main
```

### Step 3: Create Render Account

Visit https://render.com and sign up (free)

### Step 4: Deploy Backend Service

1. Go to https://dashboard.render.com
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `smail-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

5. Add Environment Variables:
   ```
   NODE_ENV=production
   PORT=10000
   DB_HOST={postgres-internal-host}
   DB_USER=smail_user
   DB_PASSWORD=your_secure_password
   DB_NAME=smail_db
   JWT_SECRET=smail-jwt-secret-12345
   ML_API_HOST=smail-ml-api.onrender.com
   ML_API_PORT=443
   ```

6. Click **"Create Web Service"**

### Step 5: Deploy ML API Service

1. Click **"New +"** → **"Web Service"**
2. Same GitHub repo
3. Configure:
   - **Name**: `smail-ml-api`
   - **Environment**: `Python 3.11`
   - **Build Command**: `pip install -r ml-engine/core/predictive/requirements.txt`
   - **Start Command**: `cd ml-engine/core/predictive && gunicorn -w 4 -b 0.0.0.0:10000 predict_api:app`
   - **Plan**: Free

4. Click **"Create Web Service"**

### Step 6: Create PostgreSQL Database

1. Click **"New +"** → **"PostgreSQL"**
2. Configure:
   - **Name**: `smail-postgres`
   - **PostgreSQL Version**: 15
   - **Plan**: Free

3. Once created, copy the **Internal Database URL**
4. Add to both services' environment variables as `DB_HOST`

### Step 7: Update Environment Variables

After database is created:

1. For **smail-backend**, set:
   ```
   DATABASE_URL={Internal Database URL}
   ```

2. For **smail-ml-api**, set same variables

### Step 8: Test Deployment

Wait 2-3 minutes for deployments to complete.

Test health endpoint:
```bash
curl https://smail-backend.onrender.com/health
```

## Limitations (Free Tier)

- Services spin down after 15 minutes of inactivity (cold start ~30 sec)
- Database: 30-day free trial only (then needs paid tier)
- 0.5 CPU, 512MB RAM (lighter than GCP)
- 100GB bandwidth/month

## Cost Upgrade Path

- **Backend**: $7/month (0.5 CPU, 2GB RAM) after free tier
- **Database**: $9/month (PostgreSQL)
- **Total**: ~$16/month for production

## Advantages

✅ Free tier (no credit card initially)  
✅ Git-based auto-deploy (push = deploy)  
✅ Simple environment configuration  
✅ No container/Docker needed  
✅ Perfect for 100+ concurrent users with proper plan  

## Next Steps

1. Push code to GitHub
2. Create Render account
3. Connect GitHub repository
4. Deploy services following steps above
5. Test health endpoints
6. Monitor logs in Render dashboard

Your SMAIL system will be live at:
- Backend: `https://smail-backend.onrender.com`
- ML API: `https://smail-ml-api.onrender.com`
