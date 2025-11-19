# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Menu Combo** is an AI-powered restaurant menu recommendation system that allows users to upload menu images, extracts items via OCR, and provides personalized meal combination recommendations.

**Current Status**: Foundation/MVP stage. Authentication, file upload, and database infrastructure are complete. OCR and AI recommendation features are planned but not implemented.

**Stack**: React (TypeScript + Vite) frontend deployed on Cloudflare Pages, Node.js Express backend running on AWS Lambda via Serverless Framework, PostgreSQL on AWS RDS.

## Architecture

### System Components

```
React Frontend (Cloudflare Pages)
    ↓ (JWT Bearer Token)
AWS API Gateway (HTTP API)
    ↓
AWS Lambda (Express.js via serverless-http)
    ├→ AWS RDS (PostgreSQL)
    ├→ AWS S3 (Image Storage)
    └→ AWS Secrets Manager (Credentials)
```

### Authentication Flow

- **Provider**: AWS Cognito (OAuth 2.0 / OIDC)
- **Frontend**: `react-oidc-context` handles OAuth code exchange and token management
- **Backend**: JWT verification middleware in `menu-combo-backend/middleware/auth.js` verifies tokens using Cognito JWKS public keys
- **Token Format**: Access token contains `sub` (user ID) claim, used as primary key in `users` table
- **Important**: Email is NOT in the access token payload by default; only `sub` is guaranteed

### Database Schema

The PostgreSQL schema (`menu-combo-backend/db/schema.sql`) follows this relationship model:

```
users (Cognito sub as PK)
  ↓ CASCADE DELETE
uploads (menu images)
  ├→ menu_items (OCR results - future)
  └→ recommendations (AI suggestions - future)

users
  └→ user_preferences (dietary restrictions - future)
```

**Key Design Decisions**:
- `user_id` is Cognito `sub` (UUID from JWT), not auto-generated
- Cascade deletes ensure orphaned data cleanup
- Indexes on `user_id`, `created_at` for efficient queries
- Triggers auto-update `updated_at` timestamps

### Lambda Execution Model

**Critical Concepts**:
- **Connection Pooling**: Database pool instance stored in global variable (`dbPool`) and reused across warm invocations. Configured with max 10 connections, 30s idle timeout.
- **Secrets Caching**: Database credentials fetched from Secrets Manager on cold start and cached globally.
- **Cold Starts**: First request after idle takes 1-3s. Subsequent requests <100ms.
- **Timeout**: 30 seconds (configurable in `serverless.yml`)
- **Environment Variables**: Injected from `serverless.yml`, NOT from `.env` files (which are for local testing only)

### File Upload Architecture

**Current Implementation** (direct upload via Lambda):
1. Frontend sends multipart/form-data (max 5 images) to `/upload`
2. Lambda receives files in memory (`express-fileupload`)
3. Lambda uploads to S3 with key pattern: `uploads/{userId}/{timestamp}_{index}_{filename}`
4. Lambda inserts record into `uploads` table
5. Returns upload IDs and S3 URLs

**Future Consideration**: Presigned URL uploads to reduce Lambda execution time and cost.

### CORS Configuration

CORS is configured at **TWO levels** (both must be correct):
1. **API Gateway**: `serverless.yml` → `httpApi.cors` section
2. **Express Middleware**: `menu-combo-backend/handler.js` → `cors()` middleware

Allowed origins: `http://localhost:5173`, `https://menu-combo.peiwen.dev`

Must explicitly allow `Authorization` header for JWT authentication.

## Common Development Commands

### Backend (menu-combo-backend/)

```bash
# Deploy to AWS (creates/updates Lambda, API Gateway, S3, IAM roles)
serverless deploy

# View live logs
serverless logs -f api --tail

# Tail CloudWatch logs (alternative method)
aws logs tail /aws/lambda/menu-combo-backend-dev-api --follow --since 5m

# Remove all AWS resources
serverless remove
```

### Frontend (frontend/)

```bash
# Dev server (http://localhost:5173)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

### Database Operations

```bash
# Initialize/reset database schema (via API)
curl https://hymek82qkl.execute-api.us-east-1.amazonaws.com/init-db

# Connect to PostgreSQL directly
PGPASSWORD='menu1234uiop' psql \
  -h menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com \
  -U menuuser \
  -d menu-db \
  -p 5432

# Run query directly
PGPASSWORD='menu1234uiop' psql -h menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com -U menuuser -d menu-db -c "SELECT * FROM uploads;"
```

### Testing API Endpoints

```bash
# Health check
curl https://hymek82qkl.execute-api.us-east-1.amazonaws.com/

# Test database connection
curl https://hymek82qkl.execute-api.us-east-1.amazonaws.com/testdb

# Upload with authentication (requires valid JWT token)
curl -X POST https://hymek82qkl.execute-api.us-east-1.amazonaws.com/upload \
  -H "Authorization: Bearer <COGNITO_ACCESS_TOKEN>" \
  -F "images=@menu.jpg"
