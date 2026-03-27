# SMAIL System - GCP Deployment Guide

This guide will deploy the SMAIL system on Google Cloud Platform for 100+ concurrent users with auto-scaling.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│         Google Cloud Load Balancer (Global)                  │
│         - Distributes traffic across regions                 │
│         - HTTPS/TLS termination                              │
└──────────────┬──────────────────────────────────────────────┘
               │
   ┌───────────┴───────────┐
   │                       │
┌──▼──────────────────┐  ┌─▼──────────────────┐
│ Cloud Run Backend   │  │ Cloud Run ML API    │
│ (Auto-scales 5-50)  │  │ (Auto-scales 2-20)  │
│ Instance Group      │  │ Instance Group      │
└──┬───────────────────┘  └─┬──────────────────┘
   │                       │
   └───────────┬───────────┘
               │
       ┌───────┴─────────┬──────────────┐
       │                 │              │
   ┌───▼────────┐  ┌────▼───────┐  ┌──▼──────────┐
   │ Cloud SQL  │  │ Memorystore│  │   Storage   │
   │ PostgreSQL │  │   Redis    │  │   (Logs)    │
   └────────────┘  └────────────┘  └─────────────┘
```

## Prerequisites

1. **GCP Account** with billing enabled
2. **Google Cloud SDK** installed: https://cloud.google.com/sdk/docs/install
3. **gcloud CLI** configured: `gcloud init`
4. **Project ID** created in GCP Console
5. **Service Account** with deployment permissions

## Step 1: Create GCP Project

```bash
# Set your project name
$PROJECT_NAME = "smail-system"
$PROJECT_ID = "smail-system-prod"
$REGION = "us-central1"

# Create project
gcloud projects create $PROJECT_ID --name=$PROJECT_NAME

# Set as active project
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable redis.googleapis.com
gcloud services enable compute.googleapis.com
gcloud services enable container.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

## Step 2: Set Up Managed Database (Cloud SQL)

```bash
# Create PostgreSQL instance (db-f1-micro = 1 vCPU, 0.6 GB RAM)
gcloud sql instances create smail-postgres `
  --database-version=POSTGRES_15 `
  --tier=db-f1-micro `
  --region=$REGION `
  --storage-auto-increase `
  --storage-auto-increase-limit=100 `
  --enable-bin-log `
  --backup-start-time=03:00

# Create database
gcloud sql databases create smail_db `
  --instance=smail-postgres

# Create user
gcloud sql users create smail_user `
  --instance=smail-postgres `
  --password=CHANGE_ME_TO_SECURE_PASSWORD
```

## Step 3: Set Up Redis Cache (Memorystore)

```bash
# Create Redis instance (cache-basic-1 = 1GB, auto-failover disabled)
gcloud redis instances create smail-redis `
  --size=1 `
  --region=$REGION `
  --redis-version=7.0 `
  --tier=basic
```

## Step 4: Set Up Container Registry

```bash
# Enable Artifact Registry
gcloud services enable artifactregistry.googleapis.com

# Create repository
gcloud artifacts repositories create smail-repo `
  --repository-format=docker `
  --location=$REGION

# Authenticate Docker
gcloud auth configure-docker $REGION-docker.pkg.dev
```

## Step 5: Build and Push Docker Images

```bash
# Set registry hostname
$REGISTRY = "$REGION-docker.pkg.dev/$PROJECT_ID/smail-repo"

# Build and push backend image
docker build -t "$REGISTRY/smail-backend:latest" -f Dockerfile.backend .
docker push "$REGISTRY/smail-backend:latest"

# Build and push ML API image
docker build -t "$REGISTRY/smail-ml-api:latest" -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive
docker push "$REGISTRY/smail-ml-api:latest"
```

## Step 6: Create Service Account for Deployments

```bash
# Create service account
gcloud iam service-accounts create smail-deployer `
  --display-name="SMAIL System Deployer"

# Grant necessary roles
$SA_EMAIL = "smail-deployer@$PROJECT_ID.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$SA_EMAIL" `
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$SA_EMAIL" `
  --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding $PROJECT_ID `
  --member="serviceAccount:$SA_EMAIL" `
  --role="roles/cloudsql.client"
```

## Step 7: Deploy Backend Service

```bash
# Store database connection string
$DB_HOST = "smail-postgres.c.XXXXX.cloudsql.net"  # Get from Cloud SQL console
$DB_USER = "smail_user"
$DB_PASSWORD = "YOUR_SECURE_PASSWORD"

