import React from 'react';
import PropTypes from 'prop-types';

/**
 * Data Table Component
 * Displays various types of data tables
 */
const DataTable = ({ title, data }) => {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-data">
        <h3>{title}</h3>
        <p>No data tables available.</p>
      </div>
    );
  }

  const renderTable = (table, index) => {
    if (table.type === 'keyvalue') {
      return (
        <div key={index} className="c-dynamic-dashboard__keyvalue-table">
          <h4>{table.title}</h4>
          <div className="c-dynamic-dashboard__keyvalue-container">
            {table.data.map((item, itemIndex) => (
              <div key={itemIndex} className="c-dynamic-dashboard__keyvalue-item">
                <span className="c-dynamic-dashboard__keyvalue-key">{item.key}:</span>
                <span className="c-dynamic-dashboard__keyvalue-value">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (table.type === 'table' && table.headers && table.data) {
      return (
        <div key={index} className="c-dynamic-dashboard__table-container">
          <h4>{table.title}</h4>
          <table className="c-dynamic-dashboard__table">
            <thead>
              <tr>
                {table.headers.map((header, headerIndex) => (
                  <th key={headerIndex}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.data.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div key={index} className="c-dynamic-dashboard__unknown-table">
        <h4>{table.title || 'Data Table'}</h4>
        <pre>{JSON.stringify(table, null, 2)}</pre>
      </div>
    );
  };

  return (
    <div className="c-dynamic-dashboard__section c-dynamic-dashboard__section-data">
      <h3>{title}</h3>
      <div className="c-dynamic-dashboard__tables">
        {data.map(renderTable)}
      </div>
    </div>
  );
};

DataTable.propTypes = {
  title: PropTypes.string.isRequired,
  data: PropTypes.arrayOf(PropTypes.shape({
    type: PropTypes.string.isRequired,
    title: PropTypes.string,
    headers: PropTypes.arrayOf(PropTypes.string),
    data: PropTypes.array,
  })).isRequired,
};

export default DataTable;
