import React from 'react';
import PropTypes from 'prop-types';

/**
 * Bullet List Component
 * Displays lists in bullet or numbered format
 */
const BulletList = ({ title, data }) => {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-lists">
        <h3>{title}</h3>
        <p>No list data available.</p>
      </div>
    );
  }

  const renderList = (list, index) => {
    if (list.type === 'bullet') {
      return (
        <div key={index} className="c-dynamic-dashboard__list c-dynamic-dashboard__list-bullet">
          <h4>{list.title}</h4>
          <ul>
            {list.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        </div>
      );
    }

    if (list.type === 'numbered') {
      return (
        <div key={index} className="c-dynamic-dashboard__list c-dynamic-dashboard__list-numbered">
          <h4>{list.title}</h4>
          <ol>
            {list.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ol>
        </div>
      );
    }

    return (
      <div key={index} className="c-dynamic-dashboard__list c-dynamic-dashboard__list-unknown">
        <h4>{list.title || 'List'}</h4>
        <pre>{JSON.stringify(list, null, 2)}</pre>
      </div>
    );
  };

  return (
    <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-lists">
      <h3>{title}</h3>
      <div className="c-dynamic-dashboard__lists">
        {data.map(renderList)}
      </div>
    </div>
  );
};

BulletList.propTypes = {
  title: PropTypes.string.isRequired,
  data: PropTypes.arrayOf(PropTypes.shape({
    type: PropTypes.string.isRequired,
    title: PropTypes.string,
    items: PropTypes.arrayOf(PropTypes.string),
  })).isRequired,
};

export default BulletList;