# Deploy backend to Cloud Run
gcloud run deploy smail-backend `
  --image="$REGISTRY/smail-backend:latest" `
  --platform=managed `
  --region=$REGION `
  --set-env-vars="NODE_ENV=production,DB_HOST=$DB_HOST,DB_USER=$DB_USER,DB_PASSWORD=$DB_PASSWORD,DB_NAME=smail_db,REDIS_HOST=smail-redis.XXXXX.cache.googleapis.com,REDIS_PORT=6379,ML_API_HOST=smail-ml-api,ML_API_PORT=5001,JWT_SECRET=SECURE_SECRET_KEY" `
  --memory=512Mi `
  --cpu=1 `
  --min-instances=5 `
  --max-instances=50 `
  --timeout=3600 `
  --allow-unauthenticated
```

## Step 8: Deploy ML API Service

```bash
gcloud run deploy smail-ml-api `
  --image="$REGISTRY/smail-ml-api:latest" `
  --platform=managed `
  --region=$REGION `
  --set-env-vars="FLASK_ENV=production,WORKERS=4" `
  --memory=1Gi `
  --cpu=2 `
  --min-instances=2 `
  --max-instances=20 `
  --timeout=300 `
  --allow-unauthenticated
```

## Step 9: Set Up Load Balancer

```bash
# Create network endpoints for services
# This routes traffic intelligently between backend and ML API
# Created via GCP Console or terraform

# Frontend: smail-system.com (via Cloud DNS)
# Backend pool: smail-backend Cloud Run service
# ML API pool: smail-ml-api Cloud Run service
```

## Step 10: Configure DNS

```bash
# Create Cloud DNS zone
gcloud dns managed-zones create smail-zone `
  --dns-name="smail-system.com." `
  --description="SMAIL System DNS zone"

# Add nameservers to your domain registrar
# Get nameservers from Cloud Console
```

## Monitoring & Scaling

### View Logs
```bash
gcloud run logs read smail-backend --limit=50
gcloud run logs read smail-ml-api --limit=50
```

### Check Auto-Scaling Status
```bash
# View current service metrics
gcloud run services describe smail-backend --region=$REGION
```

### Manual Scaling
```bash
# Adjust min/max instances
gcloud run services update smail-backend `
  --min-instances=10 `
  --max-instances=100 `
  --region=$REGION
```

## Cost Estimation (Monthly)

| Service | Pricing | Estimate |
|---------|---------|----------|
| Cloud SQL (db-f1-micro) | $8.41 | $8.41 |
| Cloud Memorystore Redis (1GB) | $0.38/GB + storage | $11.38 |
| Cloud Run Backend (CPU+Memory) | Pay per 100ms | $200-500* |
| Cloud Run ML API (CPU+Memory) | Pay per 100ms | $150-300* |
| Load Balancer | $0.025/GB + $0.30/hr | $50-100 |
| Cloud DNS | $0.50/zone + per query | $5-10 |
| **Total** | | **$425-750/month** |

*Depends on traffic and auto-scaling usage

## Scaling for Different User Counts

| Users | Backend Replicas | ML API Replicas | Expected Cost |
|-------|------------------|-----------------|---------------|
| 10-50 | 5-10 | 2-5 | $300-400 |
| 50-100 | 10-20 | 5-10 | $500-650 |
| 100-200 | 20-30 | 10-15 | $650-850 |
| 200+ | 30-50+ | 15-20+ | $850-1500+ |

## Troubleshooting

### Service won't start
```bash
gcloud run logs read smail-backend --limit=100 --region=$REGION
```

### Database connection failed
- Check Cloud SQL public/private IP configuration
- Verify firewall rules allow Cloud Run connections
- Confirm environment variables are correctly set

### Out of memory errors
- Increase Cloud Run memory: `--memory=1Gi`
- Reduce max instances to prevent over-allocation
- Check for memory leaks with Cloud Profiler

## Next Steps

1. Review costs in GCP Console
2. Set up billing alerts
3. Enable Cloud Monitoring for production alerts
4. Configure automated backups for Cloud SQL
5. Set up CDN for static assets

## Support

For issues:
- Check GCP Documentation: https://cloud.google.com/docs
- Review Cloud Run Quotas: https://cloud.google.com/run/quotas
- Monitor costs: GCP Console > Billing
