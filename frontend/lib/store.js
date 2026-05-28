import { createStore, applyMiddleware, combineReducers, compose } from 'redux';
import thunk from 'redux-thunk';
import { createWrapper } from 'next-redux-wrapper';
import { handleModule } from 'redux-tools';
// todo: move redactions to modules
import * as reducers from 'redactions';
import modules from 'modules';

// Layout
import { reducers as headerReducers, initialState as headerInitialState } from 'layout/header';

// Share
import {
  reducers as shareModalReducers,
  initialState as shareModalInitialState,
} from 'components/modal/share-modal';

// Dataset
import {
  reducers as datasetListItemReducers,
  initialState as datasetListItemInitialState,
} from 'components/datasets/list/list-item';
import {
  reducers as similarDatasetsReducers,
  initialState as similarDatasetsInitialState,
} from 'components/datasets/similar-datasets/similar-datasets';

// REDUCERS
const reducer = combineReducers({
  ...reducers,
  ...modules,

  // Header
  header: handleModule({
    reducers: headerReducers,
    initialState: headerInitialState,
  }),

  // Share
  shareModal: handleModule({
    reducers: shareModalReducers,
    initialState: shareModalInitialState,
  }),

  // Dataset
  datasetListItem: handleModule({
    reducers: datasetListItemReducers,
    initialState: datasetListItemInitialState,
  }),
  similarDatasets: handleModule({
    reducers: similarDatasetsReducers,
    initialState: similarDatasetsInitialState,
  }),

});

function initStore() {
  const middlewares = applyMiddleware(thunk);
  const composeEnhancers =
    (typeof window !== 'undefined' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) || compose;

  const store = createStore(reducer, composeEnhancers(middlewares));

  return store;
}

export default createWrapper(initStore);
