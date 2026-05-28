import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import Link from 'next/link';

// components
import MapThumbnail from 'components/map/thumbnail';

// utils
import { getDateConsideringTimeZone } from 'utils/utils';

// lib
import { Media } from 'lib/media';

const DatasetListItem = (props) => {
  const { dataset, widget, layer, mode, actions, tags, metadata } = props;
  const renderChart = useCallback(() => {
    if (mode !== 'grid') return null;

    if (layer) {
      return (
        <div className="list-item-chart">
          <MapThumbnail layer={layer} />
        </div>
      );
    }

    return (
      <div className="list-item-chart">
        <Link href={`/data/explore/${dataset.slug}`}>
          <a>{dataset.name}</a>
        </Link>
      </div>
    );
  }, [mode, layer, dataset]);

  const dateLastUpdated = getDateConsideringTimeZone(dataset.dataLastUpdated);

  return (
    <div className={`c-dataset-list-item -${mode}`}>
      {/* CHART */}
      <Media greaterThanOrEqual="md">{renderChart()}</Media>

      {/* CHART MOBILE */}
      <Media at="sm">
        <Link href={`/data/explore/${dataset.slug}`}>{renderChart()}</Link>
      </Media>

      {/* INFO */}
      <div className="info">
        <div className="detail">
          {/* Title */}
          <div className="title-container">
            <h4>
              <Link href={`/data/explore/${dataset.slug}`}>
                <a>{(metadata && metadata.info && metadata.info.name) || dataset.name}</a>
              </Link>
            </h4>
          </div>

          {/* Source */}
          <div className="metadata-container">
            {metadata && metadata.source && (
              <p>
                Source: &nbsp;
                {metadata.source}
              </p>
            )}
          </div>

          {/* Last update */}
          <div className="last-update-container">
            {dateLastUpdated && (
              <p>
                Last update: &nbsp;
                {dateLastUpdated}
              </p>
            )}
          </div>

          {!!tags && React.cloneElement(tags, { ...props })}
        </div>

        {!!actions && React.cloneElement(actions, { ...props })}
      </div>
    </div>
  );
};

DatasetListItem.defaultProps = {
  mode: 'grid',
  widget: null,
  layer: null,
  metadata: null,
  tags: null,
  actions: null,
};

DatasetListItem.propTypes = {
  dataset: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    slug: PropTypes.string.isRequired,
    dataLastUpdated: PropTypes.string,
  }).isRequired,
  widget: PropTypes.shape({
    widgetConfig: PropTypes.shape({
      type: PropTypes.string,
    }),
  }),
  layer: PropTypes.shape({}),
  metadata: PropTypes.shape({
    source: PropTypes.string,
    info: PropTypes.shape({
      name: PropTypes.string,
    }),
  }),
  mode: PropTypes.string,
  tags: PropTypes.node,
  actions: PropTypes.node,
};

export default DatasetListItem;
