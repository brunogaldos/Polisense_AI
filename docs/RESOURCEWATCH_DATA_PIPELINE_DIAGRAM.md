# Resource Watch Data Pipeline - Visual Flow

## Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    RESOURCE WATCH DATA PIPELINE                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DATA SOURCE   │    │   API LAYER     │    │  FRONTEND APP   │    │   MAP RENDER    │
│                 │    │                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │Google Earth │ │    │ │ResourceWatch│ │    │ │Next.js React│ │    │ │Mapbox GL +  │ │
│ │Engine (GEE) │ │    │ │API          │ │    │ │App          │ │    │ │Deck.gl      │ │
│ │             │ │    │ │             │ │    │ │             │ │    │ │             │ │
│ │TROPOMI NO₂  │ │    │ │api.resource │ │    │ │Redux State  │ │    │ │Tile Layers  │ │
│ │Satellite    │ │    │ │watch.org    │ │    │ │Management   │ │    │ │Color Mapping│ │
│ │Data         │ │    │ │             │ │    │ │             │ │    │ │             │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │                       │
         │                       │                       │                       │
         ▼                       ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DATA STORAGE  │    │   API ENDPOINTS │    │   SERVICE LAYER │    │   VISUALIZATION │
│                 │    │                 │    │                 │    │                 │
│ • Raster Tiles  │    │ • /v1/dataset   │    │ • dataset.ts    │    │ • Map Component │
│ • Time Series   │    │ • /v1/layer     │    │ • layer.js      │    │ • Layer Manager │
│ • Metadata      │    │ • /v1/widget    │    │ • query.js      │    │ • GEE Provider  │
│ • SQL Queries   │    │ • /v1/query     │    │ • widget.ts     │    │ • Tile Renderer │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Detailed API Call Sequence

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              API CALL SEQUENCE FOR NO₂ DATASET                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

1. DATASET METADATA REQUEST
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ GET https://api.resourcewatch.org/v1/dataset/b75d8398-34f2-447d-832d-ea570451995a              │
│ Query: {application: 'rw', env: 'production', language: 'en', includes: 'metadata,vocabulary,layer'} │
│ Response: Dataset metadata, layer configs, widget info                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

2. WIDGET DATA REQUEST
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ GET https://api.resourcewatch.org/v1/widget/1ae4b9db-93b9-4b2f-8bdb-b9341627703d               │
│ Query: {rw: '', env: 'production', language: 'en', includes: 'metadata'}                       │
│ Response: Widget configuration and display settings                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

3. LAYER CONFIGURATION REQUEST
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ GET https://api.resourcewatch.org/v1/dataset/b75d8398-34f2-447d-832d-ea570451995a/layer         │
│ Query: {app: 'rw', env: 'production', 'page[size]': '9999'}                                    │
│ Response: Layer specifications for map rendering                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

4. DATA QUERY REQUEST
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ GET https://api.resourcewatch.org/v1/query/b75d8398-34f2-447d-832d-ea570451995a                 │
│ Query: {sql: 'SELECT * FROM projects/resource-watch-gee/cit_035_tropomi_atmospheric_chemistry_model_30day_avg/NO2 LIMIT 50'} │
│ Response: Actual NO₂ concentration data                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Frontend Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND DATA PROCESSING FLOW                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   USER ACTION   │    │   REDUX ACTIONS │    │   SERVICE CALLS │    │   STATE UPDATE  │
│                 │    │                 │    │                 │    │                 │
│ • Select Dataset│    │ • fetchDatasets │    │ • fetchDataset  │    │ • setDatasets   │
│ • Click Map     │    │ • setViewport   │    │ • fetchLayer    │    │ • setViewport   │
│ • Zoom/Pan      │    │ • setMapLayers  │    │ • fetchQuery    │    │ • setMapLayers  │
│ • Interact      │    │ • setInteraction│    │ • fetchWidget   │    │ • setInteraction│
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │                       │
         ▼                       ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   COMPONENT     │    │   THUNK ACTIONS │    │   API RESPONSE  │    │   MAP RENDER    │
