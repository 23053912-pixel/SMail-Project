# SMAIL Scaling Guide - 100+ Concurrent Users on GCP

## Overview
This guide scales SMAIL to handle **100+ concurrent users seamlessly** using:
- **Google Cloud Platform (GCP)** for hosting
- **Kubernetes (GKE)** for orchestration
- **PostgreSQL** for database
- **Redis** for caching & sessions
- **Nginx** for load balancing
- **Docker** for containerization

---

## 🏗️ Architecture Components

```
                        [100+ Users]
                              ↓
                    [GCP Cloud Load Balancer]
                              ↓
                    [Nginx - L7 Load Balancer]
                    /         |         \
            Backend-1    Backend-2    Backend-3+
           (5 replicas across zones) - Auto-scales to 20
                    \         |         /
                              ↓
                    [Shared PostgreSQL]
                    [10GB+ storage]
                              ↓
                    [Redis Cache Cluster]
                         ↓       ↓
                   [ML API-1] [ML-API-2]
                    (2 replicas)
```

---

## Phase 1: Setup GCP Project

### 1.1 Create GCP Project
```bash
gcloud projects create smail-prod --name="SMAIL Production"
gcloud config set project smail-prod
```

### 1.2 Enable Required APIs
```bash
gcloud services enable \
  container.googleapis.com \
  compute.googleapis.com \
  cloudkms.googleapis.com \
  sqlcomponent.googleapis.com \
  redis.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com
```

### 1.3 Create Service Account
```bash
gcloud iam service-accounts create smail-sa \
  --display-name="SMAIL Service Account"

gcloud projects add-iam-policy-binding smail-prod \
  --member=serviceAccount:smail-sa@smail-prod.iam.gserviceaccount.com \
  --role=roles/container.developer

gcloud projects add-iam-policy-binding smail-prod \
  --member=serviceAccount:smail-sa@smail-prod.iam.gserviceaccount.com \
  --role=roles/storage.admin
```

---

## Phase 2: Create GKE Cluster

### 2.1 Create Kubernetes Cluster
```bash
gcloud container clusters create smail-cluster \
  --zone us-central1-a \
  --num-nodes 3 \
  --machine-type n1-standard-2 \
  --enable-autoscaling \
  --min-nodes 3 \
  --max-nodes 10 \
  --enable-stackdriver-kubernetes \
  --addons HorizontalPodAutoscaling,HttpLoadBalancing
```

### 2.2 Get Credentials
```bash
gcloud container clusters get-credentials smail-cluster \
  --zone us-central1-a
```

### 2.3 Create Storage Classes
```bash
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/gce-pd
parameters:
  type: pd-ssd
  replication-type: regional-pd
EOF
```

---

## Phase 3: Setup Managed Services

### 3.1 Create Cloud SQL (PostgreSQL)
```bash
gcloud sql instances create smail-postgres \
  --database-version POSTGRES_15 \
  --tier db-g1-small \
  --region us-central1 \
  --backup-start-time 03:00 \
  --enable-bin-log \
  --retained-backups-count 7

# Create database
gcloud sql databases create smail_db \
  --instance smail-postgres

# Create user
gcloud sql users create smail_user \
  --instance smail-postgres \
  --password CHANGE_ME
```

### 3.2 Create Cloud Memorystore (Redis)
```bash
gcloud redis instances create smail-redis \
  --size 5 \
  --region us-central1 \
  --redis-version 7.0 \
  --tier standard
```

### 3.3 Enable Cloud SQL Proxy
```bash
# In GKE cluster
kubectl apply -f - <<EOF
apiVersion: v1
kind: Deployment
metadata:
  name: cloud-sql-proxy
  namespace: smail
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cloud-sql-proxy
  template:
    metadata:
      labels:
        app: cloud-sql-proxy
    spec:
      containers:
      - name: cloud-sql-proxy
        image: gcr.io/cloudsql-docker/cloud-sql-proxy:1.33.2
        command:
          - "/cloud_sql_proxy"
          - "-instances=smail-prod:us-central1:smail-postgres=tcp:5432"
        securityContext:
          runAsNonRoot: true
        ports:
        - containerPort: 5432
EOF
```

---

## Phase 4: Build & Push Docker Images

### 4.1 Configure Docker
```bash
# Authenticate with GCR
gcloud auth configure-docker gcr.io

# Create artifact repository
gcloud artifacts repositories create smail \
  --repository-format=docker \
  --location us-central1
```

### 4.2 Build Backend Image
```bash
docker build -t gcr.io/smail-prod/smail-backend:latest \
  -f Dockerfile.backend .

docker push gcr.io/smail-prod/smail-backend:latest
```

### 4.3 Build ML API Image
```bash
docker build -t gcr.io/smail-prod/smail-ml-api:latest \
  -f ml-engine/core/predictive/Dockerfile \
  ./ml-engine/core/predictive

docker push gcr.io/smail-prod/smail-ml-api:latest
```

---

## Phase 5: Deploy to GKE

### 5.1 Create Namespace & Secrets
```bash
kubectl create namespace smail

# Create secrets
kubectl create secret generic db-credentials \
  --from-literal=username=smail_user \
  --from-literal=password=YOUR_DB_PASSWORD \
  -n smail

kubectl create secret generic app-secrets \
  --from-literal=jwt-secret=YOUR_JWT_SECRET \
  -n smail
```

### 5.2 Deploy Application
```bash
# Update k8s-gcp-deployment.yaml with your GCP project ID
sed -i 's/PROJECT_ID/smail-prod/g' k8s-gcp-deployment.yaml

# Apply all manifests
kubectl apply -f k8s-gcp-deployment.yaml
```

