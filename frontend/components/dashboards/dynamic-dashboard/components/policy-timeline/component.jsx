import React from 'react';
import PropTypes from 'prop-types';

/**
 * Policy Timeline Component
 * Displays policies and barriers in a timeline format
 */
const PolicyTimeline = ({ title, data }) => {
  const { policies = [], barriers = [] } = data || {};

  return (
    <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-policies">
      <h3>{title}</h3>
      
      <div className="c-dynamic-dashboard__timeline">
        {/* Policies Section */}
        {policies.length > 0 && (
          <div className="c-dynamic-dashboard__timeline-section">
            <h4>📋 Policies & Regulations</h4>
            <div className="c-dynamic-dashboard__timeline-items">
              {policies.map((policy, index) => (
                <div key={`policy-${index}`} className="c-dynamic-dashboard__timeline-item c-dynamic-dashboard__timeline-item-policy">
                  <div className="c-dynamic-dashboard__timeline-marker"></div>
                  <div className="c-dynamic-dashboard__timeline-content">
                    <h5>{policy.name}</h5>
                    <div className="c-dynamic-dashboard__timeline-meta">
                      <span className="c-dynamic-dashboard__badge c-dynamic-dashboard__badge-type">
                        {policy.type}
                      </span>
                      <span className="c-dynamic-dashboard__badge c-dynamic-dashboard__badge-status">
                        {policy.status}
                      </span>
                      <span className="c-dynamic-dashboard__badge c-dynamic-dashboard__badge-impact">
                        Impact: {policy.impact}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Barriers Section */}
        {barriers.length > 0 && (
          <div className="c-dynamic-dashboard__timeline-section">
            <h4>🚧 Barriers & Challenges</h4>
            <div className="c-dynamic-dashboard__timeline-items">
              {barriers.map((barrier, index) => (
                <div key={`barrier-${index}`} className="c-dynamic-dashboard__timeline-item c-dynamic-dashboard__timeline-item-barrier">
                  <div className="c-dynamic-dashboard__timeline-marker"></div>
                  <div className="c-dynamic-dashboard__timeline-content">
                    <h5>{barrier.name}</h5>
                    <div className="c-dynamic-dashboard__timeline-meta">
                      <span className="c-dynamic-dashboard__badge c-dynamic-dashboard__badge-type">
                        {barrier.type}
                      </span>
                      <span className="c-dynamic-dashboard__badge c-dynamic-dashboard__badge-severity">
                        Severity: {barrier.severity}
                      </span>
                      <span className="c-dynamic-dashboard__badge c-dynamic-dashboard__badge-category">
                        {barrier.category}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No data message */}
        {policies.length === 0 && barriers.length === 0 && (
          <div className="c-dynamic-dashboard__no-data">
            <p>No policy or barrier data available.</p>
          </div>
        )}
      </div>
    </div>
  );
};

PolicyTimeline.propTypes = {
  title: PropTypes.string.isRequired,
  data: PropTypes.shape({
    policies: PropTypes.arrayOf(PropTypes.shape({
      name: PropTypes.string,
      type: PropTypes.string,
      status: PropTypes.string,
      impact: PropTypes.string,
    })),
    barriers: PropTypes.arrayOf(PropTypes.shape({
      name: PropTypes.string,
      type: PropTypes.string,
      severity: PropTypes.string,
      category: PropTypes.string,
    })),
  }).isRequired,
};

export default PolicyTimeline;
