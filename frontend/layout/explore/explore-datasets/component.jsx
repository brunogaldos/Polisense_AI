import { useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';

// components
import Icon from 'components/ui/icon';
import DatasetSearch from 'components/datasets/search';
import { EXPLORE_SECTIONS } from 'layout/explore/constants';
import DatasetList from './list';
import ExploreDatasetsActions from './explore-datasets-actions';

export default function ExploreDatasets(props) {
  const {
    datasets: { selected, list, total, limit, page, loading },
    selectedTags,
    search,
    setDatasetsPage,
    fetchDatasets,
    // Search-related props from Redux
    open,
    options,
    tab,
    tags,
    selected: searchSelected,
    // Redux actions
    setFiltersOpen,
    setFiltersTab,
    setFiltersSearch,
    toggleFiltersSelected,
    setFiltersSelected,
    resetFiltersSort,
    setSortSelected,
    setSortDirection,
    setSidebarSection,
    setSidebarOpen,
    section,
  } = props;

  // Create wrapper functions for the search component
  const onChangeTextSearch = useCallback(
    (_search) => {
      if (!_search) {
        resetFiltersSort();
      }
      setFiltersSearch(_search);
      setSidebarSection(EXPLORE_SECTIONS.ALL_DATA);
      setDatasetsPage(1);
      fetchDatasets();
    },
    [resetFiltersSort, setFiltersSearch, setSidebarSection, setDatasetsPage, fetchDatasets],
  );

  const onToggleSelected = useCallback(
    (payload) => {
      toggleFiltersSelected({ tag: payload, tab: 'topics' });
      setDatasetsPage(1);
      fetchDatasets();
    },
    [toggleFiltersSelected, setDatasetsPage, fetchDatasets],
  );

  const onChangeSelected = useCallback(
    (payload = []) => {
      setFiltersSelected({ key: tab, list: payload });
      setDatasetsPage(1);
      fetchDatasets();
    },
    [setFiltersSelected, tab, setDatasetsPage, fetchDatasets],
  );

  useEffect(() => {
    setDatasetsPage(1);
    fetchDatasets();
  }, [setDatasetsPage, fetchDatasets]);

  const classValue = classnames({
    'c-explore-datasets': true,
    '-hidden': selected,
  });

  return (
    <div className={classValue}>
      {/* Search Component at the top */}
      <div className="explore-datasets-search">
        <DatasetSearch
          open={open || false}
          tab={tab || 'topics'}
          list={tags || []}
          search={search || ''}
          options={options || {}}
          selected={searchSelected || {}}
          onChangeOpen={setFiltersOpen}
          onChangeTab={setFiltersTab}
          onChangeTextSearch={onChangeTextSearch}
          onToggleSelected={onToggleSelected}
          onChangeSelected={onChangeSelected}
        />
      </div>

      <div className="explore-datasets-header">
        <div className="left-container">
          <div className="tags-container">
            {selectedTags.length > 0 &&
              selectedTags.map((t) => (
                <button
                  key={t.id}
                  className="c-button -primary -compressed"
                  onClick={() => {
                    props.toggleFiltersSelected({ tag: t, tab: 'topics' });
                    setDatasetsPage(1);
                    fetchDatasets();
                  }}
                >
                  <span className="button-text" title={t.label.toUpperCase()}>
                    {t.label.toUpperCase()}
                  </span>
                  <Icon name="icon-cross" className="-tiny" />
                </button>
              ))}
            {search && (
              <button
                key="text-filter"
                className="c-button -primary -compressed"
                onClick={() => {
                  props.resetFiltersSort();
                  props.setFiltersSearch('');
                  fetchDatasets();
                }}
              >
                <span className="button-text" title={`TEXT: ${search.toUpperCase()}`}>
                  {`TEXT: ${search.toUpperCase()}`}
                </span>
                <Icon name="icon-cross" className="-tiny" />
              </button>
            )}
          </div>
        </div>
      </div>

      {!list.length && !loading && (
        <div className="request-data-container">
          <div className="request-data-text">
            Oops! We couldn&#39;t find data for your search...
          </div>
          <a
            className="c-button -primary"
            href="https://docs.google.com/forms/d/e/1FAIpQLSfXsPGQxM6p8KloU920t5Tfhx9FYFOq8-Rjml07UDH9EvsI1w/viewform"
            target="_blank"
            rel="noopener noreferrer"
          >
            Request data
          </a>
        </div>
      )}

      <DatasetList
        loading={loading}
        numberOfPlaceholders={20}
        list={list}
        actions={<ExploreDatasetsActions />}
      />
    </div>
  );
}

ExploreDatasets.propTypes = {
  datasets: PropTypes.shape({
    selected: PropTypes.string,
    list: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
      }),
    ).isRequired,
    total: PropTypes.number.isRequired,
    limit: PropTypes.number.isRequired,
    page: PropTypes.number.isRequired,
    loading: PropTypes.bool.isRequired,
  }).isRequired,
  selectedTags: PropTypes.arrayOf(PropTypes.shape()).isRequired,
  search: PropTypes.string.isRequired,
  fetchDatasets: PropTypes.func.isRequired,
  setDatasetsPage: PropTypes.func.isRequired,
  toggleFiltersSelected: PropTypes.func.isRequired,
  resetFiltersSort: PropTypes.func.isRequired,
  setFiltersSearch: PropTypes.func.isRequired,
  // Search-related props from Redux
  open: PropTypes.bool.isRequired,
  options: PropTypes.shape({}).isRequired,
  tab: PropTypes.string.isRequired,
  tags: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
  selected: PropTypes.shape({}).isRequired,
  setFiltersOpen: PropTypes.func.isRequired,
  setFiltersTab: PropTypes.func.isRequired,
  setFiltersSelected: PropTypes.func.isRequired,
  setSortSelected: PropTypes.func.isRequired,
  setSortDirection: PropTypes.func.isRequired,
  setSidebarSection: PropTypes.func.isRequired,
};