### 5.3 Verify Deployment
```bash
# Check pods
kubectl get pods -n smail

# Check services
kubectl get svc -n smail

# Check HPA status
kubectl get hpa -n smail
```

---

## Phase 6: Setup Load Balancing & DNS

### 6.1 Create Static IP
```bash
gcloud compute addresses create smail-ip \
  --global
```

### 6.2 Create Load Balancer
```bash
gcloud compute backend-services create smail-backend \
  --global \
  --protocol HTTP \
  --health-checks gke-health-check

gcloud compute backend-services add-backends smail-backend \
  --instance-group=gke-nodes \
  --global
```

### 6.3 Setup DNS
```bash
# Get load balancer IP
gcloud compute addresses describe smail-ip --global

# Add DNS record in your registrar pointing to the IP
# A record: smail.example.com → 1.2.3.4 (your IP)
```

---

## Phase 7: Performance Tuning

### 7.1 Database Optimization
```sql
-- Run these on the PostgreSQL instance
CREATE INDEX IF NOT EXISTS idx_emails_user_date 
  ON emails(user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_emails_is_spam 
  ON emails(user_id, is_spam);

-- Enable connection pooling
-- Connection pooling is configured in app-level pool (20 per worker)
```

### 7.2 Monitor Performance
```bash
# Check backend metrics
kubectl top pods -n smail

# View logs
kubectl logs -n smail deployment/backend -f

# Monitor Redis
gcloud redis instances describe smail-redis --region us-central1
```

### 7.3 Scaling Configuration
Edit `k8s-gcp-deployment.yaml`:
```yaml
backend:
  replicas: 5  # Minimum 5 for 100 users
  maxReplicas: 20  # Can scale to 20 under load

ml-api:
  replicas: 2  # 2 for redundancy
  maxReplicas: 5  # Scale up as needed  

backend-hpa:
  cpu: 70%  # Trigger scale-up at 70% CPU
  memory: 80%  # Trigger scale-up at 80% memory
```

---

## Phase 8: Monitoring & Alerts

### 8.1 Setup Monitoring
```bash
# Enable Cloud Monitoring
gcloud monitoring channels create \
  --display-name="smail-alerts" \
  --type=email \
  --channel-labels=email_address=YOUR_EMAIL@example.com
```

### 8.2 Create Alerts
```bash
# Alert for high error rate
gcloud monitoring alert-policies create \
  --display-name="SMAIL High Error Rate" \
  --condition-display-name="Error rate > 5%" \
  --condition-threshold-value=5
```

### 8.3 View Metrics Dashboard
```bash
# Cloud Console
gcloud monitoring dashboards describe smail-dashboard
```

---

## Phase 9: Testing Load (Before Going Live)

### 9.1 Load Test with K6
```javascript
// load-test.js
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '5m', target: 50 },   // Ramp up to 50 users
    { duration: '10m', target: 150 }, // Ramp up to 150 users
    { duration: '5m', target: 0 },    // Ramp down
  ],
};

export default function() {
  let res = http.get('https://smail.example.com/api/emails/inbox');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
```

Run load test:
```bash
k6 run load-test.js
```

### 9.2 Monitor During Load Test
```bash
# Watch HPA scaling
kubectl get hpa -n smail -w

# Monitor resource usage
kubectl top pods -n smail --sort-by=memory

# Check database connections
gcloud sql operations list --instance=smail-postgres --limit=10
```

---

## Scaling Benchmarks (100+ Users)

| Component | Load | Capacity |
|-----------|------|----------|
| Backend Pods | 5-10 | 100-200 users |
| Database Connections | 20/worker | 400+ total |
| Redis Cache | ~1-2 GB | Handles all sessions |
| ML API | 2-4 replicas | 50+ predictions/sec |
| Bandwidth | ~10-20 MB/s | Sufficient for 100 users |

---

## Cost Estimation (100 Concurrent Users)

| Service | Cost/Month |
|---------|-----------|
| GKE Cluster (3 n1-standard-2 nodes) | ~$100 |
| Cloud SQL (db-g1-small) | ~$40 |
| Cloud Memorystore Redis (5GB) | ~$100 |
| Cloud Load Balancer | ~$50 |
| **Total** | **~$290/month** |

*Prices vary by region; this is for us-central1*

---

## Troubleshooting

### Issue: Pods not starting
```bash
kubectl describe pod POD_NAME -n smail
kubectl logs POD_NAME -n smail
```

### Issue: Database connection errors
```bash
gcloud sql instances describe smail-postgres
# Check authorized networks
```

### Issue: Redis timeout
```bash
gcloud redis instances describe smail-redis --region us-central1
# Check network connectivity
```

### Issue: High latency
```bash
# Check database slow queries
gcloud sql operations list --instance=smail-postgres

# Monitor network
kubectl top pods -n smail
```

---

## Rollback Strategy

```bash
# View deployment history
kubectl rollout history deployment/backend -n smail

# Rollback to previous version
kubectl rollout undo deployment/backend -n smail

# Rollback to specific revision
kubectl rollout undo deployment/backend --to-revision=2 -n smail
```

---

## Maintenance & Updates

### Daily
- Monitor error rates
- Check database size
- Review Redis memory usage

### Weekly
- Review access logs
- Check for security updates
- Update dependencies

### Monthly
- Full system backup
- Performance review
- Cost optimization review

---

## Contact & Support
For issues, refer to:
- GCP Documentation: https://cloud.google.com/docs
- Kubernetes Docs: https://kubernetes.io/docs
- PostgreSQL Docs: https://www.postgresql.org/docs
- Redis Docs: https://redis.io/docs
