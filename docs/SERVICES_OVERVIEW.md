# Frontend Services Overview

This document provides a visual overview of all services in the `frontend/services/` directory, explaining what each service does, its main functions, and how they're used.

## Services Directory Structure

```
frontend/services/
├── areas.js          - User-defined geographic areas management
├── collections.js    - Dataset collections (user-created groups)
├── config.js        - Configuration files from GitHub
├── dashboard.js      - Dashboard management
├── dataset.ts       - Dataset CRUD operations
├── favourites.js    - User favorites/bookmarks
├── fields.js        - Dataset field metadata
├── geminiService.js - AI report generation (Gemini API)
├── geocatmin.js     - Mining cadastre data (Peru)
├── geostore.js      - Geographic data storage
├── graph.js         - Graph/tag queries and analytics
├── layer.js         - Map layer management
├── pages.js         - Static page management
├── query.js         - SQL query execution
├── raster.js        - Raster data operations
├── research-api.js  - Policy research AI service (WebSocket + HTTP)
├── subscriptions.js - Email subscriptions for areas
├── tools.js         - Tool management
├── user.ts          - User authentication (Firebase - deprecated)
├── webshot.ts       - Widget screenshot generation
└── widget.ts        - Widget CRUD operations
```

---

## Service Details

### 1. **areas.js** - Geographic Areas Management
**Purpose**: Manages user-defined geographic areas (polygons, regions)

**Main Functions**:
- `fetchArea(id)` - Get a specific area by ID
- `fetchUserAreas(token)` - Get all areas for a user
- `createArea(name, geostore, token)` - Create a new area
- `updateArea(id, params, token)` - Update an area
- `deleteArea(areaId, token)` - Delete an area

**API Endpoints**:
- `GET /v2/area/:id` - Fetch area
- `GET /v2/area` - Fetch user areas
- `POST /v2/area` - Create area
- `PATCH /v2/area/:id` - Update area
- `DELETE /v2/area/:id` - Delete area

**Use Case**: Users can draw polygons on the map and save them as named areas for later use.

---

### 2. **collections.js** - Dataset Collections
**Purpose**: Manages user-created collections of datasets (like playlists)

**Main Functions**:
- `fetchAllCollections(token)` - Get all user collections
- `fetchCollection(token, collectionId)` - Get a specific collection
- `createCollection(token, data)` - Create new collection
- `updateCollection(token, collectionId, data)` - Update collection
- `deleteCollection(token, collectionId)` - Delete collection
- `addResourceToCollection(token, collectionId, resource)` - Add dataset/widget to collection
- `removeResourceFromCollection(token, collectionId, resource)` - Remove resource from collection

**API Endpoints**:
- `GET /v1/collection` - List collections
- `GET /v1/collection/:id` - Get collection
- `POST /v1/collection` - Create collection
- `PATCH /v1/collection/:id` - Update collection
- `DELETE /v1/collection/:id` - Delete collection
- `POST /v1/collection/:id/resource` - Add resource
- `DELETE /v1/collection/:id/resource/:type/:id` - Remove resource

**Use Case**: Users can organize datasets into custom collections for easy access.

---

### 3. **config.js** - Configuration Files
**Purpose**: Fetches configuration files from GitHub

**Main Functions**:
- `fetchExploreConfig()` - Fetches Explore page configuration
- `fetchCountryPowerExplorerConfig()` - Fetches Country Power Explorer config

**External URLs**:
- `https://raw.githubusercontent.com/resource-watch/resource-watch/develop/public/static/data/ExploreConfig.json`
- `https://raw.githubusercontent.com/resource-watch/resource-watch/develop/public/static/data/CountryEnergyExplorer.json`

**Use Case**: Loads dynamic configuration for explore page and country explorer features.

**⚠️ Legacy**: Points to Resource Watch GitHub - should be migrated to Polisense repository.

---

