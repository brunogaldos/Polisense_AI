import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

// services
import * as researchAPI from 'services/research-api';

// utils
import { logger } from 'utils/logs';

/**
 * Research Integration Status Component
 * Shows the current status of the research pipeline integration
 */
const ResearchIntegrationStatus = ({ onStatusChange }) => {
  const [status, setStatus] = useState({
    isConnected: false,
    clientId: null,
    lastError: null,
    connectionAttempts: 0,
  });

  useEffect(() => {
    // Get initial status
    const updateStatus = () => {
      const connectionStatus = researchAPI.getConnectionStatus();
      setStatus(prev => ({
        ...prev,
        ...connectionStatus,
      }));
      
      if (onStatusChange) {
        onStatusChange(connectionStatus);
      }
    };

    // Set up status monitoring
    const statusInterval = setInterval(updateStatus, 2000);
    updateStatus(); // Initial check

    // Set up connection handlers
    const handleConnection = (connectionStatus) => {
      logger.info('Research integration connection status:', connectionStatus);
      setStatus(prev => ({
        ...prev,
        isConnected: connectionStatus.type === 'connected',
        lastError: connectionStatus.type === 'connected' ? null : prev.lastError,
      }));
    };

    const handleError = (error) => {
      logger.error('Research integration error:', error);
      setStatus(prev => ({
        ...prev,
        lastError: error.message || 'Connection error',
        connectionAttempts: prev.connectionAttempts + 1,
      }));
    };

    researchAPI.onConnection(handleConnection);
    researchAPI.onError(handleError);

    return () => {
      clearInterval(statusInterval);
      researchAPI.offConnection(handleConnection);
      researchAPI.offError(handleError);
    };
  }, [onStatusChange]);

  const getStatusColor = () => {
    if (status.isConnected) return '#10b981'; // green
    if (status.lastError) return '#ef4444'; // red
    return '#f59e0b'; // yellow
  };

  const getStatusText = () => {
    if (status.isConnected) return 'Connected';
    if (status.lastError) return 'Error';
    return 'Connecting...';
  };

  return (
    <div className="research-integration-status">
      <div className="status-indicator">
        <div 
          className="status-dot" 
          style={{ backgroundColor: getStatusColor() }}
        />
        <span className="status-text">{getStatusText()}</span>
      </div>
      
      {status.clientId && (
        <div className="client-info">
          Client ID: {status.clientId.substring(0, 8)}...
        </div>
      )}
      
      {status.lastError && (
        <div className="error-info">
          Error: {status.lastError}
        </div>
      )}

      <style jsx>{`
        .research-integration-status {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: #6b7280;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          transition: background-color 0.3s ease;
        }

        .status-text {
          font-weight: 500;
        }

        .client-info {
          font-family: monospace;
          font-size: 10px;
          color: #9ca3af;
        }

        .error-info {
          color: #ef4444;
          font-size: 10px;
        }
      `}</style>
    </div>
  );
};

ResearchIntegrationStatus.propTypes = {
  onStatusChange: PropTypes.func,
};

export default ResearchIntegrationStatus;