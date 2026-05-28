# CORS Solution for Google Cloud Run Deployment

This document explains how we solved the CORS (Cross-Origin Resource Sharing) problem when deploying a frontend and backend application on Google Cloud Run, where the frontend needs to communicate with the backend API.

## Table of Contents

1. [The Problem](#the-problem)
2. [Understanding CORS](#understanding-cors)
3. [Symptoms We Encountered](#symptoms-we-encountered)
4. [Why This Happens](#why-this-happens)
5. [The Solution](#the-solution)
6. [How It Works](#how-it-works)
7. [Complete Implementation](#complete-implementation)
8. [Deployment on Google Cloud Run](#deployment-on-google-cloud-run)
9. [Frontend Configuration](#frontend-configuration)
10. [API Route Configuration and Path Matching](#api-route-configuration-and-path-matching)
11. [Troubleshooting](#troubleshooting)

---

## The Problem

When deploying a frontend (Next.js) and backend (Express.js) application on Google Cloud Run, the browser blocks cross-origin requests from the frontend to the backend because:

1. The frontend is served from one Cloud Run service (e.g., `https://frontend-app-xxx.run.app`)
2. The backend API is served from another Cloud Run service (e.g., `https://backend-app-xxx.run.app`)
3. These are different origins, triggering CORS restrictions

The browser sends a **preflight OPTIONS request** before the actual request, and if the backend doesn't respond with the correct CORS headers, the browser blocks the actual request.

---

## Understanding CORS

CORS (Cross-Origin Resource Sharing) is a security mechanism implemented by web browsers to prevent websites from making requests to different domains unless explicitly allowed.

### Preflight Requests

For certain types of requests (like `PUT`, `POST` with custom headers, etc.), browsers send an **OPTIONS** request first (called a "preflight" request) to check if the server allows the actual request.

The server must respond to OPTIONS requests with these headers:
- `Access-Control-Allow-Origin`: The allowed origin (e.g., `https://frontend-app-xxx.run.app` or `*`)
- `Access-Control-Allow-Methods`: Allowed HTTP methods (e.g., `GET,PUT,POST,DELETE,OPTIONS`)
- `Access-Control-Allow-Headers`: Allowed request headers
- `Access-Control-Allow-Credentials`: Whether credentials (cookies, auth headers) are allowed
- `Access-Control-Max-Age`: How long the preflight response can be cached

---

## Symptoms We Encountered

### Browser Console Errors

```
Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at 
https://backend-app-xxx.run.app/api/policy_research/. 
(Reason: CORS header 'Access-Control-Allow-Origin' missing). Status code: 200.
```

### Network Tab Observations

- The **OPTIONS** request receives a `200 OK` response
- But the response headers are missing `Access-Control-Allow-Origin`
- The browser blocks the subsequent PUT/POST request
- Status code shows as `(null)` or `CORS request did not succeed`

### Backend Logs

We saw logs from the `cors` package (`🌐 CORS origin check`), but no logs from our OPTIONS handler, indicating the middleware wasn't intercepting OPTIONS requests.

---

## Why This Happens

### Express.js Middleware Order Matters

In Express.js, **middleware order is critical**. Middleware is executed in the order it's registered:

1. Middleware registered first runs first
2. If a route matches before middleware runs, the middleware won't execute for that route
3. OPTIONS requests need to be handled **before** routes are registered

### The Parent Class Problem

Our backend extends `PolicySynthApiApp` from `@policysynth/api`. The parent constructor does this:

```javascript
// From @policysynth/api/app.js
constructor(controllers, port) {
  this.initializeMiddlewares();  // ← Middleware registered here
  this.setupStaticPaths();
  this.initializeControllers(controllers);  // ← Routes registered here
  this.setupDb();
}
```

If we tried to add CORS middleware **after** calling `super()`, the routes were already registered, and our middleware might not intercept OPTIONS requests properly.

---

## The Solution

We **override the `initializeMiddlewares()` method** to add CORS middleware **before** the parent's middleware runs.

### Key Insight

By overriding `initializeMiddlewares()`, we can:
1. Add our OPTIONS handler FIRST
2. Add the `cors` package middleware
3. Then call `super.initializeMiddlewares()` to add parent middleware
4. Routes are registered later, but our middleware is already in the stack

This ensures OPTIONS requests are intercepted and handled correctly before any route logic runs.

---

## How It Works

### Middleware Stack Order (After Fix)

```
1. Our OPTIONS Handler Middleware
   ↓ (intercepts OPTIONS requests, sets headers, responds)
2. cors Package Middleware
   ↓ (handles other CORS for non-OPTIONS requests)
3. Parent Middleware (bodyParser, session, etc.)
   ↓
4. Routes (controllers)
   ↓
5. Static file serving
```

### Request Flow

```
Browser Request (PUT /api/policy_research/)
  ↓
1. Browser sends OPTIONS preflight
  ↓
2. Our OPTIONS handler intercepts it
   - Sets Access-Control-Allow-Origin header
   - Sets Access-Control-Allow-Methods header
   - Sets Access-Control-Allow-Headers header
   - Responds with 200 OK
  ↓
3. Browser receives correct CORS headers
  ↓
4. Browser sends actual PUT request
  ↓
5. cors middleware adds CORS headers to response
  ↓
6. Route handler processes request
  ↓
7. Response sent with CORS headers
```

---

## Complete Implementation

### Backend: Custom CORS Configuration

**File:** `backend/src/customApp.ts`

```typescript
import { PolicySynthApiApp } from '@policysynth/api/app.js';
import cors from 'cors';

export class CustomPolicySynthApiApp extends PolicySynthApiApp {
  constructor(controllers: any[], port?: number) {
    console.log('🚀 CustomPolicySynthApiApp constructor called');
    super(controllers, port);
    console.log('✅ Parent constructor completed, applying CORS...');
    this.applyCorsToApp();
    console.log('✅ CORS application completed');
  }

  // Override initializeMiddlewares to add CORS BEFORE parent middleware
  initializeMiddlewares() {
    console.log('🔧 Setting up CORS middleware FIRST...');
    
    // Handle OPTIONS requests FIRST - before anything else
    this.app.use((req, res, next) => {
      if (req.method === 'OPTIONS') {
        const origin = req.headers.origin;
        console.log(`🚀🚀🚀 INTERCEPTING OPTIONS: ${req.method} ${req.path} from origin: ${origin}`);
        
        // Set all required CORS headers
        if (origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,HEAD,PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization,Cache-Control,X-HTTP-Method-Override');
        res.setHeader('Access-Control-Max-Age', '86400');
        
        console.log('✅✅✅ OPTIONS preflight headers set');
        return res.status(200).end();
      }
      next();
    });
    
    // Use cors package for all requests
    const corsOptions = {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        callback(null, true); // Allow all origins
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
      allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Cache-Control', 'X-HTTP-Method-Override'],
      exposedHeaders: ['Content-Length'],
      preflightContinue: false,
      optionsSuccessStatus: 200
    };
    this.app.use(cors(corsOptions));
    
    // Now call parent's initializeMiddlewares
    super.initializeMiddlewares();
    
    console.log('✅ CORS middleware fully configured');
  }

  private applyCorsToApp() {
    // Add middleware to ensure CORS headers on all responses (backup)
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
      }
      next();
    });
  }
}
```

### Why Each Part Exists

1. **Custom OPTIONS Handler**: Explicitly intercepts OPTIONS requests and sets all required headers. This ensures preflight requests are handled correctly.

2. **cors Package**: Provides additional CORS handling for non-OPTIONS requests and acts as a backup.

3. **Backup Middleware (`applyCorsToApp`)**: Adds CORS headers to all responses as a safety net.

4. **Method Override**: By overriding `initializeMiddlewares()`, we control the middleware order, ensuring CORS runs first.

---

## Deployment on Google Cloud Run

### Backend Dockerfile

The backend Dockerfile doesn't need special CORS configuration - the code handles it. Ensure the backend is built and deployed:

```bash
# Build backend
cd backend
docker build -t gcr.io/YOUR_PROJECT_ID/backend-app:latest .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT_ID/backend-app:latest

# Deploy to Cloud Run
gcloud run deploy backend-app \
  --image gcr.io/YOUR_PROJECT_ID/backend-app:latest \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --port 5029
```

### Frontend Dockerfile Configuration

**File:** `frontend/Dockerfile`

Next.js requires `NEXT_PUBLIC_*` environment variables to be available at **build time** (they're baked into the client-side bundle). We use Docker build arguments:

```dockerfile
FROM node:16.17-alpine
LABEL maintainer="hello@vizzuality.com"

# Accept build arguments for backend URLs
ARG NEXT_PUBLIC_RESEARCH_WS_URL
ARG NEXT_PUBLIC_RESEARCH_API_URL
ARG NEXT_PUBLIC_AUTH_CALLBACK

# Set as environment variables (available during build)
ENV NEXT_PUBLIC_RESEARCH_WS_URL=$NEXT_PUBLIC_RESEARCH_WS_URL
ENV NEXT_PUBLIC_RESEARCH_API_URL=$NEXT_PUBLIC_RESEARCH_API_URL
ENV NEXT_PUBLIC_AUTH_CALLBACK=$NEXT_PUBLIC_AUTH_CALLBACK

# ... other configuration ...

# Copy files
COPY frontend/package.json .
COPY frontend/yarn.lock .
# ... other COPY commands ...

RUN yarn install --immutable

# Create/update .env.production with NEXT_PUBLIC_* variables from build args
# This ensures Next.js can read them during build
RUN touch .env.production && \
    if [ -n "$NEXT_PUBLIC_RESEARCH_WS_URL" ]; then \
      echo "NEXT_PUBLIC_RESEARCH_WS_URL=$NEXT_PUBLIC_RESEARCH_WS_URL" >> .env.production; \
    fi && \
    if [ -n "$NEXT_PUBLIC_RESEARCH_API_URL" ]; then \
      echo "NEXT_PUBLIC_RESEARCH_API_URL=$NEXT_PUBLIC_RESEARCH_API_URL" >> .env.production; \
    fi && \
    if [ -n "$NEXT_PUBLIC_AUTH_CALLBACK" ]; then \
      echo "NEXT_PUBLIC_AUTH_CALLBACK=$NEXT_PUBLIC_AUTH_CALLBACK" >> .env.production; \
    fi

RUN yarn build

EXPOSE 3000
CMD ["yarn", "start"]
```

### Building Frontend with Backend URLs

```bash
# Build frontend with backend URLs as build arguments
cd /path/to/project/root

docker build \
  --build-arg NEXT_PUBLIC_RESEARCH_API_URL=https://backend-app-xxx.run.app \
  --build-arg NEXT_PUBLIC_RESEARCH_WS_URL=wss://backend-app-xxx.run.app/ws \
  --build-arg NEXT_PUBLIC_AUTH_CALLBACK=https://resourcewatch.org/auth-callback \
  -f frontend/Dockerfile \
  -t gcr.io/YOUR_PROJECT_ID/frontend-app:latest \
  .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT_ID/frontend-app:latest

# Deploy to Cloud Run
gcloud run deploy frontend-app \
  --image gcr.io/YOUR_PROJECT_ID/frontend-app:latest \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --port 3000
```

### Important Notes

1. **Use `wss://` (not `ws://`) for WebSocket URLs** in production - Cloud Run requires HTTPS/WSS
2. **Build arguments are required** - Without them, Next.js will use default/localhost URLs
3. **Rebuild frontend after backend URL changes** - Since URLs are baked into the bundle at build time

---

## Frontend Configuration

### API Client Configuration

**File:** `frontend/services/research-api.js`

The frontend uses axios to make API requests. Ensure the base URL is correctly set:

```javascript
import axios from 'axios';

// Get API URL from environment variable (set at build time)
const RESEARCH_API_URL = process.env.NEXT_PUBLIC_RESEARCH_API_URL || 'http://localhost:5029';

const researchAPI = axios.create({
  baseURL: RESEARCH_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Axios automatically includes CORS headers for cross-origin requests
  // The browser will send preflight OPTIONS request automatically
});

// Example: PUT request to backend
export const conversation = async (chatLog = [], options = {}) => {
  try {
    // Use /api/policy_research/ to match backend endpoint
    const response = await researchAPI.put('/api/policy_research/', requestPayload);
    return response.data || [];
  } catch (error) {
    logger.error('Error sending research conversation request:', error);
    throw error;
  }
};
```

### WebSocket Connection

```javascript
// WebSocket URL should use wss:// in production
const WS_URL = process.env.NEXT_PUBLIC_RESEARCH_WS_URL || 'ws://localhost:5029/ws';

const ws = new WebSocket(WS_URL);
```

---

## API Route Configuration and Path Matching

### The Problem: 404 Errors for API Routes

After fixing CORS, we encountered **404 Not Found errors** for API routes, specifically:

```
GET https://backend-app-xxx.run.app/policy_research/conversations?userId=xxx
Status: 404 Not Found
```

This occurred because the frontend was calling a path that didn't match the backend's registered routes.

### Root Cause: Path Mismatch

The issue was a **path mismatch** between frontend and backend:

- **Frontend was calling**: `/policy_research/conversations` (missing `/api` prefix)
- **Backend expected**: `/api/policy_research/conversations` (with `/api` prefix)

This happened because:
1. The backend controller defines `path = "/api/policy_research"`
2. Routes are registered as `this.path + "/conversations"` = `/api/policy_research/conversations`
3. The frontend was using the old path without the `/api` prefix

### The Solution: Fix Frontend Paths and Add Backward Compatibility

We implemented a two-part solution:

1. **Fix frontend API calls** to use the correct path with `/api` prefix
2. **Add backward compatibility route** in the backend for the old path (to handle any cached requests)

---

### Backend Implementation: Route Registration with Logging

**File:** `backend/src/controllers/policyResearchController.ts`

The controller registers routes with detailed logging to help debug routing issues:

```typescript
export class PolicyResearchController extends BaseController {
  public path = "/api/policy_research";

  constructor(wsClients: Map<string, WebSocket>) {
    super(wsClients);
    this.initializeRoutes();
  }

  public async initializeRoutes() {
    console.log(`📋 PolicyResearchController: Registering routes with path: ${this.path}`);
    
    // PUT /api/policy_research/ - Start new conversation
    this.router.put(this.path + "/", this.liveResearchChat);
    console.log(`  ✅ Registered PUT ${this.path}/`);
    
    // IMPORTANT: More specific routes must come before parameterized routes
    // Otherwise /conversations will match /:memoryId
    // GET /api/policy_research/conversations - Get user's conversation list
    this.router.get(this.path + "/conversations", this.getUserConversations);
    console.log(`  ✅ Registered GET ${this.path}/conversations`);
    
    // Backward compatibility: Also register without /api prefix
    this.router.get("/policy_research/conversations", this.getUserConversations);
    console.log(`  ✅ Registered GET /policy_research/conversations (backward compatibility)`);
    
    // POST /api/policy_research/conversations/:memoryId/metadata - Update conversation metadata
    this.router.post(this.path + "/conversations/:memoryId/metadata", this.updateConversationMetadata);
    console.log(`  ✅ Registered POST ${this.path}/conversations/:memoryId/metadata`);
    
    // GET /api/policy_research/test - CORS test endpoint
    this.router.get(this.path + "/test", this.testCors);
    console.log(`  ✅ Registered GET ${this.path}/test`);
    
    // GET /api/policy_research/:memoryId - Get chat log for a conversation
    this.router.get(this.path + "/:memoryId", this.getChatLog);
    console.log(`  ✅ Registered GET ${this.path}/:memoryId`);
    
    console.log(`📋 PolicyResearchController: All routes registered`);
  }
  
  // Handler with detailed logging
  private getUserConversations = async (req: express.Request, res: express.Response) => {
    console.log(`📞 getUserConversations called - Method: ${req.method}, Path: ${req.path}, OriginalUrl: ${req.originalUrl}, Query:`, req.query);
    
    const userId = req.query.userId as string;
    
    if (!userId) {
      console.log(`❌ getUserConversations: userId is missing`);
      res.status(400).json({ error: 'userId is required' });
      return;
    }
    
    console.log(`🔍 getUserConversations: Fetching conversations for userId: ${userId}`);
    
    try {
      const conversations = await FirestoreMemoryService.getUserConversations(userId);
      console.log(`✅ getUserConversations: Found ${conversations.length} conversations for userId: ${userId}`);
      res.json({ conversations });
    } catch (error) {
      console.error('❌ Error fetching conversations:', error);
      res.sendStatus(500);
    }
  };
}
```

**Key Points:**

1. **Route Order Matters**: More specific routes (like `/conversations`) must be registered **before** parameterized routes (like `/:memoryId`). Otherwise, Express will match `/conversations` to the `/:memoryId` route.

2. **Backward Compatibility**: The route `/policy_research/conversations` (without `/api`) is registered for backward compatibility, handling cases where the frontend might still use the old path.

3. **Logging**: Detailed logging helps debug routing issues in production:
   - Route registration logs show what routes are available
   - Request handler logs show when routes are matched
   - 404 handler logs show unmatched requests

---

### Backend: 404 Handler for Debugging

**File:** `backend/src/customApp.ts`

We override `initializeControllers()` to add a 404 handler that logs unmatched requests:

```typescript
// Override initializeControllers to add logging and 404 handler
initializeControllers(controllers: any[]) {
  console.log('📦 Initializing controllers...');
  
  // Call parent to register controllers
  super.initializeControllers(controllers);
  
  console.log('📦 Controllers initialized');
  
  // Add 404 handler AFTER all routes are registered
  this.app.use((req, res, next) => {
    console.log(`❌ 404 - Route not found: ${req.method} ${req.originalUrl} (path: ${req.path})`);
    console.log(`   Headers:`, {
      origin: req.headers.origin,
      'user-agent': req.headers['user-agent']?.substring(0, 50)
    });
    res.status(404).json({ 
      error: 'Not found',
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl
    });
  });
}
```

**Why This Helps:**

- The 404 handler runs **after** all routes, catching any unmatched requests
- Detailed logging shows exactly what path was requested
- This helps identify path mismatches between frontend and backend

---

### Frontend Implementation: Correct API Paths

**File:** `frontend/services/research-api.js`

All API calls must use the correct path with `/api` prefix:

```javascript
// Get API URL from environment variable (set at build time)
const RESEARCH_API_URL = process.env.NEXT_PUBLIC_RESEARCH_API_URL || 'http://localhost:5029';

const researchAPI = axios.create({
  baseURL: RESEARCH_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ✅ CORRECT: Use /api/policy_research/conversations (with /api prefix)
export const getUserConversations = async (userId) => {
  logger.info('Getting user conversations for userId:', userId);
  
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  try {
    // Use /api/policy_research/conversations to match backend endpoint
    // (works with direct backend URL in Cloud Run)
    const response = await researchAPI.get(`/api/policy_research/conversations?userId=${userId}`);
    return response.data?.conversations || [];
  } catch (error) {
    logger.error('Error getting user conversations:', error);
    
    // Return empty array on error (don't throw)
    if (error.response && error.response.status === 404) {
      return [];
    }
    
    console.warn('Failed to load user conversations:', error.message);
    return [];
  }
};

// ✅ CORRECT: Use /api/policy_research/ (with /api prefix)
export const conversation = async (chatLog = [], options = {}) => {
  try {
    // Use /api/policy_research/ to match backend endpoint
    const response = await researchAPI.put('/api/policy_research/', requestPayload);
    return response.data || [];
  } catch (error) {
    logger.error('Error sending research conversation request:', error);
    throw error;
  }
};

// ✅ CORRECT: Use /api/policy_research/:memoryId (with /api prefix)
export const getChatLog = async (memoryId) => {
  logger.info('Getting chat log for memory ID:', memoryId);
  
  if (!memoryId) {
    throw new Error('Memory ID is required');
  }
  
  try {
    // Use /api/policy_research/ to match backend endpoint
    const response = await researchAPI.get(`/api/policy_research/${memoryId}`);
    return response.data;
  } catch (error) {
    logger.error('Error getting chat log:', error);
    throw error;
  }
};
```

**Important:** All API endpoints must use the `/api/policy_research/` prefix to match the backend controller's `path` property.

---

### Complete API Route Reference

Here's a complete reference of all API routes:

| Method | Path | Description | Handler |
|--------|------|-------------|---------|
| `PUT` | `/api/policy_research/` | Start new research conversation | `liveResearchChat` |
| `GET` | `/api/policy_research/conversations` | Get user's conversation list | `getUserConversations` |
| `GET` | `/policy_research/conversations` | Get user's conversation list (backward compat) | `getUserConversations` |
| `POST` | `/api/policy_research/conversations/:memoryId/metadata` | Update conversation metadata | `updateConversationMetadata` |
| `GET` | `/api/policy_research/:memoryId` | Get chat log for a conversation | `getChatLog` |
| `GET` | `/api/policy_research/test` | CORS test endpoint | `testCors` |

---

### How Routes Are Registered

**File:** `backend/node_modules/@policysynth/api/app.js`

The parent class registers controllers like this:

```javascript
initializeControllers(controllers) {
  controllers.forEach((ControllerClass) => {
    const controller = new ControllerClass(this.wsClients);
    // Router is mounted at "/" (root), so controller paths are absolute
    this.app.use("/", controller.router);
  });
}
```

This means:
- Controller routers are mounted at the root (`/`)
- Controller routes are registered as **absolute paths** (e.g., `/api/policy_research/conversations`)
- Routes defined in the controller's `router` are accessible directly (no additional prefix)

---

### Verifying Routes Are Working

After deployment, check the Cloud Run logs for:

1. **Route Registration Logs** (on startup):
   ```
   📋 PolicyResearchController: Registering routes with path: /api/policy_research
     ✅ Registered PUT /api/policy_research/
     ✅ Registered GET /api/policy_research/conversations
     ✅ Registered GET /policy_research/conversations (backward compatibility)
     ✅ Registered POST /api/policy_research/conversations/:memoryId/metadata
     ✅ Registered GET /api/policy_research/test
     ✅ Registered GET /api/policy_research/:memoryId
   📋 PolicyResearchController: All routes registered
   ```

2. **Successful Request Logs** (when route matches):
   ```
   📞 getUserConversations called - Method: GET, Path: /api/policy_research/conversations, OriginalUrl: /api/policy_research/conversations?userId=xxx
   🔍 getUserConversations: Fetching conversations for userId: xxx
   ✅ getUserConversations: Found 5 conversations for userId: xxx
   ```

3. **404 Error Logs** (when route doesn't match):
   ```
   ❌ 404 - Route not found: GET /wrong/path (path: /wrong/path)
      Headers: { origin: 'https://frontend-app-xxx.run.app', 'user-agent': 'Mozilla/5.0...' }
   ```

---

### Common Path Matching Issues

#### Issue 1: Missing `/api` Prefix

**Symptom:** 404 errors for routes that should exist

**Cause:** Frontend calling `/policy_research/conversations` instead of `/api/policy_research/conversations`

**Solution:** Update frontend to use `/api/policy_research/` prefix. Backward compatibility route handles old paths.

#### Issue 2: Route Order Mismatch

**Symptom:** `/conversations` route returns chat log instead of conversation list

**Cause:** Parameterized route `/:memoryId` registered before specific route `/conversations`

**Solution:** Register specific routes before parameterized routes:

```typescript
// ✅ CORRECT ORDER
this.router.get(this.path + "/conversations", this.getUserConversations);  // Specific first
this.router.get(this.path + "/:memoryId", this.getChatLog);                 // Parameterized last
```

#### Issue 3: Trailing Slash Mismatch

**Symptom:** 404 for routes with/without trailing slash

**Cause:** Express treats `/api/policy_research/` and `/api/policy_research` as different routes

**Solution:** Be consistent. Our routes use trailing slash for PUT endpoint (`/api/policy_research/`) and no trailing slash for GET endpoints.

---

## Troubleshooting

### Problem: Still seeing CORS errors

**Check:**

1. **Backend logs** - Look for `🚀🚀🚀 INTERCEPTING OPTIONS` log messages
   - If you see it: Middleware is working, check header values
   - If you don't: Middleware isn't running (old image deployed?)

2. **Browser Network Tab**:
   - Check the OPTIONS request response headers
   - Look for `Access-Control-Allow-Origin` header
   - Verify the origin in the header matches your frontend URL

3. **Docker image**: Ensure you rebuilt and redeployed after code changes

### Problem: Frontend using localhost URLs

**Cause:** `NEXT_PUBLIC_*` variables not set at build time

**Solution:** 
- Pass them as Docker build arguments (see Frontend Dockerfile section)
- Rebuild the frontend image with the correct URLs

### Problem: OPTIONS request returns 404

**Cause:** Route handler doesn't exist or path mismatch

**Solution:**
- Ensure backend routes are correctly registered
- Verify frontend API paths match backend routes
- Check that the OPTIONS handler middleware runs before routes

### Problem: 404 errors for API routes (e.g., `/policy_research/conversations`)

**Cause:** Path mismatch between frontend and backend

**Symptoms:**
- Cloud Run logs show: `GET 404 /policy_research/conversations`
- Frontend console shows: `404 Not Found` error
- Backend logs show: `❌ 404 - Route not found`

**Solution:**
1. **Check backend route registration logs** - Verify routes are registered:
   ```
   📋 PolicyResearchController: Registering routes with path: /api/policy_research
     ✅ Registered GET /api/policy_research/conversations
   ```

2. **Verify frontend API paths** - Ensure frontend uses `/api/policy_research/` prefix:
   ```javascript
   // ✅ CORRECT
   researchAPI.get(`/api/policy_research/conversations?userId=${userId}`)
   
   // ❌ WRONG (missing /api prefix)
   researchAPI.get(`/policy_research/conversations?userId=${userId}`)
   ```

3. **Check route order** - Ensure specific routes come before parameterized routes:
   ```typescript
   // ✅ CORRECT ORDER
   this.router.get(this.path + "/conversations", this.getUserConversations);
   this.router.get(this.path + "/:memoryId", this.getChatLog);
   ```

4. **Rebuild and redeploy** - After fixing paths, rebuild and redeploy both frontend and backend

### Problem: CORS works locally but not in Cloud Run

**Common causes:**

1. **Different origins**: Local development uses same origin (no CORS), Cloud Run uses different origins
2. **HTTPS requirement**: Cloud Run requires HTTPS, ensure WebSocket URLs use `wss://`
3. **Build-time vs runtime**: `NEXT_PUBLIC_*` vars must be set at build time, not runtime

### Debugging Checklist

**CORS Issues:**
- [ ] Backend logs show `🚀🚀🚀 INTERCEPTING OPTIONS` for preflight requests
- [ ] OPTIONS response includes `Access-Control-Allow-Origin` header
- [ ] The origin in the header matches the frontend URL exactly
- [ ] Browser Network tab shows OPTIONS request returning 200 OK

**API Route Issues:**
- [ ] Backend logs show route registration: `✅ Registered GET /api/policy_research/conversations`
- [ ] Frontend uses correct paths with `/api/policy_research/` prefix
- [ ] Backend logs show handler execution: `📞 getUserConversations called`
- [ ] No 404 errors in Cloud Run logs for expected routes
- [ ] Route order is correct (specific routes before parameterized routes)

**Deployment:**
- [ ] Frontend was rebuilt with correct `NEXT_PUBLIC_*` build arguments
- [ ] WebSocket URLs use `wss://` (not `ws://`) in production
- [ ] Both services are deployed and accessible
- [ ] Docker images were rebuilt after code changes

---

## Key Takeaways

1. **Middleware order matters** - CORS middleware must run before routes
2. **Override parent methods** - When extending classes, override initialization methods to control middleware order
3. **Explicit OPTIONS handling** - Don't rely solely on the `cors` package; handle OPTIONS explicitly
4. **Next.js build-time variables** - `NEXT_PUBLIC_*` variables must be available at build time, not runtime
5. **Use WSS in production** - WebSocket connections must use `wss://` (secure) in Cloud Run
6. **Test with different origins** - Local development may not catch CORS issues; test with different origins
7. **API path consistency** - Frontend and backend must use matching API paths (with `/api` prefix)
8. **Route order matters** - Specific routes must be registered before parameterized routes
9. **Add logging** - Detailed logging helps debug routing and CORS issues in production
10. **Backward compatibility** - Consider adding backward compatibility routes during migrations

---

## References

- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Express.js CORS Middleware](https://expressjs.com/en/resources/middleware/cors.html)
- [Next.js Environment Variables](https://nextjs.org/docs/basic-features/environment-variables)
- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)

---

## Summary

The solution involved:

1. **Understanding Express middleware order** - Middleware must run before routes
2. **Overriding `initializeMiddlewares()`** - To control when CORS middleware is registered
3. **Explicit OPTIONS handling** - Intercepting OPTIONS requests and setting headers
4. **Using the `cors` package** - As a backup for non-OPTIONS requests
5. **Frontend build configuration** - Passing backend URLs as Docker build arguments
6. **API path matching** - Ensuring frontend and backend use consistent API paths
7. **Route registration order** - Registering specific routes before parameterized routes
8. **Comprehensive logging** - Adding detailed logs for debugging routing and CORS issues
9. **404 handler** - Catching unmatched requests to help identify path mismatches
10. **Backward compatibility** - Supporting old API paths during migration

This ensures that:
- Preflight OPTIONS requests are properly handled with correct CORS headers
- API routes match between frontend and backend
- Detailed logs help debug issues in production
- Cross-origin requests from the frontend to the backend work correctly on Google Cloud Run

---

## Related Files

### Backend Files

- **`backend/src/customApp.ts`** - CORS middleware configuration and 404 handler
- **`backend/src/controllers/policyResearchController.ts`** - API route definitions and handlers
- **`backend/src/server.ts`** - Server initialization and controller registration
- **`backend/node_modules/@policysynth/api/app.js`** - Parent class that registers controllers

### Frontend Files

- **`frontend/services/research-api.js`** - API client configuration and endpoint calls
- **`frontend/Dockerfile`** - Frontend Docker configuration with build arguments

### Configuration Files

- **`backend/Dockerfile`** - Backend Docker configuration
- **`frontend/.env.production`** - Frontend environment variables (generated during build)

---

## References

- [Express.js Routing](https://expressjs.com/en/guide/routing.html)
- [Express.js Middleware Order](https://expressjs.com/en/guide/using-middleware.html#middleware.application)
- [Express Router](https://expressjs.com/en/4x/api.html#router)


