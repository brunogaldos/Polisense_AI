import React from 'react';
import PropTypes from 'prop-types';

// components
import ProminentButton from 'components/prominent-button';
import Icon from 'components/ui/icon';

const ExploreDetailButtons = ({ dataset }) => {
  const { metadata } = dataset;
  const { info } = metadata[0];

  return (
    <div className="c-explore-detail-buttons">
      <div className="dataset-actions">
        {info.data_download_original_link && (
          <ProminentButton isLink>
            <a target="_blank" rel="noopener noreferrer" href={info.data_download_original_link}>
              <Icon name="icon-download" />
              <span>download from source</span>
            </a>
          </ProminentButton>
        )}
        {info.data_download_link && (
          <ProminentButton isLink>
            <a href={info.data_download_link}>
              <Icon name="icon-download" />
              <span>download</span>
            </a>
          </ProminentButton>
        )}
        {info.learn_more_link && (
          <ProminentButton isLink>
            <a target="_blank" rel="noopener noreferrer" href={info.learn_more_link}>
              <Icon name="icon-learn-more" />
              <span>learn more from source</span>
            </a>
          </ProminentButton>
        )}
      </div>
    </div>
  );
};

ExploreDetailButtons.propTypes = {
  dataset: PropTypes.shape({
    metadata: PropTypes.arrayOf(
      PropTypes.shape({
        info: PropTypes.shape({
          data_download_original_link: PropTypes.string,
          learn_more_link: PropTypes.string,
          data_download_link: PropTypes.string,
        }),
      }),
    ).isRequired,
  }).isRequired,
};

export default ExploreDetailButtons;
