import React from 'react';
import PropTypes from 'prop-types';

/**
 * Text Content Component
 * Displays raw text content with formatting
 */
const TextContent = ({ title, data }) => {
  if (!data || !data.content) {
    return (
      <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-text">
        <h3>{title}</h3>
        <p>No text content available.</p>
      </div>
    );
  }

  const { content, wordCount } = data;

  return (
    <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-text">
      <h3>{title}</h3>
      <div className="c-dynamic-dashboard__text-meta">
        <span className="c-dynamic-dashboard__word-count">
          {wordCount || content.split(' ').length} words
        </span>
      </div>
      <div className="c-dynamic-dashboard__text-content">
        {content.split('\n').map((paragraph, index) => {
          if (paragraph.trim() === '') {
            return <br key={index} />;
          }
          return (
            <p key={index} className="c-dynamic-dashboard__paragraph">
              {paragraph.trim()}
            </p>
          );
        })}
      </div>
    </div>
  );
};

TextContent.propTypes = {
  title: PropTypes.string.isRequired,
  data: PropTypes.shape({
    content: PropTypes.string.isRequired,
    wordCount: PropTypes.number,
  }).isRequired,
};

export default TextContent;
