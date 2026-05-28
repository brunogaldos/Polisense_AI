import React from 'react';
import PropTypes from 'prop-types';

/**
 * Intervention Matrix Component
 * Displays interventions in a structured matrix format
 */
const InterventionMatrix = ({ title, data }) => {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-interventions">
        <h3>{title}</h3>
        <p>No intervention data available.</p>
      </div>
    );
  }

  return (
    <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-interventions">
      <h3>{title}</h3>
      
      <div className="c-dynamic-dashboard__matrix">
        <div className="c-dynamic-dashboard__matrix-header">
          <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-header">Intervention</div>
          <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-header">Type</div>
          <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-header">Priority</div>
          <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-header">Timeline</div>
          <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-header">Cost</div>
        </div>
        
        {data.map((intervention, index) => (
          <div key={index} className="c-dynamic-dashboard__matrix-row">
            <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-intervention">
              <strong>{intervention.name}</strong>
            </div>
            <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-type">
              <span className="c-dynamic-dashboard__badge c-dynamic-dashboard__badge-type">
                {intervention.type}
              </span>
            </div>
            <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-priority">
              <span className={`c-dynamic-dashboard__badge c-dynamic-dashboard__badge-priority c-dynamic-dashboard__badge-priority-${(intervention.priority || 'medium').toLowerCase()}`}>
                {intervention.priority || 'Medium'}
              </span>
            </div>
            <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-timeline">
              <span className="c-dynamic-dashboard__badge c-dynamic-dashboard__badge-timeline">
                {intervention.timeline || 'Short-term'}
              </span>
            </div>
            <div className="c-dynamic-dashboard__matrix-cell c-dynamic-dashboard__matrix-cell-cost">
              <span className={`c-dynamic-dashboard__badge c-dynamic-dashboard__badge-cost c-dynamic-dashboard__badge-cost-${(intervention.cost || 'medium').toLowerCase()}`}>
                {intervention.cost || 'Medium'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

InterventionMatrix.propTypes = {
  title: PropTypes.string.isRequired,
  data: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string,
    type: PropTypes.string,
    priority: PropTypes.string,
    timeline: PropTypes.string,
    cost: PropTypes.string,
  })).isRequired,
};

export default InterventionMatrix;
