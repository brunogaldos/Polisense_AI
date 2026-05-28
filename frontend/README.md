# Polisense Frontend

A geospatial data exploration platform built with Next.js, featuring interactive mapping, AI-powered research, and dynamic report generation.

The application serves a single primary interface at `/data/explore` where users can browse datasets, visualize geospatial layers on an interactive map, and interact with an AI research assistant.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 12 + React 17 |
| Server | Express.js (hybrid with Next.js) |
| State | Redux + Redux Thunk + React Query |
| Auth | Firebase Authentication + Firestore |
| Styling | Tailwind CSS + SCSS + Foundation |
| Mapping | Deck.gl + Mapbox GL + Layer Manager |
| Data Source | WRI API (`api.resourcewatch.org`) |
| AI | Gemini API (report generation), Research WebSocket API |
| Deployment | Docker |

## Directory Structure

```
frontend/
├── components/           # Reusable UI components
│   ├── app/              # App-level components (page wrappers)
│   ├── dashboards/       # Dashboard components (tabbed, dynamic)
│   ├── datasets/         # Dataset list, search, similar-datasets
│   ├── form/             # Form elements (Input, Checkbox, RadioGroup, etc.)
│   ├── icons/            # SVG sprite sheet (symbol defs for icon system)
│   ├── map/              # Map components, controls, layer-manager, plugins
│   ├── modal/            # Modal dialogs (share, login, layer-info)
│   ├── progress-bar/     # Progress indicators
│   ├── prominent-button/ # Styled button component
│   ├── research/         # AI research chatbot
│   ├── search-bar/       # Global search bar
│   ├── search-results/   # Search result display + reducers
│   └── ui/               # Generic UI primitives (Spinner, Icon, etc.)
│
├── constants/            # App-wide constants
├── contexts/             # React context providers
│   ├── AuthContext.jsx   # Firebase auth (login, signup, logout, profile)
│   └── DashboardContext.js  # Dashboard state + localStorage persistence
│
├── css/                  # SCSS stylesheets
│   ├── components/       # Component-specific styles
│   ├── layouts/          # Layout styles
│   └── index.scss        # Main stylesheet entry point
│
├── firebase/             # Firebase configuration
│   └── config.js         # Firebase app, auth, and Firestore init
│
├── hoc/                  # Higher-order components
│   └── auth.js           # withAuthentication, withRedux, withUserServerSide, withUser
│
├── hooks/                # Custom React hooks
│   ├── dataset/          # Dataset fetching hooks
│   └── user/             # User data hooks (useMe)
│
├── layout/               # Page layout components
│   ├── explore/          # Explore page layout (sidebar, map, datasets, detail)
│   ├── header/           # Header (menu, user dropdown, search, dashboards)
│   ├── footer/           # Footer
│   ├── head/             # HTML <head> meta tags
│   ├── layout/           # App shell (layout-app)
│   ├── sign-in/          # Sign-in page layout
│   └── forgot-password/  # Password recovery layout
│
├── lib/                  # Core libraries
│   ├── store.js          # Redux store configuration
│   └── media.js          # Responsive breakpoints (sm/md/lg/xl)
│
├── modules/              # Redux feature modules
│   ├── explore/          # Explore page state management
│   ├── static-pages/     # Static pages (privacy, terms, attribution)
│   └── index.js          # Module registry
│
├── pages/                # Next.js routes (file-based routing)
│   ├── api/              # API routes (see API Routes below)
│   ├── data/explore/     # Main explore page ([[...dataset]].jsx)
│   ├── dashboard/        # Dashboard page
│   ├── sign-in/          # Login page
│   ├── forgot-password/  # Password recovery
│   ├── privacy-policy/   # Privacy policy (static)
│   ├── terms-of-service/ # Terms of service (static)
│   ├── api-attribution-requirements/  # API attribution
│   ├── _app.tsx          # App wrapper (providers, GTM)
│   ├── _document.tsx     # HTML document shell
│   ├── index.tsx         # Root redirect to /data/explore
│   ├── 404.jsx           # Not found page
│   └── 500.jsx           # Server error page
│
├── public/               # Static assets served at /
│   └── static/           # Images, data JSON files
│
├── redactions/           # Redux reducers (legacy naming)
│   ├── common.js         # App locale
│   ├── modal.js          # Modal state
│   ├── tooltip.js        # Tooltip state
│   ├── user.js           # User state
│   └── page.js           # Page loading state
│
├── selectors/            # Redux selectors
│   └── explore/          # Explore state selectors
│
├── server/               # Express server
│   └── app.js            # Server init (Express + Next.js hybrid)
│
├── services/             # API service modules
│   ├── dataset.ts        # Dataset CRUD (WRI API)
│   ├── user.ts           # User ops (Firebase-backed)
│   ├── pages.js          # Static page fetching
│   ├── graph.js          # Graph/knowledge API
│   ├── geminiService.js  # Gemini AI report generation
│   └── research-api.js   # Research chatbot (REST + WebSocket)
│
├── types/                # TypeScript type definitions
├── utils/                # Utility functions
│   ├── axios.js          # Pre-configured axios instance
│   ├── logs.js           # Pino logger
│   ├── conversationStorage.js  # Chat persistence
│   ├── dashboardGenerator.js   # Dashboard creation
│   ├── datasets/         # Dataset helpers
│   ├── layers/           # Layer utilities
│   └── ...               # Dates, tags, tooltips, etc.
│
├── Dockerfile            # Docker build (Node 16-alpine)
├── index.js              # Server entry point
├── next.config.js        # Next.js configuration
├── tailwind.config.js    # Tailwind CSS config
├── tsconfig.json         # TypeScript config
├── package.json          # Dependencies and scripts
└── .env.development      # Development environment variables
```

