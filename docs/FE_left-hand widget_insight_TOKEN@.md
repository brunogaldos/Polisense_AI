## Data Explore – Left-hand Widget & Chatbot Linking (Insights)

### Goal
Explain how the left sidebar dataset widget and the chatbot “@” mentions both add datasets to the map using the same Redux logic, and where sorting, naming, and helper scripts live.

### Left Sidebar Dataset Widget
- **List & Header**: `layout/explore/explore-datasets/component.jsx`
  - Loads datasets, renders list and header (including total count).
  - Invokes `fetchDatasets()` to refresh when filters/sort/page change.

- **Sorting UI**: `layout/explore/explore-datasets-header/explore-datasets-sort/component.js`
  - Shows “SORT BY …” dropdown. Options come from `layout/explore/initial-state.js` → `sort.options`:
    - `updatedAt` (Last modified), `most-viewed`, `most-favorited`, `relevance`, `createdAt` (Date added).
  - On change, dispatches: `setSortSelected`, optional `setSortDirection`, `setSortIsUserSelected`, then `fetchDatasets()`.

- **Data Fetch for the widget**: `layout/explore/actions.js` → `fetchDatasets`
  - Builds API params: `includes: 'layer,metadata,vocabulary,widget'`, `sort`, `page[number]`, `page[size]`, `env`, `search`, and selected concept filters.
  - Uses `services/dataset.ts` to call the WRI API.
  - Stores list in Redux: `state.explore.datasets.list` (only published layers are kept).

- **“Add to map” button**: `layout/explore/explore-datasets/explore-datasets-actions/component.jsx`
  - Button toggles dataset on the map via:
    - `toggleMapLayerGroup({ dataset, toggle: !isActive })`
    - Also calls `resetMapLayerGroupsInteraction()`

- **Map state updates (source of truth)**: `layout/explore/reducers.js`
  - On `toggleMapLayerGroup`:
    - Adds/removes an entry in `state.map.layerGroups`:
      - `{ dataset: dataset.id, visibility: true, layers: dataset.layer.map(l => ({ ...l, active: l.default })) }`
    - Applies layer order if provided in `applicationConfig`.
  - Also handles `setMapLayerGroupVisibility`, `setMapLayerGroupOpacity`, and `setMapLayerGroupActive`.

### Chatbot “@” Mentions Linking
- **File**: `components/research/research-chatbot.jsx`
- **Dataset autocomplete fetch**
  - Calls `fetchDatasets({ 'page[size]': 400, includes: 'layer,metadata' })` to load a large batch for local filtering.
  - Friendly display names: prefers `dataset.metadata[0]?.info?.name`; falls back to a cleaned `dataset.name`.
  - Filters dropdown results by the text after `@`, up to 400 entries.

- **Selecting a dataset (dropdown or typing @...)**
  - On select, dispatches the same action as the widget:
    - `toggleMapLayerGroup({ dataset, toggle: true })`
  - Removing a token dispatches:
    - `toggleMapLayerGroup({ dataset, toggle: false })`
  - This guarantees the chatbot adds/removes layers with identical behavior to the left widget.

- **Token source and display**
  - Tokens are created from the selected dataset objects; each token stores the full dataset and a compact `shortName` (first 10 non-numeric chars) for UI.
  - Tokens appear below the input with small, compact styling; users can remove them, which deactivates the dataset on the map.

### Sorting: End-to-end
- UI writes sort state in `explore-datasets-sort/component.js`.
- `layout/explore/actions.js` → `fetchDatasets` sends `sort` to the API.
- The widget renders the server-sorted list.
- The chatbot keeps its own larger client-side list for mentions, but uses the same “Add to map” Redux action.

### Where “Most viewed / Most favorited” also appear
- `services/graph.js` has dedicated helpers for top datasets, but the main widget sorting flows through `fetchDatasets` with the `sort` param.

### Scripts (dataset export and checks)
- `scripts/fetch-all-datasets-simple.js`: fetches all datasets, normalizes JSON:API `attributes` into `layer`, `widget`, `metadata`; can output JSON and CSV.
- `scripts/export-to-csv.js`: converts the simplified JSON to CSV for quick inspection.
- `scripts/copy-datasets-to-public.js`: copies datasets JSON to `public/static/datasets.json` for browser consumption (optional now that the chatbot fetches directly from the API).
- `scripts/test-chatbot-datasets.js` and `scripts/test-browser-datasets.js`: quick verifiers for dataset structure/counts.

### Quick File Reference
- **Widget list & header**: `layout/explore/explore-datasets/component.jsx`
- **Sort UI**: `layout/explore/explore-datasets-header/explore-datasets-sort/component.js`
- **“Add to map” button**: `layout/explore/explore-datasets/explore-datasets-actions/component.jsx`
- **Redux actions**: `layout/explore/actions.js`
- **Redux reducer**: `layout/explore/reducers.js`
- **Sort defaults & options**: `layout/explore/initial-state.js`
- **Chatbot integration**: `components/research/research-chatbot.jsx`
- **API services**: `services/dataset.ts`, `services/graph.js`
- **Scripts**: `scripts/fetch-all-datasets-simple.js`, `scripts/export-to-csv.js`, `scripts/copy-datasets-to-public.js`


