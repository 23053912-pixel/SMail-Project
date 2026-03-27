# GCP Deployment Checklist

## Pre-Deployment Requirements

- [ ] Google Cloud Account created
- [ ] Billing enabled on GCP account
- [ ] Google Cloud SDK installed (https://cloud.google.com/sdk/docs/install)
- [ ] `gcloud` CLI configured: Run `gcloud init`
- [ ] Docker installed and running
- [ ] Terraform installed (optional, for IaC approach)
- [ ] Sufficient GCP quota in selected region

---

## Step 1: GCP Project Setup

- [ ] Create new GCP project in Console
  - Go to https://console.cloud.google.com/
  - Click "Create Project"
  - Name: `smail-system`
  - Project ID: `smail-system-prod`
  - Save the Project ID

- [ ] Enable billing
  - Navigate to Billing in GCP Console
  - Attach a payment method
  - Set up budget alerts (recommended: $500/month)

- [ ] Authenticate local gcloud:
  ```powershell
  gcloud auth login
  gcloud config set project smail-system-prod
  ```

---

## Step 2: Prepare Docker Images

- [ ] Build Docker images locally
  ```powershell
  cd "c:\Users\bhand\Downloads\SMAIL SYSTEM\ml portion spam"
  docker build -t smail-backend:latest -f Dockerfile.backend .
  docker build -t smail-ml-api:latest -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive
  ```

- [ ] Verify images build successfully
  ```powershell
  docker images | Select-String smail-
  ```

---

## Step 3: Deployment Method

Choose ONE of the following methods:

### Option A: Automated PowerShell Script (Easiest)

- [ ] Run deployment script:
  ```powershell
  .\deploy-gcp.ps1 -ProjectID smail-system-prod -Region us-central1
  ```

- [ ] Wait for completion (10-15 minutes)

- [ ] Check deployment status:
  ```powershell
  gcloud run services list --region=us-central1
  ```

### Option B: Terraform (Infrastructure as Code)

- [ ] Install Terraform: https://www.terraform.io/downloads.html

- [ ] Copy example variables:
  ```powershell
  Copy-Item terraform.tfvars.example terraform.tfvars
  ```

- [ ] Edit `terraform.tfvars`:
  ```
  project_id = "smail-system-prod"
  region     = "us-central1"
  db_password = "YOUR_STRONG_PASSWORD_HERE"
  backend_image = "us-central1-docker.pkg.dev/smail-system-prod/smail-repo/smail-backend:latest"
  ml_api_image  = "us-central1-docker.pkg.dev/smail-system-prod/smail-repo/smail-ml-api:latest"
  ```

- [ ] Initialize Terraform:
  ```powershell
  terraform init
  ```

- [ ] Plan deployment:
  ```powershell
  terraform plan -out=tfplan
  ```

- [ ] Review the plan output carefully

- [ ] Apply the plan:
  ```powershell
  terraform apply tfplan
  ```

- [ ] Wait for completion (15-20 minutes)

---

## Step 4: Post-Deployment Configuration

- [ ] Retrieve service URLs:
  ```powershell
  gcloud run services describe smail-backend --region=us-central1 --format="value(status.url)"
  gcloud run services describe smail-ml-api --region=us-central1 --format="value(status.url)"
  ```

- [ ] Test backend health endpoint:
  ```powershell
  # Get backend URL
  $backendUrl = (gcloud run services describe smail-backend --region=us-central1 --format="value(status.url)")
  
  # Test health endpoint
  Invoke-WebRequest "$backendUrl/health"
  ```

- [ ] Verify services are running:
  ```powershell
  gcloud run logs read smail-backend --limit=20
  gcloud run logs read smail-ml-api --limit=20
  ```

---

## Step 5: Set Up Custom Domain (Optional but Recommended)

- [ ] Create Cloud Load Balancer:
  - Go to GCP Console > Load Balancing
  - Create HTTP(S) load balancer
  - Backend: Cloud Run services
  - Frontend: Reserve static IP
  - Add SSL certificate via Cloud Armor

- [ ] Configure Cloud DNS:
  ```powershell
  gcloud dns managed-zones create smail-zone `
    --dns-name="yourdomain.com." `
    --description="SMAIL System DNS"
  ```

- [ ] Get nameservers and update domain registrar:
  ```powershell
  gcloud dns managed-zones describe smail-zone --format="value(nameServers[*])"
  ```

- [ ] Create DNS records:
  ```powershell
  gcloud dns record-sets create yourdomain.com `
    --rrdatas="LOAD_BALANCER_IP" `
    --ttl=300 `
    --type=A `
    --zone=smail-zone
  ```

---

## Step 6: Monitoring & Alerts

- [ ] Set up Cloud Monitoring:
  - Go to GCP Console > Monitoring
  - Create uptime checks for health endpoints
  - Set alert policies for high error rates

- [ ] Enable Cloud Logging:
  - Configure log retention (default: 30 days)
  - Set up log-based metrics
  - Create alerts for critical errors

- [ ] Configure budget alerts:
  - Go to Billing > Budgets
  - Set threshold: $500/month
  - Alert before max budget

---

## Step 7: Database Operations

- [ ] Access Cloud SQL Console:
  - Go to GCP Console > Cloud SQL
  - Select `smail-postgres`
  - Copy connection name

- [ ] Connect to database from Cloud Shell:
  ```bash
  gcloud sql connect smail-postgres --user=smail_user
  ```

- [ ] Create initial schema (if needed):
  - Run SQL files from `backend/db/schema.sql`
  - Set up indexes for performance

- [ ] Enable automated backups:
  - Cloud SQL Console > Backups
  - Verify daily backups enabled
  - Set retention: 30 days

---

## Step 8: Scaling Configuration

- [ ] Adjust auto-scaling for different user loads:

  **For 100 concurrent users:**
  ```powershell
  gcloud run services update smail-backend `
    --min-instances=5 `
    --max-instances=50 `
    --region=us-central1
  ```

  **For 200+ concurrent users:**
  ```powershell
  gcloud run services update smail-backend `
    --min-instances=10 `
    --max-instances=100 `
    --region=us-central1
  ```

- [ ] Monitor scaling metrics:
  ```powershell
  gcloud run services describe smail-backend --region=us-central1
  ```

---

## Step 9: Security Hardening

- [ ] Update database password in Secret Manager:
  ```powershell
  gcloud secrets create smail-db-password --data-file=-
  ```

- [ ] Configure VPC for private databases:
  - Create private service connection
  - Enable Cloud SQL private IP

- [ ] Set up Cloud Armor (DDoS protection):
  - Go to GCP Console > Cloud Armor
  - Create security policy
  - Attach to load balancer

- [ ] Enable VPC Service Controls (optional):
  - Create security perimeter
  - Restrictive access policies

---

## Step 10: Cost Optimization

- [ ] Review and optimize resources:
  - Downsize Cloud SQL if needed
  - Review Cloud Run memory allocation
  - Check for unused resources

- [ ] Configure Compute Engine commitments:
  - 1-year commitment: ~30% discount
  - 3-year commitment: ~50% discount

- [ ] Set up log policies:
  - Exclude non-essential logs
  - Archive old logs to Cloud Storage

---

## Verification Checklist

- [ ] Backend service responding to requests
- [ ] ML API returning predictions
- [ ] Database connectivity working
- [ ] Redis cache accessible
- [ ] Auto-scaling metrics showing
- [ ] Monitoring alerts firing correctly
- [ ] Logs being collected in Cloud Logging
- [ ] Health checks passing
- [ ] Static IP assigned and stable
- [ ] SSL/TLS working for HTTPS
- [ ] Load balancer distributing traffic
- [ ] Backups running on schedule
- [ ] Budget alerts configured
- [ ] No persistent errors in logs

---

## Troubleshooting

### Services won't start
```powershell
gcloud run logs read smail-backend --limit=100 --region=us-central1
```

### Database connection failed
- Check: Cloud SQL public IP / private IP configuration
- Check: Firewall rules allow Cloud Run
- Check: DB credentials are correct
- Check: Environment variables set properly

### Out of memory
- Increase memory: `--memory=1Gi`
- Check for memory leaks in application code
- Review Cloud Profiler

### High latency
- Check: Redis cache hit rate
- Check: Database query performance
- Check: Network bandwidth between services
- Consider: Enabling Cloud CDN for static assets

---

## Monthly Cost Breakdown

| Service | Cost |
|---------|------|
| Cloud SQL (db-f1-micro) | ~$8 |
| Redis Memorystore (1GB) | ~$11 |
| Cloud Run Backend (5-50 replicas) | ~$200-500 |
| Cloud Run ML API (2-20 replicas) | ~$150-300 |
| Load Balancer | ~$50-100 |
| Cloud DNS | ~$5 |
| **Total** | **~$425-750** |

---

## Support Resources

- GCP Documentation: https://cloud.google.com/docs
- Cloud Run Pricing: https://cloud.google.com/run/pricing
- Cloud Run Quotas: https://cloud.google.com/run/quotas
- GCP Status Page: https://status.cloud.google.com/
- Support: https://cloud.google.com/support

---

## Post-Deployment Tasks

1. [ ] Set up CI/CD pipeline (Cloud Build)
2. [ ] Configure automated deployments from GitHub
3. [ ] Set up staging environment
4. [ ] Create runbook for common operations
5. [ ] Document custom configurations
6. [ ] Train team on GCP operations
7. [ ] Schedule cost review (monthly)
8. [ ] Plan disaster recovery procedures
9. [ ] Set up incident response guidelines
10. [ ] Document all credentials in secure manager
