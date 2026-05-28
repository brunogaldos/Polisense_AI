import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useDebouncedCallback } from 'use-debounce';
import Tether from 'react-tether';

import { useDashboard } from 'contexts/DashboardContext';

const HeaderDocuments = ({ label }) => {
  const [isVisible, setVisibility] = useState(false);
  const { uploadedDocuments } = useDashboard();

  const toggleDropdown = useDebouncedCallback((_isVisible) => {
    setVisibility(_isVisible);
  }, 50);

  const docCount = uploadedDocuments?.length || 0;

  const getIcon = (file) => {
    if (file.type?.includes('pdf')) return '📕';
    if (file.type?.startsWith('image/')) return '🖼️';
    if (file.name?.endsWith('.geojson')) return '🗺️';
    return '📄';
  };

  const getStatus = (file) => {
    if (file.extractionStatus === 'rag_ready' || file.extractionStatus === 'completed') return 'ready';
    if (file.extractionStatus === 'failed') return 'failed';
    return 'processing';
  };

  return (
    <Tether
      attachment="top center"
      constraints={[{ to: 'window' }]}
      classes={{ element: 'c-header-dropdown documents-dropdown' }}
      renderTarget={(ref) => (
        <a
          ref={ref}
          onMouseEnter={() => toggleDropdown(true)}
          onMouseLeave={() => toggleDropdown(false)}
          style={{ cursor: 'default', userSelect: 'none' }}
        >
          {label}
          {docCount > 0 && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 6,
              background: '#4effd0',
              color: '#1a2332',
              borderRadius: '50%',
              width: 16,
              height: 16,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              verticalAlign: 'middle',
            }}>
              {docCount}
            </span>
          )}
        </a>
      )}
      renderElement={(ref) => {
        if (!isVisible) return null;

        return (
          <ul
            ref={ref}
            className="header-dropdown-list documents-dropdown-list"
            onMouseEnter={() => toggleDropdown(true)}
            onMouseLeave={() => toggleDropdown(false)}
            style={{ minWidth: 260 }}
          >
            {docCount === 0 ? (
              <li
                className="header-dropdown-list-item"
                style={{ color: 'rgba(255,255,255,0.45)', fontStyle: 'italic', fontSize: 13, padding: '10px 16px' }}
              >
                No documents uploaded yet
              </li>
            ) : (
              uploadedDocuments.map((file) => {
                const status = getStatus(file);
                return (
                  <li key={file.id} className="header-dropdown-list-item" style={{ padding: '8px 16px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{getIcon(file)}</span>
                      <span style={{
                        flex: 1,
                        fontSize: 13,
                        color: 'rgba(255,255,255,0.85)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontFamily: 'Inter, sans-serif',
                      }} title={file.name}>
                        {file.name}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 12 }}>
                        {status === 'ready' && <span style={{ color: '#4effd0' }}>✓</span>}
                        {status === 'failed' && <span style={{ color: '#ef4444' }}>✗</span>}
                        {status === 'processing' && (
                          <svg width="12" height="12" viewBox="0 0 20 20" style={{ verticalAlign: 'middle' }}>
                            <circle cx="10" cy="10" r="7" fill="none" stroke="#4effd0" strokeWidth="2.5"
                              strokeDasharray="22 22" strokeLinecap="round">
                              <animateTransform attributeName="transform" type="rotate"
                                from="0 10 10" to="360 10 10" dur="1s" repeatCount="indefinite" />
                            </circle>
                          </svg>
                        )}
                      </span>
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        );
      }}
    />
  );
};

HeaderDocuments.propTypes = {
  label: PropTypes.string.isRequired,
};

export default HeaderDocuments;