│   TRIGGERS      │    │                 │    │                 │    │                 │
│                 │    │ • createThunk   │    │ • JSON Data     │    │ • Tile Loading  │
│ • ExplorePage   │    │ • Async/Await   │    │ • Layer Config  │    │ • Color Mapping │
│ • Map Component │    │ • Error Handling│    │ • Widget Data   │    │ • Interaction   │
│ • Layer Manager │    │ • Loading States│    │ • Metadata      │    │ • Popups        │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Map Rendering Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              MAP RENDERING PIPELINE                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   LAYER CONFIG  │    │   TILE REQUEST  │    │   DATA PROCESS  │    │   VISUAL OUTPUT │
│                 │    │                 │    │                 │    │                 │
│ • Provider: GEE │    │ • Map Viewport  │    │ • Raster Data   │    │ • Colored Tiles │
│ • Type: Deck    │    │ • Zoom Level    │    │ • NO₂ Values    │    │ • Interactive   │
│ • Source: Tiles │    │ • Tile Coords   │    │ • Color Scale   │    │ • Legend        │
│ • Decode Func   │    │ • GEE Endpoint  │    │ • Value Mapping │    │ • Popups        │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │                       │
         ▼                       ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   LAYER MANAGER │    │   GEE TILER     │    │   DECK.GL       │    │   USER INTERFACE│
│                 │    │                 │    │                 │    │                 │
│ • Parse Config  │    │ • Generate Tiles│    │ • TileLayer     │    │ • Map Display   │
│ • Create Source │    │ • Raster Data   │    │ • Decode Func   │    │ • Click Events  │
│ • Setup Render  │    │ • NO₂ Values    │    │ • Color Mapping │    │ • Data Popups   │
│ • Handle Events │    │ • Tile URLs     │    │ • Compositing   │    │ • Legend Info   │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Data Transformation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA TRANSFORMATION STAGES                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

RAW DATA (GEE)           API RESPONSE           FRONTEND STATE           MAP VISUALIZATION
┌─────────────┐         ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│             │         │             │         │             │         │             │
│ TROPOMI     │────────▶│ JSON        │────────▶│ Redux       │────────▶│ Colored     │
│ Satellite   │         │ Metadata    │         │ Store       │         │ Map Tiles   │
│ NO₂ Values  │         │ Layer Config│         │ Layer State │         │ Interactive │
│ Raster Data │         │ Widget Data │         │ Viewport    │         │ Legend      │
│             │         │ SQL Results │         │ Interaction │         │ Popups      │
└─────────────┘         └─────────────┘         └─────────────┘         └─────────────┘
         │                       │                       │                       │
         ▼                       ▼                       ▼                       ▼
┌─────────────┐         ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│ Numerical   │         │ Structured  │         │ Application │         │ User        │
│ Values      │         │ API Data    │         │ State       │         │ Experience  │
│ (0-100)     │         │ Objects     │         │ Management  │         │ Interaction │
│ Geospatial  │         │ Endpoints   │         │ Components  │         │ Data Access │
│ Coordinates │         │ Parameters  │         │ Events      │         │ Visualization│
└─────────────┘         └─────────────┘         └─────────────┘         └─────────────┘
```

## Key Components Interaction

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              COMPONENT INTERACTION FLOW                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   EXPLORE PAGE  │    │   MAP COMPONENT │    │   LAYER MANAGER │    │   GEE PROVIDER  │
│                 │    │                 │    │                 │    │                 │
│ • URL Routing   │    │ • Viewport      │    │ • Layer Parsing │    │ • Tile URLs     │
│ • State Init    │    │ • Interaction   │    │ • Provider Mgmt │    │ • GEE Integration│
│ • Data Fetch    │    │ • Event Handling│    │ • Render Setup  │    │ • Data Source   │
│ • Redux Dispatch│    │ • Map Controls  │    │ • Event Binding │    │ • Tile Generation│
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │                       │
         ▼                       ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   REDUX STORE   │    │   DECK.GL       │    │   MAPBOX GL     │    │   TILE SERVER   │
│                 │    │                 │    │                 │    │                 │
│ • Dataset State │    │ • TileLayer     │    │ • Map Instance  │    │ • GEE Tiler     │
│ • Map State     │    │ • Decode Func   │    │ • Layer Compos  │    │ • Raster Data   │
│ • UI State      │    │ • Color Mapping │    │ • Event System  │    │ • NO₂ Values    │
│ • Interaction   │    │ • Data Binding  │    │ • Viewport Mgmt │    │ • Tile Caching  │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

This visual representation shows how data flows from Google Earth Engine through the Resource Watch API, frontend services, state management, and finally to map visualization with interactive features.

