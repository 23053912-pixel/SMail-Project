# SMAIL Scaling Quick Start - 100+ Concurrent Users

## ⚡ Quick Setup (Docker Compose - Local/Dev)

### Prerequisites
- Docker & Docker Compose installed
- 8GB+ RAM, 20GB disk space

### 1. Start Everything
```bash
# Navigate to project root
cd "c:\Users\bhand\Downloads\SMAIL SYSTEM\ml portion spam"

# Start all services (PostgreSQL, Redis, ML API, 3x Backend, Nginx)
docker-compose up -d

# Watch logs
docker-compose logs -f
```

### 2. Access the System
```
Frontend:  http://localhost (via Nginx load balancer)
API:       http://localhost/api
Health:    http://localhost/health
Metrics:   http://localhost/metrics
```

### 3. Verify Services Are Running
```bash
# Check all containers
docker-compose ps

# Test database
docker exec smail-postgres psql -U smail_user -d smail_db -c "SELECT 1"

# Test Redis
docker exec smail-redis redis-cli ping

# Test ML API
curl http://localhost:5001/health

# Check load balancer
curl http://localhost/health
```

---

## 🚀 Production Setup (GCP + Kubernetes)

### Quick Commands
```bash
# 1. Setup GCP project
gcloud projects create smail-prod
gcloud config set project smail-prod

# 2. Create GKE cluster
gcloud container clusters create smail-cluster \
  --zone us-central1-a --num-nodes 3 \
  --machine-type n1-standard-2 \
  --enable-autoscaling --min-nodes 3 --max-nodes 10

# 3. Get credentials
gcloud container clusters get-credentials smail-cluster --zone us-central1-a

# 4. Build and push images
docker build -t gcr.io/smail-prod/smail-backend:latest -f Dockerfile.backend .
docker push gcr.io/smail-prod/smail-backend:latest

docker build -t gcr.io/smail-prod/smail-ml-api:latest -f ml-engine/core/predictive/Dockerfile ./ml-engine/core/predictive
docker push gcr.io/smail-prod/smail-ml-api:latest

# 5. Deploy to Kubernetes
kubectl apply -f k8s-gcp-deployment.yaml

# 6. Monitor deployment
kubectl get pods -n smail -w
kubectl logs -n smail deployment/backend -f
```

---

## 📊 Scaling Architecture

### Components
- **Frontend**: Static assets (HTML/CSS/JS)
- **Nginx**: L7 Load balancer (ports 80, 443)
- **Backend**: 5+ replicas (Node.js with clustering)
  - Each replica: 4 worker processes
  - 20 database connections per replica
- **PostgreSQL**: Managed database (20GB+)
- **Redis**: Session & cache store (5GB)
- **ML API**: 2+ replicas (PyTorch predictions)

### Resource Allocation (Per Backend Replica)
```
CPU:      250m-500m
Memory:   256Mi-512Mi
Database: 20 connections
Sessions: Stored in Redis
```

### Capacity Map
```
1 replica   = ~20 concurrent users
5 replicas  = ~100 concurrent users
10 replicas = ~200 concurrent users
20 replicas = ~400+ concurrent users
```

---

## 🔍 Monitoring & Debugging

### Check Scaling Status
```bash
# Watch autoscaling in real-time
kubectl get hpa -n smail -w

# View deployment metrics
kubectl top pods -n smail --sort-by=memory

# Check resource usage by container
kubectl describe pod POD_NAME -n smail
```

### View Logs
```bash
# Real-time logs from all backend pods
kubectl logs -n smail -l app=backend -f

# Specific pod logs
kubectl logs -n smail deployment/backend -f

# Previous pod logs (if crashed)
kubectl logs CRASHED_POD_NAME -n smail --previous
```

### Performance Metrics
```bash
# Database connections
gcloud sql operations list --instance=smail-postgres --limit=10

# Redis memory usage
gcloud redis instances describe smail-redis --region us-central1

# API response times
kubectl exec -n smail deployment/backend -- curl http://localhost:3000/metrics
```

---

## 🐛 Common Issues & Solutions

### Issue: Pods not scaling
**Solution**: Check HPA status
```bash
kubectl describe hpa -n smail
kubectl top nodes
```

### Issue: Database connection pool exhausted
**Solution**: Increase pool size in `server-scaled.js`
```javascript
const pool = new Pool({
  max: 40,  // Increase from 20
  // ...
});
```

### Issue: Redis memory full
**Solution**: Check and increase Redis instance size
```bash
gcloud redis instances update smail-redis \
  --size 10 \
  --region us-central1
```

### Issue: ML API timeout
**Solution**: Scale up ML API replicas
```bash
kubectl scale deployment ml-api --replicas=4 -n smail
```

### Issue: High latency
**Solution**: Check database query performance
```sql
SELECT * FROM pg_stat_statements 
ORDER BY total_time DESC LIMIT 10;
```

---

## 📈 Load Testing

### Simple Manual Test
```bash
# Load test with 100 concurrent requests
for i in {1..100}; do
  curl -s http://localhost/api/emails/inbox &
done
wait

# Monitor scaling
watch -n 1 'kubectl get hpa -n smail'
```

### Advanced Test (K6)
```javascript
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '1m', target: 0 },
  ],
};

export default function() {
  let res = http.post('http://localhost:3000/api/emails/inbox');
  check(res, { 'status 200': r => r.status === 200 });
}
```

Run: `k6 run load-test.js`

---

## 📦 Deployment Checklist

- [ ] PostgreSQL configured and accessible
- [ ] Redis cluster running and healthy
- [ ] ML API deployed and responding
- [ ] Nginx load balancer configured
- [ ] 5+ backend replicas deployed
- [ ] HPA configured with proper thresholds
- [ ] Monitoring and alerts configured
- [ ] SSL certificates installed
- [ ] DNS pointing to load balancer
- [ ] Load testing completed successfully
- [ ] Backup strategy implemented
- [ ] Rollback plan documented

---

## 📞 Need Help?

Refer to:
1. **SCALING_GUIDE_GCP.md** - Full GCP deployment guide
2. **ARCHITECTURE_RESTRUCTURED.md** - Service architecture
3. **GCP Documentation** - https://cloud.google.com/docs
4. **Kubernetes Docs** - https://kubernetes.io/docs

---

## Quick Commands Reference

```bash
# Docker Compose
docker-compose up -d         # Start all services
docker-compose down          # Stop all services
docker-compose logs -f       # View logs
docker-compose ps            # Check status

# Kubernetes
kubectl get pods -n smail    # List pods
kubectl logs -n smail POD    # View logs
kubectl delete pod POD -n smail  # Restart pod
kubectl scale deployment DEPLOY --replicas=5 -n smail  # Scale

# GCP
gcloud sql instances list     # List databases
gcloud redis instances list   # List Redis
gcloud container clusters list  # List clusters
gcloud container clusters get-credentials CLUSTER --zone ZONE
```

---

**Congratulations!** Your SMAIL system is now ready to handle **100+ concurrent users seamlessly!** 🎉