```

## Key Configuration Files

### serverless.yml (Backend Deployment)

- **Organization**: `peiwen`
- **App**: `menu-combo`
- **Service**: `menu-combo-backend`
- **Runtime**: Node.js 20.x (ES Modules - uses `import`/`export`, not `require`)
- **Region**: us-east-1
- **IAM Permissions**: Lambda can access S3 (`GetObject`, `PutObject`) and Secrets Manager (`GetSecretValue`)
- **HTTP API Events**: Routes like `ANY /`, `POST /upload`, `GET /uploads`
- **Resources**: Creates S3 bucket `menu-combo-uploads` with CORS configuration

### vite.config.ts (Frontend Build)

- **Path Alias**: `@` → `./src` (allows imports like `@/components/ui/button`)
- **Plugins**: React + Tailwind CSS

### components.json (shadcn/ui)

- **Style**: `new-york`
- **Icon Library**: `lucide-react`
- **Components Path**: `frontend/src/components/ui`
- **Utils Path**: `frontend/src/lib/utils`

## Environment Variables

### Backend (Lambda)

Set in `serverless.yml` → `provider.environment`:
- `BUCKET_NAME`: S3 bucket name (`menu-combo-uploads`)
- `DB_SECRET_ARN`: ARN for database credentials secret
- `CLAUDE_API_KEY`: ARN for Claude API key secret (future OCR/AI features)

**Note**: `.env` files in `menu-combo-backend/` are ONLY for local testing and are NOT deployed to Lambda.

### Frontend

Set in `frontend/.env`:
- `VITE_API_BASE`: API Gateway base URL
- `VITE_FRONTEND_BASE_URL`: Frontend URL for OAuth redirect (changes between dev/prod)

**Note**: Must be prefixed with `VITE_` to be accessible in browser.

## AWS Resources

### Cognito User Pool
- **Pool ID**: `us-east-1_FEaytr2dj`
- **Client ID**: `2db2nfb6pnt886n0pfq1uhsb6t`
- **Domain**: `us-east-1feaytr2dj.auth.us-east-1.amazoncognito.com`

### API Gateway
- **Base URL**: `https://hymek82qkl.execute-api.us-east-1.amazonaws.com`

### RDS PostgreSQL
- **Endpoint**: `menu-db.cq7eu8cumvwf.us-east-1.rds.amazonaws.com:5432`
- **Database**: `menu-db`
- **User**: `menuuser`
- **Password**: Stored in Secrets Manager (`menu-db` secret)
- **Public Access**: ENABLED (development only - should be private in production)

### S3 Bucket
- **Name**: `menu-combo-uploads`
- **CORS**: Enabled for frontend origins
- **Object Pattern**: `uploads/{userId}/{timestamp}_{index}_{filename}`

### Secrets Manager
- `menu-db` (ARN: `arn:aws:secretsmanager:us-east-1:024848456604:secret:menu-db-dZh6zJ`) - PostgreSQL credentials
- `menu-claude-api-key` (ARN: `arn:aws:secretsmanager:us-east-1:024848456604:secret:menu-claude-api-key-PtNVh4`) - Claude API key

## Important Development Notes

### Lambda + Express Integration

- Lambda function wraps Express app using `serverless-http`
- Express routes defined in `menu-combo-backend/handler.js`
- Export format: `export const handler = serverlessHttp(app);` (ES Modules)
- Any Express middleware works normally (CORS, file upload, JSON parsing)

### Database Connection Best Practices

- Use the global `dbPool` instance (already initialized in `handler.js`)
- Do NOT create new pool instances per request (causes connection exhaustion)
- Pool auto-manages connections (acquires, releases, reuses)
- SSL enabled with `rejectUnauthorized: false` for RDS

### JWT Authentication

- Protected routes use `authenticateToken` middleware from `middleware/auth.js`
- Middleware extracts `sub` claim from JWT and attaches to `req.userId`
- JWKS public keys fetched from Cognito on Lambda cold start and cached
- Token verification happens on every request (stateless)

### shadcn/ui Components

- Components installed in `frontend/src/components/ui/`
- Use path alias: `import { Button } from '@/components/ui/button'`
- Tailwind CSS with CSS variables for theming
- Add new components with: `npx shadcn@latest add <component>`

### Deployment Workflow

**Backend Changes**:
1. Edit code in `menu-combo-backend/`
2. Run `serverless deploy`
3. Test via curl or frontend

**Frontend Changes**:
1. Edit code in `frontend/src/`
2. Vite hot-reloads automatically
3. Push to Git → Cloudflare Pages auto-deploys

**Database Schema Changes**:
1. Edit `menu-combo-backend/db/schema.sql`
2. Call `/init-db` endpoint to apply (drops and recreates tables)
3. **WARNING**: This destroys all data - implement migrations for production

## Future Development

Planned features (see `LEARNING_NOTES.md` for extensive Chinese documentation):

1. **OCR Integration**: Create `/ocr` endpoint using AWS Bedrock or Claude API to parse menu images
2. **AI Recommendations**: Create `/recommend` endpoint to generate meal combinations based on extracted menu items and user preferences
3. **Presigned URL Uploads**: Move from direct Lambda upload to presigned URL pattern to reduce costs
4. **VPC Configuration**: Move Lambda into VPC private subnet and make RDS private
5. **API Rate Limiting**: Implement throttling using AWS WAF or API Gateway

## Repository Notes

- `frontend-next/` directory exists but is not actively used (Next.js alternative)
- `backend/` directory was deleted (see git status) - only `menu-combo-backend/` is current
- `.serverless/` contains auto-generated deployment artifacts (gitignored)
- `LEARNING_NOTES.md` contains extensive Chinese documentation of development process and technical decisions
