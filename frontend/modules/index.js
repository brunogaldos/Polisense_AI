import staticPagesReducer from './static-pages/reducers';
import exploreReducer from './explore';
import searchReducer from 'components/search-results/reducers';

export default {
  staticPages: staticPagesReducer,
  explore: exploreReducer,
  search: searchReducer,
};
