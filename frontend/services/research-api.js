import axios from 'axios';

// utils
import { logger } from '../utils/logs.js';

/**
 * Research API Service
 * Handles communication with the WebApi backend for live research functionality
 */

// Configuration
const RESEARCH_API_BASE_URL = process.env.NEXT_PUBLIC_RESEARCH_API_URL || '/api';
const RESEARCH_WS_URL = process.env.NEXT_PUBLIC_RESEARCH_WS_URL || 'ws://localhost:5029/ws';

// Debug logging for configuration
logger.info('Research API Configuration:', {
  apiUrl: RESEARCH_API_BASE_URL,
  wsUrl: RESEARCH_WS_URL
});

// Create axios instance for research API
const researchAPI = axios.create({
  baseURL: RESEARCH_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 40000, // 40 second timeout for research requests
});

/**
 * WebSocket connection manager
 */
class ResearchWebSocketManager {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // Start with 1 second
    this.messageHandlers = new Map();
    this.connectionHandlers = new Set();
    this.errorHandlers = new Set();
    this.spinnerActive = false; // Track spinner state for intermediate messages
    this.spinnerHandlers = new Set(); // Handlers for spinner state changes
    this.isReconnecting = false; // Track if reconnection is in progress
    this.isIntentionallyClosed = false; // Track if connection was intentionally closed
    this.reconnectTimeout = null; // Track reconnection timeout
    this.connectionPromise = null; // Track ongoing connection attempt
    this.lastError = null; // Track last error to prevent duplicate notifications
    this.errorNotificationTimeout = null; // Track error notification debounce
  }

  /**
   * Establish WebSocket connection
   * @returns {Promise<string>} Promise that resolves with client ID
   */
  establishWebSocket() {
    // If already connected, return existing promise
    if (this.isConnected && this.clientId) {
      return Promise.resolve(this.clientId);
    }
    
    // If connection attempt is already in progress, return that promise
    if (this.connectionPromise) {
      return this.connectionPromise;
    }
    
    // If intentionally closed, don't reconnect automatically
    if (this.isIntentionallyClosed) {
      return Promise.reject(new Error('WebSocket was intentionally closed'));
    }
    
    this.connectionPromise = new Promise((resolve, reject) => {
      try {
        // Close existing connection if any
        if (this.ws) {
          try {
            this.ws.close();
          } catch (e) {
            // Ignore errors when closing
          }
        }
        
        logger.info('Establishing WebSocket connection to research service');
        
        this.ws = new WebSocket(RESEARCH_WS_URL);
        
        this.ws.onopen = () => {
          logger.info('WebSocket connected to research service');
          this.isConnected = true;
          this.isReconnecting = false;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.isIntentionallyClosed = false;
          
          // Clear reconnection timeout if it exists
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
          }
          
          // Clear connection promise
          this.connectionPromise = null;
          
          // Notify connection handlers
          this.connectionHandlers.forEach(handler => {
            try {
              handler({ type: 'connected' });
            } catch (error) {
              logger.error('Error in connection handler:', error);
            }
          });
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            logger.info('WebSocket message received:', message);
            
            // Handle client ID assignment
            if (message.clientId && !this.clientId) {
              this.clientId = message.clientId;
              logger.info('WebSocket client ID assigned:', this.clientId);
              resolve(this.clientId);
            }
            
            // Handle different message formats from the research pipeline
            let processedMessage = message;
            
            // Handle agent messages (from research pipeline)
            if (message.type === 'agentStart') {
              processedMessage = {
                type: 'agent_start',
                message: message.message,
                data: message.data || message
              };
              // Activate spinner when agent starts
              this.setSpinnerActive(true);
            } else if (message.type === 'agentUpdate') {
              processedMessage = {
                type: 'agent_update',
                message: message.message,
                data: message.data || message
              };
              // Keep spinner active during agent updates
              this.setSpinnerActive(true);
            } else if (message.type === 'agentCompleted') {
              processedMessage = {
                type: 'agent_completed',
                message: message.message,
                data: message.data || message
              };
              // Only deactivate spinner when the last agent completes
              if (message.data?.lastAgent === true) {
                this.setSpinnerActive(false);
              }
            } else if (message.type === 'streamResponse') {
              processedMessage = {
                type: 'stream_response',
                content: message.content,
                data: message.data || message
              };
              // Keep spinner active during streaming
              this.setSpinnerActive(true);
            } else if (message.type === 'streamEnd') {
              processedMessage = {
                type: 'stream_end',
                data: message.data || message
              };
              // Deactivate spinner when streaming ends
              this.setSpinnerActive(false);
            } else if (message.type === 'chatResponse') {
              processedMessage = {
                type: 'chat_response',
                content: message.content,
                data: message.data || message
              };
              // Deactivate spinner when chat response is complete
              this.setSpinnerActive(false);
            } else if (message.type === 'costUpdate') {
              processedMessage = {
                type: 'cost_update',
                data: message.data || message
              };
            } else if (message.type === 'error') {
              processedMessage = {
                type: 'error',
                message: message.message || message.error,
                data: message.data || message
              };
              // Deactivate spinner on error
              this.setSpinnerActive(false);
            }
            
            // Route message to appropriate handlers
            const messageType = processedMessage.type || 'unknown';
            console.log('🔍 DEBUG: Routing message type:', messageType);
            console.log('🔍 DEBUG: Available handlers:', Array.from(this.messageHandlers.keys()));
            
            const handlers = this.messageHandlers.get(messageType) || [];
            console.log('🔍 DEBUG: Found handlers for type', messageType, ':', handlers.length);
            handlers.forEach(handler => {
              try {
                console.log('🔍 DEBUG: Calling handler for type', messageType);
                handler(processedMessage);
              } catch (error) {
                logger.error(`Error in message handler for type ${messageType}:`, error);
              }
            });
            
            // Also call generic message handlers
            const genericHandlers = this.messageHandlers.get('*') || [];
            console.log('🔍 DEBUG: Generic handlers:', genericHandlers.length);
            genericHandlers.forEach(handler => {
              try {
                console.log('🔍 DEBUG: Calling generic handler');
                handler(processedMessage);
              } catch (error) {
                logger.error('Error in generic message handler:', error);
              }
            });
            
          } catch (error) {
            logger.error('Error parsing WebSocket message:', error);
            this.notifyErrorHandlers(new Error('Failed to parse WebSocket message'));
          }
        };
        
        this.ws.onclose = (event) => {
          logger.info('WebSocket disconnected:', event.code, event.reason);
          this.isConnected = false;
          this.clientId = null;
          this.connectionPromise = null;
          
          // Notify connection handlers
          this.connectionHandlers.forEach(handler => {
            try {
              handler({ type: 'disconnected', code: event.code, reason: event.reason });
            } catch (error) {
              logger.error('Error in connection handler:', error);
            }
          });
          
          // Don't reconnect if intentionally closed or already reconnecting
          if (this.isIntentionallyClosed || this.isReconnecting) {
            return;
          }
          
          // Don't reconnect for normal closure codes (1000, 1001)
          if (event.code === 1000 || event.code === 1001) {
            logger.info('WebSocket closed normally, not attempting reconnection');
            return;
          }
          
          // Attempt reconnection with exponential backoff
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.isReconnecting = true;
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            // Clear any existing timeout
            if (this.reconnectTimeout) {
              clearTimeout(this.reconnectTimeout);
            }
            
            this.reconnectTimeout = setTimeout(() => {
              this.reconnectTimeout = null;
              this.establishWebSocket()
                .then(() => {
                  this.isReconnecting = false;
                })
                .catch(error => {
                  this.isReconnecting = false;
                  logger.error('Reconnection failed:', error);
                  if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    this.notifyErrorHandlers(new Error('Max reconnection attempts reached'));
                  }
                });
            }, delay);
          } else {
            this.isReconnecting = false;
            this.notifyErrorHandlers(new Error('WebSocket connection lost and max reconnection attempts reached'));
          }
        };
        
        this.ws.onerror = (error) => {
          logger.error('WebSocket error:', error);
          this.notifyErrorHandlers(new Error('WebSocket connection error'));
          
          if (!this.clientId) {
            reject(new Error('Failed to establish WebSocket connection'));
          }
        };
        
      } catch (error) {
        logger.error('Error establishing WebSocket connection:', error);
        this.connectionPromise = null;
        this.isReconnecting = false;
        reject(error);
      }
    });
    
    return this.connectionPromise;
  }

  /**
   * Send message through WebSocket
   * @param {Object} message - Message to send
   * @returns {Promise<void>}
   */
  sendMessage(message) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      if (!this.clientId) {
        reject(new Error('WebSocket client ID not available'));
        return;
      }
      
      try {
        const payload = {
          ...message,
          clientId: this.clientId,
        };
        
        this.ws.send(JSON.stringify(payload));
        resolve();
      } catch (error) {
        logger.error('Error sending WebSocket message:', error);
        reject(error);
      }
    });
  }

  /**
   * Add message handler for specific message type
   * @param {string} messageType - Type of message to handle ('*' for all messages)
   * @param {Function} handler - Handler function
   */
  onMessage(messageType, handler) {
    console.log('🔍 DEBUG: Registering handler for message type:', messageType);
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, []);
    }
    this.messageHandlers.get(messageType).push(handler);
    console.log('🔍 DEBUG: Total handlers for type', messageType, ':', this.messageHandlers.get(messageType).length);
  }

  /**
   * Remove message handler
   * @param {string} messageType - Type of message
   * @param {Function} handler - Handler function to remove
   */
  offMessage(messageType, handler) {
    const handlers = this.messageHandlers.get(messageType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Add connection status handler
   * @param {Function} handler - Handler function
   */
  onConnection(handler) {
    this.connectionHandlers.add(handler);
  }

  /**
   * Remove connection status handler
   * @param {Function} handler - Handler function to remove
   */
  offConnection(handler) {
    this.connectionHandlers.delete(handler);
  }

  /**
   * Add error handler
   * @param {Function} handler - Handler function
   */
  onError(handler) {
    this.errorHandlers.add(handler);
  }

  /**
   * Remove error handler
   * @param {Function} handler - Handler function to remove
   */
  offError(handler) {
    this.errorHandlers.delete(handler);
  }

  /**
   * Notify error handlers
   * @private
   */
  notifyErrorHandlers(error) {
    const errorMessage = error?.message || String(error);
    
    // Prevent duplicate error notifications within 2 seconds
    if (this.lastError === errorMessage && this.errorNotificationTimeout) {
      return; // Skip duplicate error
    }
    
    // Clear existing timeout
    if (this.errorNotificationTimeout) {
      clearTimeout(this.errorNotificationTimeout);
    }
    
    // Set last error and debounce timeout
    this.lastError = errorMessage;
    this.errorNotificationTimeout = setTimeout(() => {
      this.lastError = null;
      this.errorNotificationTimeout = null;
    }, 2000); // Clear after 2 seconds
    
    // Notify handlers
    this.errorHandlers.forEach(handler => {
      try {
        handler(error);
      } catch (handlerError) {
        logger.error('Error in error handler:', handlerError);
      }
    });
  }

  /**
   * Set spinner active state
   * @param {boolean} active - Whether spinner should be active
   */
  setSpinnerActive(active) {
    this.spinnerActive = active;
    this.notifySpinnerHandlers(active);
  }

  /**
   * Get current spinner state
   * @returns {boolean} Current spinner state
   */
  getSpinnerActive() {
    return this.spinnerActive;
  }

  /**
   * Add spinner state change handler
   * @param {Function} handler - Handler function that receives spinner state
   */
  onSpinnerChange(handler) {
    this.spinnerHandlers.add(handler);
  }

  /**
   * Remove spinner state change handler
   * @param {Function} handler - Handler function to remove
   */
  offSpinnerChange(handler) {
    this.spinnerHandlers.delete(handler);
  }

  /**
   * Notify spinner handlers of state change
   * @private
   * @param {boolean} active - New spinner state
   */
  notifySpinnerHandlers(active) {
    this.spinnerHandlers.forEach(handler => {
      try {
        handler(active);
      } catch (handlerError) {
        logger.error('Error in spinner handler:', handlerError);
      }
    });
  }

  /**
   * Close WebSocket connection
   */
  close() {
    this.isIntentionallyClosed = true;
    this.isReconnecting = false;
    
    // Clear reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      try {
        this.ws.close(1000, 'Intentional close'); // Normal closure code
      } catch (e) {
        // Ignore errors when closing
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.clientId = null;
    this.reconnectAttempts = 0;
    this.connectionPromise = null;
  }

  /**
   * Get connection status
   * @returns {Object} Connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      clientId: this.clientId,
      reconnectAttempts: this.reconnectAttempts,
      spinnerActive: this.spinnerActive, // Include spinner state in status
    };
  }
}

// Global WebSocket manager instance
let wsManager = null;

/**
 * Get or create WebSocket manager instance
 * @returns {ResearchWebSocketManager}
 */
const getWebSocketManager = () => {
  if (!wsManager) {
    wsManager = new ResearchWebSocketManager();
  }
  return wsManager;
};

/**
 * Send research conversation request
 * @param {Array} chatLog - Array of chat messages
 * @param {Object} options - Research options
 * @returns {Promise<Array>} Promise that resolves with saved chat log or empty array
 */
export const conversation = async (chatLog = [], options = {}) => {
  logger.info('Sending research conversation request');
  
  const wsManager = getWebSocketManager();
  
  // Ensure WebSocket connection is established to get client ID
  if (!wsManager.isConnected) {
    logger.info('WebSocket not connected, establishing connection...');
    await wsManager.establishWebSocket();
  }
  
  if (!wsManager.clientId) {
    throw new Error('WebSocket client ID not available');
  }
  
  // Prepare research request payload
  const requestPayload = {
    wsClientId: wsManager.clientId,
    chatLog: chatLog.map(msg => ({
      sender: msg.sender || (msg.type === 'user' ? 'user' : 'assistant'),
      message: msg.message || msg.text || msg.content || '',
      timestamp: msg.timestamp || new Date(),
    })),
    numberOfSelectQueries: options.numberOfSelectQueries || 7,
    percentOfTopQueriesToSearch: options.percentOfTopQueriesToSearch || 0.25,
    percentOfTopResultsToScan: options.percentOfTopResultsToScan || 0.25,
    memoryId: options.memoryId,
    userId: options.userId, // Include userId from Firebase Auth
    uploadedDocuments: options.uploadedDocuments, // Include uploaded document names
  };
  
  logger.info('Research request payload:', {
    wsClientId: requestPayload.wsClientId,
    chatLogLength: requestPayload.chatLog.length,
    numberOfSelectQueries: requestPayload.numberOfSelectQueries,
    percentOfTopQueriesToSearch: requestPayload.percentOfTopQueriesToSearch,
    percentOfTopResultsToScan: requestPayload.percentOfTopResultsToScan
  });
  
  try {
    // Send HTTP PUT request to initiate research conversation
    const response = await researchAPI.put('/policy_research/', requestPayload);
    
    logger.info('Research conversation request successful:', response.status);
    
    // Return the saved chat log if available, otherwise empty array
    return response.data || [];
  } catch (error) {
    logger.error('Error sending research conversation request:', error);
    
    let errorMessage = 'Failed to send research request';
    if (error.response) {
      const { status, statusText, data } = error.response;
      errorMessage = `${status} – ${statusText}`;
      logger.error('API error response:', data);
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
};

/**
 * Get chat log from server
 * @param {string} memoryId - Memory ID for the chat session
 * @returns {Promise<Object>} Object containing chatLog array and totalCosts
 */
export const getChatLog = async (memoryId) => {
  logger.info('Getting chat log for memory ID:', memoryId);
  
  if (!memoryId) {
    throw new Error('Memory ID is required');
  }
  
  try {
    const response = await researchAPI.get(`/policy_research/${memoryId}`);
    return response.data;
  } catch (error) {
    logger.error('Error getting chat log:', error);
    
    let errorMessage = 'Failed to get chat log';
    if (error.response) {
      const { status, statusText } = error.response;
      errorMessage = `${status} – ${statusText}`;
      
      // Return empty result for 404 (not found)
      if (status === 404) {
        return { chatLog: [], totalCosts: 0 };
      }
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
};

/**
 * Get user's conversation list from server
 * @param {string} userId - User ID (Firebase Auth UID)
 * @returns {Promise<Array>} Array of conversation objects with metadata
 */
export const getUserConversations = async (userId) => {
  logger.info('Getting user conversations for userId:', userId);
  
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  try {
    const response = await researchAPI.get(`/policy_research/conversations?userId=${userId}`);
    return response.data?.conversations || [];
  } catch (error) {
    logger.error('Error getting user conversations:', error);
    
    // Return empty array on error (don't throw)
    if (error.response && error.response.status === 404) {
      return [];
    }
    
    console.warn('Failed to load user conversations:', error.message);
    return [];
  }
};

/**
 * Delete a conversation from server
 * @param {string} memoryId - Memory ID of the conversation to delete
 * @param {string} userId - User ID (Firebase Auth UID) for verification
 * @returns {Promise<boolean>} True if deletion was successful
 */
export const deleteConversation = async (memoryId, userId) => {
  logger.info('Deleting conversation:', { memoryId, userId });
  
  if (!memoryId) {
    throw new Error('Memory ID is required');
  }
  
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  try {
    const response = await researchAPI.delete(`/policy_research/conversations/${memoryId}?userId=${userId}`);
    logger.info('Conversation deleted successfully:', memoryId);
    return response.data?.success || true;
  } catch (error) {
    logger.error('Error deleting conversation:', error);
    
    let errorMessage = 'Failed to delete conversation';
    if (error.response) {
      const { status, statusText, data } = error.response;
      errorMessage = `${status} – ${statusText}`;
      if (data?.error) {
        errorMessage = data.error;
      }
      logger.error('API error response:', data);
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
};

/**
 * Extract metadata from a file using OCR
 * @param {File} file - File to extract metadata from
 * @param {Function} onProgress - Optional progress callback (progress: number) => void
 * @param {string} memoryId - Optional memory/conversation ID to scope the document
 * @param {string} userId - Optional user ID who uploaded the document
 * @returns {Promise<Object>} Extracted metadata object
 */
export const extractFile = async (file, onProgress, memoryId, userId) => {
  logger.info('Extracting metadata from file:', file.name, { memoryId, userId });
  
  if (!file) {
    throw new Error('File is required');
  }
  
  try {
    // Create FormData for file upload
    const formData = new FormData();
    formData.append('file', file);
    
    // Append memoryId and userId if provided
    if (memoryId) {
      formData.append('memoryId', memoryId);
      logger.info('Including memoryId in file upload:', memoryId);
    }
    if (userId) {
      formData.append('userId', userId);
      logger.info('Including userId in file upload:', userId);
    }
    
    // Create axios instance for multipart upload.
    // Do NOT set Content-Type manually — axios/browser must set it automatically
    // with the multipart boundary, otherwise the server can't parse the body.
    // Backend returns 202 immediately after multer buffers file in memory (should be < 5 seconds)
    const extractAPI = axios.create({
      baseURL: RESEARCH_API_BASE_URL,
      timeout: 30000, // 30 second timeout - backend should respond with 202 much faster than this
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
    
    const response = await extractAPI.post('/policy_research/extract', formData);
    
    // Check if extraction is processing (202 status) or complete (200 status)
    if (response.status === 202 || response.data?.status === 'processing') {
      // Extraction started, return fileId for polling
      logger.info('File extraction started:', file.name, 'fileId:', response.data?.fileId);
      return {
        fileId: response.data?.fileId,
        status: 'processing',
        metadata: null
      };
    }
    
    // Extraction completed synchronously (shouldn't happen with new async flow, but handle it)
    logger.info('File extraction successful:', file.name);
    return {
      metadata: response.data?.metadata || response.data,
      fileId: response.data?.fileId,
      status: 'complete'
    };
  } catch (error) {
    logger.error('Error extracting file:', error);
    
    // Check if it's a timeout error
    const isTimeout = error.code === 'ECONNABORTED' || 
                     error.message?.includes('timeout') || 
                     error.message?.includes('TIMEOUT');
    
    let errorMessage = 'Failed to extract file metadata';
    if (isTimeout) {
      errorMessage = 'Extraction timed out. The document is too large and processing exceeded the time limit. Please try a smaller document or split the PDF into smaller files.';
    } else if (error.response) {
      const { status, statusText, data } = error.response;
      errorMessage = `${status} – ${statusText}`;
      if (data?.error) {
        errorMessage = data.error;
      }
      if (data?.details) {
        errorMessage += `: ${data.details}`;
      }
      logger.error('API error response:', data);
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    // Attach timeout flag to error for better handling
    const enhancedError = new Error(errorMessage);
    if (isTimeout) {
      enhancedError.isTimeout = true;
    }
    throw enhancedError;
  }
};

/**
 * Upload a GeoJSON file for RAG ingestion (feature-level chunking).
 * Returns immediately with a fileId; the backend processes in the background.
 *
 * @param {Object} fileObj - File object with a .file (File) or the File itself
 * @param {string} memoryId - Conversation/memory ID
 * @param {string} userId - User ID
 */
export const ingestGeoJson = async (geojsonContent, fileName, memoryId, userId) => {
  // Send as JSON body — the component already parsed the GeoJSON with FileReader,
  // so we avoid all FormData/multipart/boundary issues entirely.
  const response = await researchAPI.post(
    '/policy_research/ingest-geojson',
    { geojsonContent, fileName, memoryId, userId },
    { timeout: 300000 } // 5 minutes — large GeoJSON can take time to index
  );

  return {
    fileId: response.data?.fileId,
    featureCount: response.data?.featureCount,
    status: 'processing',
  };
};

export const ingestJson = async (jsonContent, fileName, memoryId, userId) => {
  const response = await researchAPI.post(
    '/policy_research/ingest-json',
    { jsonContent, fileName, memoryId, userId },
    { timeout: 120000 } // 2 minutes
  );

  return {
    fileId: response.data?.fileId,
    recordCount: response.data?.recordCount,
    status: 'processing',
  };
};


/**
 * Download a document from S3 via the backend proxy.
 * Triggers a browser file download for the given document.
 *
 * @param {string} memoryId - Conversation/memory ID
 * @param {string} documentId - Document ID
 * @param {string} fileName - Original filename (used for the download dialog)
 */
export const ingestPdf = async (formData) => {
  const response = await researchAPI.post('/policy_research/ingest-pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return response.data;
};

export const downloadDocument = async (memoryId, documentId, fileName) => {
  const response = await researchAPI.get(
    `/policy_research/conversations/${encodeURIComponent(memoryId)}/documents/${encodeURIComponent(documentId)}/download`,
    {
      params: { name: fileName }, // name hint for fallback lookup on the backend
      responseType: 'blob',
      timeout: 60000,
    }
  );

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

/**
 * Get extraction result by file ID or file name (for "View Metadata" button)
 * @param {string} fileIdOrFileName - File ID or filename (without extension)
 * @param {Object} options - Optional settings
 * @param {boolean} options.skipAgeCheck - Skip age check for old documents (default: false)
 */
export const getExtractionResult = async (fileIdOrFileName, options = {}) => {
  try {
    // Encode the parameter to handle special characters in file names
    const encodedParam = encodeURIComponent(fileIdOrFileName);
    // Add skipAgeCheck query param if requested (for viewing old documents)
    const queryParams = options.skipAgeCheck ? '?skipAgeCheck=true' : '';
    const url = `${RESEARCH_API_BASE_URL}/policy_research/extract/result/${encodedParam}${queryParams}`;
    
    // Use fetch instead of axios for better streaming support and to avoid connection issues
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        // If 404, the result is not ready yet (extraction still processing)
        if (response.status === 404) {
          const notReadyError = new Error('Extraction result not ready yet');
          notReadyError.code = 'NOT_READY';
          throw notReadyError;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Parse JSON response
      const data = await response.json();
      return data?.metadata || data;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Handle abort (timeout)
      if (fetchError.name === 'AbortError') {
        const timeoutError = new Error('Request timeout');
        timeoutError.code = 'ETIMEDOUT';
        throw timeoutError;
      }
      
      throw fetchError;
    }
  } catch (error) {
    // If 404, the result is not ready yet (extraction still processing)
    if (error.code === 'NOT_READY') {
      throw error; // Re-throw as-is
    }
    logger.error('Error retrieving extraction result:', error);
    throw error;
  }
};

// ============================================================================
// Document Management API Methods
// ============================================================================

/**
 * Add or update a document in a conversation
 * @param {string} memoryId - Memory ID for the conversation
 * @param {Object} document - Document metadata object
 * @param {string} document.id - Unique document ID
 * @param {string} document.name - File name
 * @param {number} document.size - File size in bytes
 * @param {string} document.type - MIME type
 * @param {string} document.extractionStatus - Status: 'pending' | 'extracting' | 'completed' | 'failed'
 * @param {string} userId - User ID (Firebase Auth UID)
 * @returns {Promise<Object>} Updated document metadata
 */
export const addDocumentToConversation = async (memoryId, document, userId) => {
  logger.info('Adding document to conversation:', { memoryId, documentId: document?.id, userId });

  if (!memoryId) {
    throw new Error('Memory ID is required');
  }

  if (!document || !document.id) {
    throw new Error('Document with ID is required');
  }

  if (!userId) {
    throw new Error('User ID is required');
  }

  try {
    const response = await researchAPI.post(
      `/policy_research/conversations/${memoryId}/documents`,
      { document, userId }
    );

    logger.info('Document added successfully:', document.id);
    return response.data?.document || response.data;
  } catch (error) {
    logger.error('Error adding document to conversation:', error);

    let errorMessage = 'Failed to add document';
    if (error.response) {
      const { status, statusText, data } = error.response;
      errorMessage = data?.error || `${status} – ${statusText}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    throw new Error(errorMessage);
  }
};

/**
 * Update a document's extraction status
 * @param {string} memoryId - Memory ID for the conversation
 * @param {string} documentId - Document ID to update
 * @param {string} status - New status: 'pending' | 'extracting' | 'completed' | 'failed'
 * @param {Object} additionalData - Optional additional data to update (extractedMetadata, markdownFileName, documentName, etc.)
 * @param {string} userId - User ID (Firebase Auth UID)
 * @returns {Promise<Object>} Updated document metadata
 */
export const updateDocumentStatus = async (memoryId, documentId, status, additionalData = {}, userId) => {
  logger.info('Updating document status:', { memoryId, documentId, status, userId, documentName: additionalData.documentName });

  if (!memoryId) {
    throw new Error('Memory ID is required');
  }

  if (!documentId) {
    throw new Error('Document ID is required');
  }

  if (!status) {
    throw new Error('Status is required');
  }

  if (!userId) {
    throw new Error('User ID is required');
  }

  try {
    const response = await researchAPI.put(
      `/policy_research/conversations/${memoryId}/documents/${documentId}`,
      { status, ...additionalData, userId }
    );

    logger.info('Document status updated successfully:', documentId);
    return response.data?.document || response.data;
  } catch (error) {
    logger.error('Error updating document status:', error);

    let errorMessage = 'Failed to update document status';
    if (error.response) {
      const { status: httpStatus, statusText, data } = error.response;
      errorMessage = data?.error || `${httpStatus} – ${statusText}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    throw new Error(errorMessage);
  }
};

/**
 * Remove a document from a conversation
 * @param {string} memoryId - Memory ID for the conversation
 * @param {string} documentId - Document ID to remove
 * @param {string} userId - User ID (Firebase Auth UID)
 * @returns {Promise<boolean>} True if removal was successful
 */
export const removeDocumentFromConversation = async (memoryId, documentId, userId) => {
  logger.info('Removing document from conversation:', { memoryId, documentId, userId });

  if (!memoryId) {
    throw new Error('Memory ID is required');
  }

  if (!documentId) {
    throw new Error('Document ID is required');
  }

  if (!userId) {
    throw new Error('User ID is required');
  }

  try {
    const response = await researchAPI.delete(
      `/policy_research/conversations/${memoryId}/documents/${documentId}?userId=${userId}`
    );

    logger.info('Document removed successfully:', documentId);
    return response.data?.success || true;
  } catch (error) {
    logger.error('Error removing document from conversation:', error);

    let errorMessage = 'Failed to remove document';
    if (error.response) {
      const { status, statusText, data } = error.response;
      errorMessage = data?.error || `${status} – ${statusText}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    throw new Error(errorMessage);
  }
};

/**
 * Get all documents for a conversation
 * @param {string} memoryId - Memory ID for the conversation
 * @returns {Promise<Array>} Array of document metadata objects
 */
export const getConversationDocuments = async (memoryId) => {
  logger.info('Getting conversation documents:', memoryId);

  if (!memoryId) {
    throw new Error('Memory ID is required');
  }

  try {
    const response = await researchAPI.get(
      `/policy_research/conversations/${memoryId}/documents`
    );

    logger.info('Retrieved documents for conversation:', memoryId, 'count:', response.data?.documents?.length || 0);
    return response.data?.documents || [];
  } catch (error) {
    logger.error('Error getting conversation documents:', error);

    // Return empty array on 404 (conversation not found or no documents)
    if (error.response && error.response.status === 404) {
      return [];
    }

    let errorMessage = 'Failed to get conversation documents';
    if (error.response) {
      const { status, statusText, data } = error.response;
      errorMessage = data?.error || `${status} – ${statusText}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    throw new Error(errorMessage);
  }
};

/**
 * Establish WebSocket connection
 * @returns {Promise<string>} Promise that resolves with client ID
 */
export const establishWebSocket = () => {
  const wsManager = getWebSocketManager();
  return wsManager.establishWebSocket();
};

/**
 * Add message handler for WebSocket messages
 * @param {string} messageType - Type of message to handle
 * @param {Function} handler - Handler function
 */
export const onMessage = (messageType, handler) => {
  const wsManager = getWebSocketManager();
  wsManager.onMessage(messageType, handler);
};

/**
 * Remove message handler
 * @param {string} messageType - Type of message
 * @param {Function} handler - Handler function to remove
 */
export const offMessage = (messageType, handler) => {
  const wsManager = getWebSocketManager();
  wsManager.offMessage(messageType, handler);
};

/**
 * Add connection status handler
 * @param {Function} handler - Handler function
 */
export const onConnection = (handler) => {
  const wsManager = getWebSocketManager();
  wsManager.onConnection(handler);
};

/**
 * Remove connection status handler
 * @param {Function} handler - Handler function to remove
 */
export const offConnection = (handler) => {
  const wsManager = getWebSocketManager();
  wsManager.offConnection(handler);
};

/**
 * Add error handler
 * @param {Function} handler - Handler function
 */
export const onError = (handler) => {
  const wsManager = getWebSocketManager();
  wsManager.onError(handler);
};

/**
 * Remove error handler
 * @param {Function} handler - Handler function to remove
 */
export const offError = (handler) => {
  const wsManager = getWebSocketManager();
  wsManager.offError(handler);
};

/**
 * Add spinner state change handler
 * @param {Function} handler - Handler function that receives spinner state
 */
export const onSpinnerChange = (handler) => {
  const wsManager = getWebSocketManager();
  wsManager.onSpinnerChange(handler);
};

/**
 * Remove spinner state change handler
 * @param {Function} handler - Handler function to remove
 */
export const offSpinnerChange = (handler) => {
  const wsManager = getWebSocketManager();
  wsManager.offSpinnerChange(handler);
};

/**
 * Get current spinner state
 * @returns {boolean} Current spinner state
 */
export const getSpinnerState = () => {
  const wsManager = getWebSocketManager();
  return wsManager.getSpinnerActive();
};

/**
 * Manually set spinner state (useful for external control)
 * @param {boolean} active - Whether spinner should be active
 */
export const setSpinnerState = (active) => {
  const wsManager = getWebSocketManager();
  wsManager.setSpinnerActive(active);
};

/**
 * Send message through WebSocket
 * @param {Object} message - Message to send
 * @returns {Promise<void>}
 */
export const sendMessage = (message) => {
  const wsManager = getWebSocketManager();
  return wsManager.sendMessage(message);
};

/**
 * Close WebSocket connection
 */
export const closeConnection = () => {
  if (wsManager) {
    wsManager.close();
    wsManager = null;
  }
};

/**
 * Get WebSocket connection status
 * @returns {Object} Connection status
 */
export const getConnectionStatus = () => {
  const wsManager = getWebSocketManager();
  return wsManager.getStatus();
};

// Default export with all methods
export default {
  conversation,
  getChatLog,
  getUserConversations,
  deleteConversation,
  extractFile,
  getExtractionResult,
  // Document management
  addDocumentToConversation,
  updateDocumentStatus,
  removeDocumentFromConversation,
  getConversationDocuments,
  // WebSocket
  establishWebSocket,
  onMessage,
  offMessage,
  onConnection,
  offConnection,
  onError,
  offError,
  onSpinnerChange,
  offSpinnerChange,
  getSpinnerState,
  setSpinnerState,
  sendMessage,
  closeConnection,
  getConnectionStatus,
};