### 4. **dashboard.js** - Dashboard Management
**Purpose**: Manages dashboards (collections of widgets displayed together)

**Main Functions**:
- `fetchDashboards(params, headers)` - Get all dashboards
- `fetchDashboard(id)` - Get specific dashboard
- `createDashboard(body, token)` - Create new dashboard
- `updateDashboard(id, body, token)` - Update dashboard
- `deleteDashboard(id, token)` - Delete dashboard
- `cloneDashboard(dashboard, user)` - Clone existing dashboard

**API Endpoints**:
- `GET /v1/dashboard` - List dashboards
- `GET /v1/dashboard/:id` - Get dashboard
- `POST /v1/dashboard` - Create dashboard
- `PATCH /v1/dashboard/:id` - Update dashboard
- `DELETE /v1/dashboard/:id` - Delete dashboard
- `POST /v1/dashboard/:id/clone` - Clone dashboard

**Use Case**: Users can create custom dashboards with multiple widgets for data visualization.

---

### 5. **dataset.ts** - Dataset Operations
**Purpose**: Core dataset CRUD operations

**Main Functions**:
- `fetchDatasets(params, headers)` - Get all datasets (with filters)
- `fetchDataset(id, params)` - Get specific dataset
- `createDataset(dataset, token)` - Create new dataset
- `updateDataset(dataset, token)` - Update dataset
- `deleteDataset(datasetId, token)` - Delete dataset
- `fetchDatasetMetadata(datasetId, token)` - Get dataset metadata
- `updateDatasetMetadata(datasetId, metadata, token)` - Update metadata

**API Endpoints**:
- `GET /v1/dataset` - List datasets
- `GET /v1/dataset/:id` - Get dataset
- `POST /v1/dataset` - Create dataset
- `PATCH /v1/dataset/:id` - Update dataset
- `DELETE /v1/dataset/:id` - Delete dataset
- `GET /v1/dataset/:id/metadata` - Get metadata
- `PATCH /v1/dataset/:id/metadata` - Update metadata

**Use Case**: Primary service for managing datasets (the core data entities in the system).

---

### 6. **favourites.js** - User Favorites
**Purpose**: Manages user favorites/bookmarks for datasets, layers, or widgets

**Main Functions**:
- `fetchFavorites(token)` - Get all user favorites
- `createFavourite(token, {resourceId, resourceType})` - Add favorite
- `deleteFavourite(token, resourceId)` - Remove favorite

**API Endpoints**:
- `GET /v1/favourite` - List favorites
- `POST /v1/favourite` - Create favorite
- `DELETE /v1/favourite/:resourceId` - Delete favorite

**Use Case**: Users can bookmark datasets, layers, or widgets for quick access.

---

### 7. **fields.js** - Dataset Field Metadata
**Purpose**: Fetches field/column information from datasets

**Main Functions**:
- `fetchFields(url)` - Get fields from a dataset URL
- `fetchCartoFields(config)` - Get fields from CARTO datasets

**Use Case**: Used in widget editors to show available fields/columns for creating charts.

---

### 8. **geminiService.js** - AI Report Generation
**Purpose**: Generates polished reports from conversation data using Google Gemini API

**Main Functions**:
- `testGeminiAPI()` - Test Gemini API connection
- `generatePolishedReport(conversation)` - Generate report from conversation
- `generateFallbackReport(conversation)` - Fallback if Gemini fails

**API Endpoints**:
- `POST /api/gemini/generate-report` - Generate report (server-side route)

**Use Case**: Converts research conversation into a polished, formatted report.

**Note**: Uses server-side API route to keep API keys secure.

---

### 9. **geocatmin.js** - Mining Cadastre Data
**Purpose**: Loads Peruvian mining cadastre data from INGEMMET Geocatmin

**Main Functions**:
- `loadMiningCadastre()` - Load mining cadastre GeoJSON
- `getGeocatminLayerConfig(layerId)` - Get layer configuration
- `getAllGeocatminLayers()` - Get all available layers

