# RelayIt - Self-Hosted Notification Service

RelayIt is a self-hosted notification delivery service that abstracts the complexities of integrating with multiple communication APIs. Send messages across Email, SMS, WhatsApp, and Discord through a single, reliable endpoint.

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- PostgreSQL 16+
- Redis 7+

### 1. Environment Setup

Copy the example environment file and customize it:

```bash
cp env.example .env
```

Or create a `.env` file in the project root:

```bash
# Core Configuration
GITHUB_REPOSITORY_OWNER=your-github-username
IMAGE_TAG=latest

# URLs (adjust for your deployment)
API_URL=http://localhost:3005
WEB_URL=http://localhost:3000

# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-secure-password
POSTGRES_DB=relayit

# Redis
REDIS_URL=redis://redis:6379

# Authentication
BETTER_AUTH_SECRET=your-very-secure-secret-key-here
BETTER_AUTH_URL=http://localhost:3005
FRONTEND_URL=http://localhost:3000

# Encryption
CREDENTIAL_ENCRYPTION_KEY=your-32-character-encryption-key
```

### 2. Deploy with Docker Compose

```bash
# Pull the latest images and start services
docker-compose pull
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

### 3. Access Your Instance

- **Web Dashboard**: http://localhost:3000
- **API**: http://localhost:3005
- **API Documentation**: http://localhost:3005/docs

## 📦 Individual Container Deployment

If you prefer to run containers individually or use an orchestrator like Kubernetes:

### Core Services

#### API Service
```bash
docker run -d \
  --name relayit-api \
  -p 3005:3005 \
  -e DATABASE_URL="postgres://user:pass@host:5432/relayit" \
  -e REDIS_URL="redis://redis:6379" \
  -e BETTER_AUTH_SECRET="your-secret" \
  -e CREDENTIAL_ENCRYPTION_KEY="your-key" \
  ghcr.io/your-username/relayit-api:latest
```

#### Worker Service
```bash
docker run -d \
  --name relayit-worker \
  -e DATABASE_URL="postgres://user:pass@host:5432/relayit" \
  -e REDIS_URL="redis://redis:6379" \
  -e CREDENTIAL_ENCRYPTION_KEY="your-key" \
  ghcr.io/your-username/relayit-worker:latest
```

#### Web Dashboard
```bash
docker run -d \
  --name relayit-web \
  -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL="http://localhost:3005" \
  -e NEXT_PUBLIC_FRONTEND_URL="http://localhost:3000" \
  ghcr.io/your-username/relayit-web:latest
```

## 🔧 Configuration

### Environment Variables

| Variable                    | Description                                          | Required | Default               |
| --------------------------- | ---------------------------------------------------- | -------- | --------------------- |
| `DATABASE_URL`              | PostgreSQL connection string                         | ✅        | -                     |
| `REDIS_URL`                 | Redis connection string                              | ✅        | -                     |
| `BETTER_AUTH_SECRET`        | Secret key for authentication                        | ✅        | -                     |
| `CREDENTIAL_ENCRYPTION_KEY` | 32-character key for encrypting provider credentials | ✅        | -                     |
| `API_URL`                   | Public URL of your API service                       | ✅        | http://localhost:3005 |
| `WEB_URL`                   | Public URL of your web dashboard                     | ✅        | http://localhost:3000 |
| `GITHUB_REPOSITORY_OWNER`   | Your GitHub username for pulling images              | ✅        | -                     |
| `IMAGE_TAG`                 | Docker image tag to use                              | ❌        | latest                |

### Image Tags

| Tag        | Description                            |
| ---------- | -------------------------------------- |
| `latest`   | Latest stable release from main branch |
| `dev`      | Development builds from dev branch     |
| `v1.0.0`   | Specific version releases              |
| `abc12345` | Specific commit SHA builds             |

## 🏗️ Production Deployment

### 1. Reverse Proxy Setup

Use nginx or similar to handle SSL and routing:

```nginx
# /etc/nginx/sites-available/relayit
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # API endpoints
    location /api/ {
        proxy_pass http://localhost:3005;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # Web dashboard
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 2. Environment Variables for Production

Update your `.env` file:

```bash
# Production URLs
API_URL=https://your-domain.com/api
WEB_URL=https://your-domain.com

# Use specific image versions in production
IMAGE_TAG=v1.0.0

# Strong secrets
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

### 3. Database Setup

For production, use a managed PostgreSQL instance or set up replication:

```sql
-- Create database and user
CREATE DATABASE relayit;
CREATE USER relayit_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE relayit TO relayit_user;
```

### 4. Scaling

Scale worker services based on load:

```bash
# Scale workers with docker-compose
docker-compose up -d --scale worker=3

# Or run additional worker containers
docker run -d --name relayit-worker-2 \
  -e DATABASE_URL="..." \
  -e REDIS_URL="..." \
  ghcr.io/your-username/relayit-worker:latest
```

## 🔍 Monitoring & Logs

### Health Checks

- **API Health**: `GET /health`
- **Database Status**: Check PostgreSQL logs
- **Queue Status**: Monitor Redis memory usage

### Log Locations

```bash
# Container logs
docker-compose logs api
docker-compose logs worker
docker-compose logs web

# Follow logs in real-time
docker-compose logs -f --tail=100
```

### Metrics

Monitor these key metrics:
- Message queue length (Redis)
- Database connection pool usage
- API response times
- Worker processing rates

## 🐛 Troubleshooting

### Common Issues

**Database Connection Failures**
```bash
# Check if PostgreSQL is running
docker-compose ps postgres

# Check connection from API container
docker-compose exec api psql $DATABASE_URL -c "SELECT 1;"
```

**Redis Connection Issues**
```bash
# Test Redis connectivity
docker-compose exec api redis-cli -u $REDIS_URL ping
```

**Image Pull Failures**
```bash
# Authenticate with GitHub Package Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin

# Pull images manually
docker pull ghcr.io/your-username/relayit-api:latest
```

### Getting Help

- Check the [troubleshooting documentation](./docs/overview.md)
- Review container logs for specific error messages
- Ensure all environment variables are properly set

## 📚 API Usage

Once deployed, you can start sending notifications:

```bash
# Create an API key in the web dashboard first
curl -X POST https://your-domain.com/api/send \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "email",
    "recipient": "user@example.com",
    "subject": "Hello from RelayIt!",
    "content": "Your notification service is working!"
  }'
```

## 🤝 Contributing

This is an open-source project. Feel free to:
- Report issues
- Submit pull requests
- Suggest improvements
- Add new provider integrations

## 📄 License

See [LICENSE](LICENSE) file for details. 