## API Routes

| Route | Purpose |
|-------|---------|
| `/api/auth/[...path]` | Authentication passthrough |
| `/api/proxy/[...path]` | Generic API proxy |
| `/api/gemini/generate-report` | AI report generation via Gemini |
| `/api/policy_research/[...path]` | Policy research API (conversations, documents) |

## Prerequisites

- **Node.js** >= 14.17 (Docker uses 16.17)
- **Yarn** 3.1.1 (bundled in `.yarn/releases/`)
- **Firebase project** with Authentication and Firestore enabled
- **Mapbox** account for map tiles

## Environment Variables

Copy `.env.development` and adjust values for your environment:

```bash
cp .env.development .env.local
```

### Required Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase project API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_RW_MAPBOX_API_TOKEN` | Mapbox GL access token |
| `NEXT_PUBLIC_WRI_API_URL` | WRI API base URL |
| `NEXT_PUBLIC_API_ENV` | API environment (`production`, `preproduction`) |

### Optional Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_RESEARCH_API_URL` | Research API base URL |
| `NEXT_PUBLIC_RESEARCH_WS_URL` | Research WebSocket URL |
| `NEXT_PUBLIC_GOOGLE_TAG_MANAGER_CONTAINER_ID` | GTM container ID |
| `NEXT_PUBLIC_RW_GOGGLE_API_TOKEN_SHORTENER` | Google URL shortener token |
| `SECRET` | Express session secret |

## Local Development

```bash
# Install dependencies
yarn install

# Start development server (port 3000)
yarn dev
```

The app will be available at `http://localhost:3000/data/explore`.

### Available Scripts

| Command | Description |
|---------|-------------|
| `yarn dev` | Start development server with hot reload |
| `yarn build` | Production build |
| `yarn start` | Start production server |
| `yarn lint` | Run ESLint + TypeScript type checking |
| `yarn prettier` | Format all source files |
| `yarn analyze` | Bundle size analysis |
| `yarn check-types` | TypeScript type checking only |

## Docker

### Build

```bash
docker build -t polisense-frontend \
  --build-arg NEXT_PUBLIC_RW_MAPBOX_API_TOKEN=your_mapbox_token \
  --build-arg NEXT_PUBLIC_WRI_API_URL=https://api.resourcewatch.org \
  --build-arg NEXT_PUBLIC_API_ENV=production \
  --build-arg NEXT_PUBLIC_RESEARCH_WS_URL=ws://your-research-api/ws \
  --build-arg NEXT_PUBLIC_RESEARCH_API_URL=https://your-research-api \
  .
```

> **Note:** `NEXT_PUBLIC_*` variables must be provided at **build time** because Next.js inlines them during compilation.

### Run

```bash
docker run -p 3000:3000 \
  -e SECRET=your_session_secret \
  polisense-frontend
```

### Build Args Reference

| Arg | Default | Required |
|-----|---------|----------|
| `NEXT_PUBLIC_RW_MAPBOX_API_TOKEN` | (bundled default) | Yes for maps |
| `NEXT_PUBLIC_WRI_API_URL` | `https://api.resourcewatch.org` | No |
| `NEXT_PUBLIC_API_ENV` | `production` | No |
| `NEXT_PUBLIC_AUTH_CALLBACK` | `https://resourcewatch.org/auth-callback` | No |
| `NEXT_PUBLIC_RESEARCH_WS_URL` | (none) | For AI research |
| `NEXT_PUBLIC_RESEARCH_API_URL` | (none) | For AI research |


## Architecture Overview

### Request Flow

```
Browser -> Express (server/app.js) -> Next.js SSR -> React SPA
                                   -> API Routes (/api/*)
```

### State Management

- **Redux** (`lib/store.js`): Global app state — explore filters, map viewport, UI state, user data
- **React Query**: Server state — user profile, dataset fetching with caching
- **React Context**: Auth state (`AuthContext`), Dashboard state (`DashboardContext`)
- **localStorage**: Chat conversation persistence, dashboard data

### Authentication

Firebase Authentication handles all auth flows client-side through `AuthContext`:
- Email/password sign-in and sign-up
- Password reset via Firebase
- User profiles stored in Firestore
- Session token passed as Bearer token for API calls

### Map System

The map uses a layered provider architecture:

```
ExploreMap -> LayerManager -> Providers (Carto, GEE, WMS, FeatureService)
                           -> Deck.gl overlays
                           -> Mapbox GL base map
```

Datasets from the WRI API include layer configurations that specify which provider renders them.