**Data Source**: Pre-converted GeoJSON files in `/public/GEOCATMIN/`

**Use Case**: Displays mining cadastre information on maps (Peru-specific feature).

---

### 10. **geostore.js** - Geographic Data Storage
**Purpose**: Manages geostores (geographic data storage entities)

**Main Functions**:
- `fetchGeostore(id)` - Get geostore by ID
- `createGeostore(geojson)` - Create geostore from GeoJSON
- `fetchCountries()` - Get list of countries
- `fetchCountry(iso)` - Get country by ISO code
- `fetchCountryV2(iso)` - Get country (v2 API)

**API Endpoints**:
- `GET /v1/geostore/:id` - Get geostore
- `POST /v1/geostore` - Create geostore
- `GET /v1/geostore/admin/list` - List countries
- `GET /v1/query/:datasetId?sql=...` - Query country data
- `GET /v2/geostore/admin/:iso` - Get country (v2)

**Use Case**: Stores and retrieves geographic boundaries (countries, regions, custom areas).

---

### 11. **graph.js** - Graph Queries & Analytics
**Purpose**: Graph-based queries for tags, concepts, and dataset analytics

**Main Functions**:
- `fetchAllTags(params)` - Get all tags/concepts
- `fetchInferredTags(params)` - Get inferred tags
- `countDatasetView(datasetId, token)` - Track dataset view
- `fetchMostViewedDatasets(params)` - Get most viewed datasets
- `fetchMostFavoritedDatasets(params)` - Get most favorited datasets
- `fetchSimilarDatasets(params, withAncestors)` - Get similar datasets

**API Endpoints**:
- `GET /v1/graph/query/list-concepts` - List tags
- `GET /v1/graph/query/concepts-inferred` - Inferred tags
- `POST /v1/graph/dataset/:id/visited` - Track view
- `GET /v1/graph/query/most-viewed` - Most viewed
- `GET /v1/graph/query/most-liked-datasets` - Most favorited
- `GET /v1/graph/query/similar-dataset*` - Similar datasets

**Use Case**: Powers tag system, recommendations, and analytics features.

---

### 12. **layer.js** - Map Layer Management
**Purpose**: Manages map layers (visualizations of datasets on maps)

**Main Functions**:
- `fetchLayers(params, headers)` - Get all layers
- `fetchLayer(id, params)` - Get specific layer
- `createLayer(layer, datasetId, token)` - Create layer
- `updateLayer(layer, datasetId, token)` - Update layer
- `deleteLayer(layerId, datasetId, token)` - Delete layer

**API Endpoints**:
- `GET /v1/layer` - List layers
- `GET /v1/layer/:id` - Get layer
- `POST /v1/dataset/:datasetId/layer` - Create layer
- `PATCH /v1/dataset/:datasetId/layer/:id` - Update layer
- `DELETE /v1/dataset/:datasetId/layer/:id` - Delete layer

**Use Case**: Manages how datasets are visualized on maps (colors, styles, filters).

---

### 13. **pages.js** - Static Page Management
**Purpose**: Manages static content pages

**Main Functions**:
- `fetchPages(params, headers)` - Get all pages
- `fetchPage(id, token, params)` - Get specific page
- `createPage(page, token)` - Create page
- `updatePage(page, token)` - Update page
- `deletePage(id, token)` - Delete page

**API Endpoints**:
- `GET /v1/static_page` - List pages
- `GET /v1/static_page/:id` - Get page
- `POST /v1/static_page` - Create page
- `PATCH /v1/static_page/:id` - Update page
- `DELETE /v1/static_page/:id` - Delete page

**Use Case**: CMS-like functionality for managing static content pages.

---

### 14. **query.js** - SQL Query Execution
**Purpose**: Executes SQL queries against datasets

