import { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useRouter } from 'next/router';

// components
import Icon from 'components/ui/icon';
import Modal from 'components/modal/modal-component';
import ShareModal from 'components/modal/share-modal';

export default function ExploreDetailHeader({
  dataset,
  setSelectedDataset,
  userIsLoggedIn,
  isSidebarOpen,
  setSidebarSection,
  setFiltersSearch,
  setFiltersSelected,
  fetchDatasets,
}) {
  const { query } = useRouter();
  const [showShareModal, setShowShareModal] = useState(false);

  const handleGoBack = useCallback(() => {
    const { search, section, topics } = query;
    setSelectedDataset(null);
    setSidebarSection(section);

    if (topics) setFiltersSelected({ key: 'topics', list: JSON.parse(decodeURIComponent(topics)) });

    if (search) {
      setFiltersSearch(search);
    }

    // Fetch datasets to ensure the list is reloaded when navigating back
    if (fetchDatasets) {
      fetchDatasets();
    }
  }, [query, setSelectedDataset, setSidebarSection, setFiltersSelected, setFiltersSearch, fetchDatasets]);

  const location = typeof window !== 'undefined' && window.location;
  const datasetName =
    dataset &&
    dataset.metadata &&
    dataset.metadata[0] &&
    dataset.metadata[0].info &&
    dataset.metadata[0].info.name;

  return (
    <div
      className="c-explore-detail-header"
      style={{
        ...(!isSidebarOpen && { position: 'absolute' }),
      }}
    >
      <button
        type="button"
        onClick={handleGoBack}
        className="c-btn -primary -compressed -fs-tiny all-datasets-button"
      >
        <Icon className="-small" name="icon-arrow-left-2" />
        <span>ALL DATASETS</span>
      </button>
      <div className="right-buttons">
        <button
          className="c-btn -quaternary -compressed -fs-tiny share-button"
          onClick={() => setShowShareModal(true)}
        >
          <Icon className="-small" name="icon-arrow-up-2" />
          <span>SHARE</span>
          <Modal
            isOpen={showShareModal}
            className="-medium"
            onRequestClose={() => setShowShareModal(false)}
          >
            <ShareModal
              links={{
                link: location && location.href,
                embed: location && `${location.origin}/embed${location.pathname}${location.search}`,
              }}
            />
          </Modal>
        </button>
      </div>
    </div>
  );
}

ExploreDetailHeader.propTypes = {
  dataset: PropTypes.shape({
    metadata: PropTypes.arrayOf(
      PropTypes.shape({
        info: PropTypes.shape({
          name: PropTypes.string,
        }),
      }),
    ),
  }).isRequired,
  userIsLoggedIn: PropTypes.bool.isRequired,
  isSidebarOpen: PropTypes.bool.isRequired,
  setSelectedDataset: PropTypes.func.isRequired,
  setSidebarSection: PropTypes.func.isRequired,
  setFiltersSearch: PropTypes.func.isRequired,
  setFiltersSelected: PropTypes.func.isRequired,
  fetchDatasets: PropTypes.func,
};
