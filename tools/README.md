# Tools Directory

This directory contains development tools, scripts, and Docker configurations for the AI Document Assistant project.

## 📁 Structure

```
tools/
├── docker/                     # Docker configurations
│   ├── docker-compose.yml      # Infrastructure services (PostgreSQL, Redis, MinIO)
│   ├── docker-compose.dev.yml  # Full development environment
│   ├── Dockerfile.backend      # Backend container
│   └── Dockerfile.frontend     # Frontend container
└── scripts/                    # Development scripts
    ├── dev-setup.sh            # Complete development setup
    ├── start-services.sh       # Start infrastructure services
    ├── stop-services.sh        # Stop infrastructure services
    ├── reset-dev.sh            # Reset development environment
    └── setup-minio.ts          # MinIO bucket setup script
```

## 🚀 Quick Start

### 1. Complete Development Setup

```bash
./tools/scripts/dev-setup.sh
```

This script will:

- Install dependencies
- Start infrastructure services
- Setup MinIO bucket
- Run database migrations
- Seed sample data

### 2. Start/Stop Services Only

```bash
# Start infrastructure services
./tools/scripts/start-services.sh

# Stop services
./tools/scripts/stop-services.sh
```

### 3. Reset Environment

```bash
./tools/scripts/reset-dev.sh
```

⚠️ **Warning**: This will delete all data including database, Redis cache, and MinIO files!

## 🐳 Docker Configurations

### Infrastructure Services (`docker-compose.yml`)

- **PostgreSQL 15**: Database on port 5432
- **Redis 7**: Cache on port 6379
- **MinIO**: Object storage on ports 9000 (API) and 9001 (Console)

### Full Development (`docker-compose.dev.yml`)

- All infrastructure services
- **Backend**: NestJS API on port 3001
- **Frontend**: Next.js app on port 3000

## 📊 Service URLs

| Service       | URL                   | Credentials              |
| ------------- | --------------------- | ------------------------ |
| Frontend      | http://localhost:3000 | -                        |
| Backend API   | http://localhost:3001 | -                        |
| PostgreSQL    | localhost:5432        | postgres/postgres        |
| Redis         | localhost:6379        | -                        |
| MinIO API     | http://localhost:9000 | minioadmin/minioadmin123 |
| MinIO Console | http://localhost:9001 | minioadmin/minioadmin123 |

## 🛠️ Development Workflow

1. **Initial Setup**:

   ```bash
   ./tools/scripts/dev-setup.sh
   ```

2. **Daily Development**:

   ```bash
   # Start services
   ./tools/scripts/start-services.sh

   # Start backend (in separate terminal)
   cd apps/backend && pnpm dev

   # Start frontend (in separate terminal)
   cd apps/frontend && pnpm dev
   ```

3. **When Done**:
   ```bash
   ./tools/scripts/stop-services.sh
   ```

## 🔧 Useful Commands

### Docker Management

```bash
# View running containers
docker compose -f tools/docker/docker-compose.yml ps

# View logs
docker compose -f tools/docker/docker-compose.yml logs -f

# View specific service logs
docker compose -f tools/docker/docker-compose.yml logs -f postgres

# Execute commands in containers
docker compose -f tools/docker/docker-compose.yml exec postgres psql -U postgres -d ai_document_assistant
```

### Database Management

```bash
# Run migrations
cd apps/backend && pnpm exec prisma migrate dev

# Reset database
cd apps/backend && pnpm exec prisma migrate reset

# View database
cd apps/backend && pnpm exec prisma studio
```

### MinIO Management

```bash
# Setup bucket
cd apps/backend && pnpm exec tsx ../../tools/scripts/setup-minio.ts

# Access MinIO Console
open http://localhost:9001
```

## 🐛 Troubleshooting

### Services Won't Start

```bash
# Check Docker is running
docker info

# Check port conflicts
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis
lsof -i :9000  # MinIO API
lsof -i :9001  # MinIO Console
```

### Database Issues

```bash
# Reset database completely
./tools/scripts/reset-dev.sh

# Or just reset database
cd apps/backend && pnpm exec prisma migrate reset
```

### MinIO Issues

```bash
# Recreate MinIO bucket
cd apps/backend && pnpm exec tsx ../../tools/scripts/setup-minio.ts

# Check MinIO logs
docker compose -f tools/docker/docker-compose.yml logs -f minio
```

## 📝 Notes

- All scripts assume you're running from the project root directory
- Infrastructure services use Docker volumes for data persistence
- MinIO is configured as S3-compatible storage for development
- Environment variables are configured in docker-compose files
- For production deployment, use separate configurations