**Main Functions**:
- `fetchQuery(token, sql, params)` - Execute SQL query

**API Endpoints**:
- `GET /v1/query?sql=...` - Execute query

**Use Case**: Allows custom SQL queries against dataset tables (requires authentication).

---

### 15. **raster.js** - Raster Data Operations
**Purpose**: Handles raster (image) data operations

**Main Functions**:
- `getBandNames()` - Get raster band names
- `getBandStatsInfo(bandName)` - Get band statistics
- `getChartInfo(widgetEditor)` - Get chart configuration for raster

**Supported Providers**:
- Google Earth Engine (GEE)
- CARTO

**Use Case**: Used for raster datasets to get band information and statistics for visualization.

---

### 16. **research-api.js** - Policy Research AI Service ⭐
**Purpose**: Main service for AI-powered policy research functionality

**Main Functions**:

#### HTTP API Methods:
- `conversation(chatLog, options)` - Start research conversation
- `getChatLog(memoryId)` - Get conversation history
- `getUserConversations(userId)` - Get all user conversations
- `deleteConversation(memoryId, userId)` - Delete conversation
- `extractFile(file, onProgress, memoryId, userId)` - Upload and extract document
- `getExtractionResult(fileIdOrFileName, options)` - Get extraction result
- `addDocumentToConversation(memoryId, document, userId)` - Add document
- `updateDocumentStatus(memoryId, documentId, status, additionalData, userId)` - Update document status
- `removeDocumentFromConversation(memoryId, documentId, userId)` - Remove document
- `getConversationDocuments(memoryId)` - Get all documents for conversation

#### WebSocket Methods:
- `establishWebSocket()` - Connect to WebSocket
- `onMessage(messageType, handler)` - Listen for messages
- `offMessage(messageType, handler)` - Remove listener
- `onConnection(handler)` - Connection status handler
- `onError(handler)` - Error handler
- `onSpinnerChange(handler)` - Spinner state handler
- `sendMessage(message)` - Send WebSocket message
- `closeConnection()` - Close WebSocket
- `getConnectionStatus()` - Get connection status

**API Endpoints**:
- `PUT /api/policy_research/` - Start conversation
- `GET /api/policy_research/:memoryId` - Get chat log
- `GET /api/policy_research/conversations?userId=...` - List conversations
- `DELETE /api/policy_research/conversations/:memoryId?userId=...` - Delete conversation
- `POST /api/policy_research/extract` - Upload file
- `GET /api/policy_research/extract/result/:fileId` - Get extraction result
- `POST /api/policy_research/conversations/:memoryId/documents` - Add document
- `PUT /api/policy_research/conversations/:memoryId/documents/:documentId` - Update document
- `DELETE /api/policy_research/conversations/:memoryId/documents/:documentId` - Remove document
- `GET /api/policy_research/conversations/:memoryId/documents` - List documents

**WebSocket URL**: `ws://localhost:5029/ws` (configurable via `NEXT_PUBLIC_RESEARCH_WS_URL`)

**Use Case**: Core service for the AI research chatbot - handles conversations, document uploads, and real-time updates via WebSocket.

---

### 17. **subscriptions.js** - Email Subscriptions
**Purpose**: Manages email subscriptions for area-based alerts

**Main Functions**:
- `fetchSubscriptions(token, params)` - Get user subscriptions
- `createSubscriptionToArea({areaId, datasets, datasetsQuery, user, language, name})` - Create subscription
- `updateSubscriptionToArea(subscriptionId, datasets, datasetsQuery, user, language, areaId)` - Update subscription
- `fetchSubscription(subscriptionId, token)` - Get specific subscription
- `deleteSubscription(subscriptionId, token)` - Delete subscription

**API Endpoints**:
- `GET /v1/subscriptions` - List subscriptions
- `POST /v1/subscriptions` - Create subscription
- `PATCH /v1/subscriptions/:id` - Update subscription
- `GET /v1/subscriptions/:id` - Get subscription
- `DELETE /v1/subscriptions/:id` - Delete subscription

