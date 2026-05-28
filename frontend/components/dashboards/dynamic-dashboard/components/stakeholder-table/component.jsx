import React from 'react';
import PropTypes from 'prop-types';

/**
 * Stakeholder Table Component
 * Displays stakeholders in a structured table format
 */
const StakeholderTable = ({ title, data }) => {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-stakeholders">
        <h3>{title}</h3>
        <p>No stakeholder data available.</p>
      </div>
    );
  }

  return (
    <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-stakeholders">
      <h3>{title}</h3>
      <div className="c-dynamic-dashboard__table-container">
        <table className="c-dynamic-dashboard__table">
          <thead>
            <tr>
              <th>Organization/Name</th>
              <th>Role</th>
              <th>Contact</th>
              <th>Influence Level</th>
            </tr>
          </thead>
          <tbody>
            {data.map((stakeholder, index) => (
              <tr key={index}>
                <td>{stakeholder.name || 'Not specified'}</td>
                <td>{stakeholder.role || 'Not specified'}</td>
                <td>{stakeholder.contact || 'Not specified'}</td>
                <td>
                  <span className={`c-dynamic-dashboard__influence c-dynamic-dashboard__influence-${(stakeholder.influence || 'medium').toLowerCase()}`}>
                    {stakeholder.influence || 'Medium'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

StakeholderTable.propTypes = {
  title: PropTypes.string.isRequired,
  data: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string,
    role: PropTypes.string,
    contact: PropTypes.string,
    influence: PropTypes.string,
  })).isRequired,
};

export default StakeholderTable;