**Use Case**: Users can subscribe to email alerts when data changes in specific geographic areas.

---

### 18. **tools.js** - Tool Management
**Purpose**: Manages tools (applications/features)

**Main Functions**:
- `fetchTools(params, headers)` - Get all tools
- `fetchTool(id, token, params)` - Get specific tool
- `createTool(tool, token)` - Create tool
- `updateTool(tool, token)` - Update tool
- `deleteTool(id, token)` - Delete tool

**API Endpoints**:
- `GET /v1/tool` - List tools
- `GET /v1/tool/:id` - Get tool
- `POST /v1/tool` - Create tool
- `PATCH /v1/tool/:id` - Update tool
- `DELETE /v1/tool/:id` - Delete tool

**Use Case**: Manages tools/features available in the platform.

---

### 19. **user.ts** - User Authentication (Deprecated)
**Purpose**: User authentication and profile management

**Status**: ⚠️ **DEPRECATED** - Most functions throw errors directing to use `AuthContext` instead

**Main Functions**:
- `loginUser({email, password})` - ❌ Deprecated (use AuthContext.login)
- `forgotPassword({email})` - ✅ Active (Firebase password reset)
- `registerUser({email})` - ❌ Deprecated (use AuthContext.signup)
- `uploadPhoto(file, user)` - ❌ Deprecated (use AuthContext.updateUserProfile)
- `fetchUser(userToken)` - ❌ Deprecated (use AuthContext.userProfile)
- `fetchUserData(userToken)` - ❌ Deprecated (use AuthContext.userProfile)
- `updateUserData(user, userData)` - ❌ Deprecated (use AuthContext.updateUserProfile)
- `createUserData(userToken, user)` - ❌ Deprecated (auto-created on signup)

**Use Case**: Legacy user service - should be migrated to Firebase AuthContext.

---

### 20. **webshot.ts** - Widget Screenshot Generation
**Purpose**: Generates screenshots/thumbnails of widgets

**Main Functions**:
- `takeWidgetWebshot(widgetId, params)` - Generate widget screenshot

**API Endpoints**:
- `POST /webshot/widget/:widgetId/thumbnail` - Generate screenshot

**Use Case**: Creates thumbnails for widgets (used in dashboards, previews, sharing).

---

### 21. **widget.ts** - Widget Management
**Purpose**: Manages widgets (charts, maps, tables - visualizations of data)

**Main Functions**:
- `fetchWidgets(params, headers)` - Get all widgets
- `fetchWidget(id, params)` - Get specific widget
- `createWidget(widget, datasetId, token)` - Create widget
- `updateWidget(widget, token)` - Update widget
- `deleteWidget(widgetId, datasetId, token)` - Delete widget
- `fetchWidgetMetadata(widgetId, datasetId, token, params)` - Get widget metadata
- `updateWidgetMetadata(widgetId, datasetId, metadata, token)` - Update metadata
- `createWidgetMetadata(widgetId, datasetId, metadata, token)` - Create metadata

**API Endpoints**:
- `GET /v1/widget` - List widgets
- `GET /v1/widget/:id` - Get widget
- `POST /v1/dataset/:datasetId/widget` - Create widget
- `PATCH /v1/widget/:id` - Update widget
- `DELETE /v1/dataset/:datasetId/widget/:widgetId` - Delete widget
- `GET /v1/dataset/:datasetId/widget/:widgetId/metadata` - Get metadata
- `PATCH /v1/dataset/:datasetId/widget/:widgetId/metadata` - Update metadata
- `POST /v1/dataset/:datasetId/widget/:widgetId/metadata` - Create metadata

**Use Case**: Core service for creating and managing data visualizations (charts, maps, tables).

---

## Service Dependencies

### Common Dependencies:
- `WRIAPI` (from `utils/axios`) - Main API client for Resource Watch API
- `WRISerializer` (from `wri-json-api-serializer`) - Serializes API responses
- `logger` (from `utils/logs`) - Logging utility
- `axios` - HTTP client

### Special Dependencies:
- **research-api.js**: WebSocket API, axios
- **geminiService.js**: Server-side API route (`/api/gemini/generate-report`)
- **geocatmin.js**: Local GeoJSON files in `/public/GEOCATMIN/`
- **user.ts**: Firebase Auth (`firebase/auth`)

---

## Service Categories

### Core Data Services:
- `dataset.ts` - Datasets
- `layer.js` - Layers
- `widget.ts` - Widgets
- `dashboard.js` - Dashboards

### User Services:
- `user.ts` - Authentication (deprecated)
- `favourites.js` - Favorites
- `collections.js` - Collections
- `areas.js` - User areas
- `subscriptions.js` - Email subscriptions

### Geographic Services:
- `geostore.js` - Geostores
- `geocatmin.js` - Mining cadastre
- `areas.js` - User areas

### AI/Research Services:
- `research-api.js` - Policy research AI ⭐
- `geminiService.js` - Report generation

### Utility Services:
- `config.js` - Configuration
- `query.js` - SQL queries
- `fields.js` - Field metadata
- `raster.js` - Raster operations
- `webshot.ts` - Screenshots
- `graph.js` - Tags/analytics
- `tools.js` - Tools
- `pages.js` - Static pages

---

## Most Important Services

### ⭐ Critical for Core Functionality:
1. **dataset.ts** - Core data entity
2. **widget.ts** - Data visualizations
3. **layer.js** - Map visualizations
4. **research-api.js** - AI research feature

### 🔧 Important for User Experience:
1. **dashboard.js** - User dashboards
2. **collections.js** - User organization
3. **favourites.js** - User bookmarks
4. **areas.js** - User-defined regions

### 🆕 New/Active Features:
1. **research-api.js** - Active AI research
2. **geminiService.js** - Report generation
3. **geocatmin.js** - Mining cadastre (Peru-specific)

### ⚠️ Deprecated/Legacy:
1. **user.ts** - Use Firebase AuthContext instead
2. **config.js** - Points to Resource Watch GitHub (should migrate)

---

## Visual Service Flow

```
User Action
    │
    ├─→ Authentication (Firebase AuthContext - not user.ts)
    │
    ├─→ Browse Data
    │   ├─→ dataset.ts (fetch datasets)
    │   ├─→ widget.ts (view widgets)
    │   └─→ layer.js (view map layers)
    │
    ├─→ Create Content
    │   ├─→ dataset.ts (create dataset)
    │   ├─→ widget.ts (create widget)
    │   ├─→ layer.js (create layer)
    │   └─→ dashboard.js (create dashboard)
    │
    ├─→ Organize
    │   ├─→ collections.js (create collections)
    │   ├─→ favourites.js (add favorites)
    │   └─→ areas.js (save areas)
    │
    ├─→ AI Research
    │   ├─→ research-api.js (conversation)
    │   │   ├─→ extractFile() (upload document)
    │   │   ├─→ conversation() (start research)
    │   │   └─→ WebSocket (real-time updates)
    │   └─→ geminiService.js (generate report)
    │
    └─→ Geographic Operations
        ├─→ geostore.js (get boundaries)
        ├─→ geocatmin.js (mining data)
        └─→ areas.js (user areas)
```

---

## Notes

- Most services use the Resource Watch API (`WRIAPI`) - may need updating for Polisense
- `user.ts` is deprecated - use Firebase AuthContext instead
- `config.js` fetches from Resource Watch GitHub - should be migrated
- `research-api.js` is the most complex service with WebSocket support
- All services use `WRISerializer` to normalize API responses
- Services follow consistent error handling patterns
