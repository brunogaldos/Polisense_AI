import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { useDispatch } from 'react-redux';

// services
import * as researchAPI from 'services/research-api';
import {
  getUserConversations as fetchUserConversations,
  getChatLog,
  addDocumentToConversation,
  updateDocumentStatus,
  getConversationDocuments,
  ingestGeoJson,
  ingestJson,
  ingestPdf,
  downloadDocument,
} from 'services/research-api';
import { fetchDatasets } from 'services/dataset';
// utils
import { logger } from 'utils/logs';
import MessageRenderer from 'components/ui/MessageRenderer';
import {
  saveConversation,
  loadConversation,
  clearConversation,
  isStorageAvailable,
  saveMapSnapshots,
  loadMapSnapshotsForConversation,
  insertSnapshotsByPosition,
} from 'utils/conversationStorage';
import { useDashboard } from 'contexts/DashboardContext';
import { useAuth } from 'contexts/AuthContext';
import { uploadMapSnapshot } from 'services/mapSnapshotService';
// Dashboard generation moved to header dropdown

// actions
import {
  toggleMapLayerGroup,
  resetMapLayerGroupsInteraction,
  addGeojsonLayer,
  removeGeojsonLayer,
  setBounds,
} from 'layout/explore/actions';

import Spinner from 'components/ui/Spinner';

// Palette for uploaded GeoJSON layers — first upload is always green, rest are randomised
/** Binary fragments / DB internals that are never useful as chatbot input. */
const UNSUPPORTED_BINARY_EXTENSIONS = ['.atx', '.gdbtable', '.lock', '.sqlite', '.bin', '.tif', '.tiff', '.zip'];

/** Human-readable summary of accepted file types — shown in the drop overlay.
 *  The backend permissively allows everything OpenAI's Responses API supports
 *  (docs, code, slides, sheets, images, structured data); this label shows the
 *  most common categories rather than every individual extension. */
const ACCEPTED_FILE_TYPES_LABEL =
  'PDF · DOC · DOCX · ODT · RTF · TXT · MD · HTML · XML · CSV · TSV · XLS · XLSX · PPT · PPTX · JSON · YAML · SVG · PNG · JPG · GIF · WEBP · GeoJSON · code files';

/**
 * Build a uniform "Indexing …" status line for the in-chat tool-row renderer.
 * The renderer already prefixes a ⚡ icon and trailing spinner, so the message
 * text itself must NOT include any leading emoji / status glyph.
 *
 * - `label`   : noun for the source (e.g. `"X"`, `GeoJSON layer "X"`)
 * - `detail`  : optional parenthetical count (e.g. `12 features`)
 */
function indexingMessage(label, detail) {
  return `Indexing ${label} into knowledge base${detail ? ` (${detail})` : ''}…`;
}

/** Uniform "Could not index …" error line. Error messageType already gets the
 *  red-accent bubble treatment — no glyph prefix needed (or allowed; see
 *  CHATBOT_UI_STYLE.md). */
function indexingErrorMessage(name, reason) {
  return reason
    ? `Could not index "${name}": ${reason}`
    : `Could not index "${name}".`;
}

/** Pull the server-supplied error reason out of an axios error. Falls back to
 *  the axios `message` ("Request failed with status code 400") only when the
 *  backend didn't send a JSON body — those generic strings tell the user
 *  nothing about WHY the upload was rejected. */
function extractIngestionErrorReason(err) {
  const serverMsg =
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    (typeof err?.response?.data === 'string' ? err.response.data : null);
  return serverMsg || err?.message || null;
}

/** Pluralise a unit based on count (1 feature, 2 features). */
function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural || `${singular}s`}`;
}

/**
 * Split an array of File objects into accepted vs rejected based on
 * UNSUPPORTED_BINARY_EXTENSIONS. Returns rejected with a reason string.
 */
function partitionFilesByType(files) {
  const accepted = [];
  const rejected = [];
  for (const f of files) {
    const lower = (f.name || '').toLowerCase();
    const blocked = UNSUPPORTED_BINARY_EXTENSIONS.find((ext) => lower.endsWith(ext));
    if (blocked) {
      rejected.push({ file: f, reason: `${blocked} files are not supported` });
    } else {
      accepted.push(f);
    }
  }
  return { accepted, rejected };
}

const GEOJSON_LAYER_PALETTE = [
  { fill: '#27ae60', line: '#1e8449' }, // green  (index 0 — always first)
  { fill: '#e67e22', line: '#ca6f1e' }, // orange
  { fill: '#8e44ad', line: '#6c3483' }, // purple
  { fill: '#16a085', line: '#0e6655' }, // teal
  { fill: '#c0392b', line: '#922b21' }, // red
  { fill: '#f39c12', line: '#b7770d' }, // amber
  { fill: '#2980b9', line: '#1a5276' }, // blue
  { fill: '#d35400', line: '#a04000' }, // burnt orange
  { fill: '#1abc9c', line: '#148f77' }, // mint
  { fill: '#e91e63', line: '#ad1457' }, // pink
];

/** Spinner — ─ rotated via JS interval so styled-jsx scoping never breaks it */
function SpinnerChar({ color } = {}) {
  const [angle, setAngle] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setAngle(a => (a + 45) % 360), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="rcc-spinner-char"
      style={{
        display: 'inline-block',
        transform: `rotate(${angle}deg)`,
        ...(color ? { color } : {}),
      }}
    >
      ─
    </span>
  );
}

/**
 * Research Chatbot Component
 * Adapted from WebApp LiveResearchChatBot for Resource Watch
 * Provides a chat interface for live web research functionality
 */
const ResearchChatbot = ({
  isOpen,
  onClose,
  numberOfSelectQueries = 7,
  percentOfTopQueriesToSearch = 0.25,
  percentOfTopResultsToScan = 0.25,
  className = '',
  onAssistantMessage, // Callback for when assistant message is received
  onFirstResponse, // Callback for when first assistant response is received
}) => {
  // Simple local state for messages with localStorage persistence
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [hasReceivedFirstResponse, setHasReceivedFirstResponse] = useState(false);
  const [memoryId, setMemoryId] = useState(() => {
    // Only access localStorage in browser (not during SSR)
    // Don't load memoryId on initial render - wait for user to be loaded
    return null;
  });
  const [isStorageEnabled, setIsStorageEnabled] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [wsClientId, setWsClientId] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [spinnerActive, setSpinnerActive] = useState(false); // Track spinner state for intermediate messages
  const [spinnerVerb, setSpinnerVerb] = useState(null);

  // Conversation history state
  const [conversationHistory, setConversationHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showHistorySidebar, setShowHistorySidebar] = useState(false);

  // eslint-disable-next-line no-unused-vars
  const [viewingMetadata, setViewingMetadata] = useState(null); // kept for internal handler refs, not rendered

  // Dataset-related state
  const [activeDatasets, setActiveDatasets] = useState([]);
  const [datasetContext, setDatasetContext] = useState([]);
  const [showDatasetDropdown, setShowDatasetDropdown] = useState(false);
  const [filteredDatasets, setFilteredDatasets] = useState([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [allDatasets, setAllDatasets] = useState([]);
  const [selectedDatasetIndex, setSelectedDatasetIndex] = useState(0);

  // Fixed server-side datasets available through the @ mention system
  const CATASTRO_DATASET = {
    id: '__catastro__',
    _isCatastro: true,
    slug: 'catastro-minero',
    name: 'Catastro Minero (GEOCATMIN)',
    metadata: {
      info: {
        name: 'Catastro Minero (GEOCATMIN)',
        description: 'INGEMMET mining concessions database for Peru',
      },
    },
    layer: [],
  };
  const [selectedDatasets, setSelectedDatasets] = useState([]);

  // Panel tab state
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'documents'
  const [downloadError, setDownloadError] = useState({}); // { [fileId]: errorMessage }
  const [downloadingId, setDownloadingId] = useState(null); // file currently being downloaded
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Document upload state
  const [uploadedFiles, setUploadedFiles] = useState([]); // All uploaded files (persisted, shown in header Documents dropdown)
  const [pendingFiles, setPendingFiles] = useState([]); // Files waiting to be sent (shown as tokens in input)

  // isRagInProgress: true whenever ANY ingestion message is still in flight.
  // Derived from messages (not a global boolean) so concurrent uploads track
  // independently — uploading a second file while the first is still indexing
  // keeps the lock on until BOTH complete, and finishing the first doesn't
  // accidentally unlock the input or re-render the first bubble when the
  // second starts. See CHATBOT_UI_STYLE.md "Lock state".
  const isRagInProgress = messages.some(
    (m) =>
      m.sender === 'system' &&
      (m.messageType === 'pdf_rag' ||
        m.messageType === 'geojson_rag' ||
        m.messageType === 'json_rag'),
  );

  // Dashboard creation state (moved to context)
  const [lastAssistantMessage, setLastAssistantMessage] = useState(null);

  // Track delete/backspace presses to require multiple taps before removing tokens
  const lastKeyRef = useRef(null);
  const tokenDeleteCountsRef = useRef({});

  // Stable ref so WS callback can read latest messages without being recreated each update
  const messagesRef = useRef([]);
  // Stable ref so removeDataset doesn't recreate on every keystroke
  const inputMessageRef = useRef('');

  // Track if we've attempted to load conversations to prevent infinite loops
  const conversationsLoadAttemptedRef = useRef(false);

  // Redux
  const dispatch = useDispatch();

  // Dashboard context
  const {
    setAssistantMessage,
    setConversation,
    setMemoryId: setMemoryIdInContext,
    setUploadedDocuments,
  } = useDashboard();

  // Sync uploaded files to DashboardContext so the header Documents dropdown can read them
  useEffect(() => {
    setUploadedDocuments(uploadedFiles.filter((f) => !f.isMetadata));
  }, [uploadedFiles, setUploadedDocuments]);

  // Keep messagesRef current so the WS callback can read the latest messages without
  // being listed as a dep (which would recreate the callback on every streaming chunk).
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keep inputMessageRef current so removeDataset doesn't re-create on every keystroke.
  useEffect(() => {
    inputMessageRef.current = inputMessage;
  }, [inputMessage]);

  // Single sync point: push messages to DashboardContext and localStorage.
  // Doing this here (instead of inside setMessages updaters) prevents setState-inside-setState
  // cascades that were causing 100+ re-renders per streaming chunk.
  useEffect(() => {
    if (messages.length > 0) {
      setConversation(messages);
      saveConversationToStorage(messages);
    }
    // setConversation is a stable context setter; saveConversationToStorage is a useCallback
    // whose identity only changes on login/logout — intentionally excluded from deps here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Pick a random spinner verb each time loading begins; clear it when done
  useEffect(() => {
    if (isLoading) {
      setSpinnerVerb(SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)]);
    } else {
      setSpinnerVerb(null);
    }
    // SPINNER_VERBS is a stable constant defined in render scope — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Firebase Auth context
  const { currentUser, loading: authLoading } = useAuth();

  // Track previous user ID to detect user switches
  const previousUserIdRef = useRef(null);

  // File input ref
  const fileInputRef = useRef(null);

  // Helper function to get user-specific localStorage keys
  const getUserStorageKey = useCallback(
    (key) => {
      const userId = currentUser?.uid;
      return userId ? `${key}-${userId}` : key;
    },
    [currentUser],
  );

  // Helper function to clear all user-specific localStorage keys
  const clearUserStorage = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        const userId = previousUserIdRef.current;
        if (userId) {
          // Clear user-specific keys
          localStorage.removeItem(`research-chatbot-memory-id-${userId}`);
          localStorage.removeItem(`research-chatbot-conversation-${userId}`);
        }
        // Also clear non-user-specific keys (for backward compatibility)
        localStorage.removeItem('research-chatbot-memory-id');
        if (isStorageEnabled) {
          clearConversation();
        }
      } catch (error) {
        console.warn('Error clearing localStorage:', error);
      }
    }
  }, [isStorageEnabled]);

  // Function to load all conversations for the user (for history sidebar)
  const loadAllConversations = useCallback(
    async (userId) => {
      if (!userId) {
        console.warn('⚠️ loadAllConversations called without userId');
        return;
      }

      try {
        setIsLoadingHistory(true);
        console.log('📚 Loading all conversations for user:', userId);

        const conversations = await fetchUserConversations(userId);
        console.log('📋 Received conversations:', conversations);
        console.log(
          '📋 Conversations array:',
          Array.isArray(conversations) ? conversations.length : 'not an array',
        );

        if (!Array.isArray(conversations)) {
          console.error('❌ Conversations is not an array:', typeof conversations, conversations);
          setConversationHistory([]);
          conversationsLoadAttemptedRef.current = true; // Mark as attempted
          setIsLoadingHistory(false);
          return;
        }

        // Sort by updatedAt descending (most recent first)
        const sortedConversations = conversations.sort((a, b) => {
          const dateA =
            a.updatedAt instanceof Date
              ? a.updatedAt
              : a.updatedAt
              ? new Date(a.updatedAt)
              : new Date(0);
          const dateB =
            b.updatedAt instanceof Date
              ? b.updatedAt
              : b.updatedAt
              ? new Date(b.updatedAt)
              : new Date(0);
          return dateB.getTime() - dateA.getTime();
        });

        console.log('✅ Sorted conversations:', sortedConversations.length);
        setConversationHistory(sortedConversations);
        conversationsLoadAttemptedRef.current = true; // Mark as attempted, even if empty
      } catch (error) {
        console.error('❌ Error loading conversation history:', error);
        console.error('Error details:', error.message, error.stack);
        setConversationHistory([]);
        conversationsLoadAttemptedRef.current = true; // Mark as attempted even on error
      } finally {
        setIsLoadingHistory(false);
      }
    },
    [fetchUserConversations],
  );

  // Function to load a specific conversation from history
  const loadConversationFromHistory = useCallback(
    async (memoryId) => {
      if (!memoryId) return;

      try {
        console.log('📥 Loading conversation:', memoryId);

        const chatLogData = await getChatLog(memoryId);

        if (chatLogData && chatLogData.chatLog && chatLogData.chatLog.length > 0) {
          // Convert chatLog to messages format, preserving original formatting
          const restoredMessages = chatLogData.chatLog.map((msg, index) => {
            // PolicySynth saves assistant messages with sender:'bot' — normalize to 'assistant'
            // so the user/assistant bubble styling is correct.
            let sender = msg.sender === 'bot' ? 'assistant' : msg.sender;
            const messageText = (msg.message || '').trim();

            // First, check if it's clearly an assistant message by content
            // Assistant messages typically have markdown formatting and are longer
            const hasMarkdown =
              messageText.includes('**') ||
              (messageText.includes('*') && messageText.split('*').length > 2) ||
              messageText.includes('###') ||
              messageText.includes('##') ||
              messageText.includes('# ') ||
              (messageText.includes('- ') && messageText.split('- ').length > 2) ||
              messageText.includes('1. ') ||
              messageText.includes('2. ') ||
              (messageText.includes('[') && messageText.includes(']('));

            const isLongMessage = messageText.length > 100;
            const looksLikeAssistant =
              hasMarkdown ||
              (isLongMessage &&
                !messageText.startsWith('?') &&
                !messageText.toLowerCase().startsWith('what') &&
                !messageText.toLowerCase().startsWith('how'));

            if (!sender || (sender !== 'user' && sender !== 'assistant' && sender !== 'system')) {
              // If sender is invalid/missing, try to infer from messageType
              if (
                msg.messageType === 'research_result' ||
                msg.messageType === 'intermediate' ||
                msg.messageType === 'completed'
              ) {
                sender = 'assistant';
              } else if (msg.messageType === 'user_query') {
                sender = 'user';
              } else if (looksLikeAssistant) {
                // If it looks like an assistant message (has markdown or is a long informative message), assume assistant
                sender = 'assistant';
              } else {
                // Last resort: default to 'user' only if truly unknown
                sender = 'user';
              }
            } else if (sender === 'user' && looksLikeAssistant) {
              // Override if sender is 'user' but content clearly indicates it's an assistant message
              // This handles cases where sender was incorrectly saved as 'user'
              console.warn(
                `⚠️ Message with sender='user' but content suggests assistant. Overriding to 'assistant'.`,
                {
                  messagePreview: messageText.substring(0, 100),
                  hasMarkdown,
                  isLongMessage,
                },
              );
              sender = 'assistant';
            }

            // Preserve messageType exactly as stored - no defaults to maintain formatting
            const messageType = msg.messageType; // Keep undefined if not set, don't default to 'text'

            // Handle timestamp conversion - could be Date, string, or Firestore Timestamp
            let timestamp;
            if (msg.timestamp) {
              if (msg.timestamp instanceof Date) {
                timestamp = msg.timestamp;
              } else if (typeof msg.timestamp === 'string') {
                timestamp = new Date(msg.timestamp);
              } else if (msg.timestamp.toDate && typeof msg.timestamp.toDate === 'function') {
                // Firestore Timestamp object
                timestamp = msg.timestamp.toDate();
              } else if (msg.timestamp.seconds) {
                // Firestore Timestamp in serialized form
                timestamp = new Date(msg.timestamp.seconds * 1000);
              } else {
                timestamp = new Date(msg.timestamp);
              }
            } else {
              timestamp = new Date();
            }

            return {
              id: msg.id || `restored_${memoryId}_${index}_${Date.now()}`,
              sender: sender, // Preserve exactly as stored or inferred
              message: msg.message || '',
              messageType: messageType, // Preserve exactly as stored (may be undefined)
              timestamp: timestamp,
              isStreaming: false,
            };
          });

          // Debug: Log restored messages to check sender values
          console.log(
            '📥 Restored messages:',
            restoredMessages.map((msg) => ({
              id: msg.id,
              sender: msg.sender,
              messageType: msg.messageType,
              messagePreview: msg.message?.substring(0, 100),
            })),
          );

          // Merge map_snapshot messages for this specific conversation.
          // Snapshots are never written to Firestore — they live in a dedicated
          // per-memoryId localStorage key so there is no cross-conversation bleed.
          const localSnapshots = loadMapSnapshotsForConversation(memoryId);
          const merged = insertSnapshotsByPosition(restoredMessages, localSnapshots);

          // Restore messages and memoryId
          setMessages(merged);
          setMemoryId(memoryId);

          // Clear previous document state before loading new conversation's documents
          setUploadedFiles([]);
          setPendingFiles([]);
          setViewingMetadata(null);

          // Fetch documents from Firestore using the new document management API
          try {
            const firestoreDocuments = await getConversationDocuments(memoryId);
            console.log('📄 Fetched documents from Firestore:', {
              memoryId,
              count: firestoreDocuments?.length || 0,
            });

            if (firestoreDocuments && firestoreDocuments.length > 0) {
              // Convert Firestore documents to the local file format
              const restoredFiles = firestoreDocuments.map((doc) => {
                // Parse uploadTime - handle Date, Firestore Timestamp, ISO string, or object with seconds
                let uploadTime = new Date();
                if (doc.uploadTime) {
                  if (doc.uploadTime instanceof Date) {
                    uploadTime = doc.uploadTime;
                  } else if (typeof doc.uploadTime === 'string') {
                    uploadTime = new Date(doc.uploadTime);
                  } else if (doc.uploadTime.toDate && typeof doc.uploadTime.toDate === 'function') {
                    uploadTime = doc.uploadTime.toDate();
                  } else if (doc.uploadTime.seconds) {
                    // Firestore Timestamp serialized format { seconds, nanoseconds }
                    uploadTime = new Date(doc.uploadTime.seconds * 1000);
                  } else if (doc.uploadTime._seconds) {
                    // Alternative Firestore format
                    uploadTime = new Date(doc.uploadTime._seconds * 1000);
                  }
                }

                return {
                  id: doc.id,
                  name: doc.name,
                  size: doc.size || 0,
                  type: doc.type || 'application/octet-stream',
                  uploadTime,
                  extractionStatus: doc.extractionStatus,
                  markdownFileName: doc.markdownFileName,
                  extractedMetadata: doc.extractedMetadata,
                  extractionError: doc.extractionError,
                  s3Bucket: doc.s3Bucket,
                  s3Key: doc.s3Key,
                };
              });

              console.log(
                '📄 Restored files structure:',
                restoredFiles.map((f) => ({
                  id: f.id,
                  name: f.name,
                  uploadTime: f.uploadTime,
                  uploadTimeType: typeof f.uploadTime,
                  isValidDate: f.uploadTime instanceof Date && !isNaN(f.uploadTime),
                  extractionStatus: f.extractionStatus,
                  hasExtractedMetadata: !!f.extractedMetadata,
                })),
              );

              setUploadedFiles(restoredFiles);
              setPendingFiles([]);
              console.log('✅ Restored documents from Firestore:', {
                memoryId,
                count: restoredFiles.length,
                names: restoredFiles.map((f) => f.name),
              });
            } else {
              // No documents in Firestore, clear local state
              console.log('📭 No documents found in Firestore for conversation:', memoryId);
              setUploadedFiles([]);
              setPendingFiles([]);
            }
          } catch (docError) {
            console.warn(
              'Failed to fetch documents from Firestore, falling back to chatLogData:',
              docError,
            );

            // Fallback: try to restore from chatLogData.uploadedDocuments (legacy)
            if (
              chatLogData &&
              chatLogData.uploadedDocuments &&
              Array.isArray(chatLogData.uploadedDocuments) &&
              chatLogData.uploadedDocuments.length > 0
            ) {
              const nonMetadataFiles = chatLogData.uploadedDocuments.filter(
                (doc) => !doc.isMetadata,
              );
              const metadataFiles = chatLogData.uploadedDocuments.filter((doc) => doc.isMetadata);

              const nameToIdMap = new Map();
              const restoredFiles = [];

              nonMetadataFiles.forEach((doc, index) => {
                const fileId = `restored_${memoryId}_${index}_${Date.now()}`;
                const fileName = doc.name || doc.file?.name || '';
                nameToIdMap.set(fileName, fileId);

                restoredFiles.push({
                  id: fileId,
                  name: fileName,
                  size: doc.size || doc.file?.size || 0,
                  type: doc.type || doc.file?.type || 'application/octet-stream',
                  uploadTime: doc.uploadTime
                    ? doc.uploadTime instanceof Date
                      ? doc.uploadTime
                      : doc.uploadTime.toDate
                      ? doc.uploadTime.toDate()
                      : new Date(doc.uploadTime)
                    : new Date(),
                  isMetadata: false,
                  metadata: doc.metadata || undefined,
                });
              });

              metadataFiles.forEach((doc, index) => {
                const metadataFileName = doc.name || doc.file?.name || '';
                const parentFileName = metadataFileName.replace('_metadata.json', '');
                const parentFileId = nameToIdMap.get(parentFileName);

                if (parentFileId) {
                  const metadataFileId = `restored_metadata_${memoryId}_${index}_${Date.now()}`;
                  restoredFiles.push({
                    id: metadataFileId,
                    name: metadataFileName,
                    size: doc.size || doc.file?.size || 0,
                    type: doc.type || doc.file?.type || 'application/json',
                    uploadTime: doc.uploadTime
                      ? doc.uploadTime instanceof Date
                        ? doc.uploadTime
                        : doc.uploadTime.toDate
                        ? doc.uploadTime.toDate()
                        : new Date(doc.uploadTime)
                      : new Date(),
                    isMetadata: true,
                    parentFileId: parentFileId,
                    metadata: doc.metadata || undefined,
                  });
                }
              });

              setUploadedFiles(restoredFiles);
              setPendingFiles([]);
              console.log('✅ Restored documents from legacy chatLogData:', {
                memoryId,
                count: restoredFiles.length,
              });
            } else {
              setUploadedFiles([]);
              setPendingFiles([]);
            }
          }

          // Save to user-specific localStorage
          if (typeof window !== 'undefined' && currentUser?.uid) {
            try {
              const storageKey = getUserStorageKey('research-chatbot-memory-id');
              localStorage.setItem(storageKey, memoryId);
            } catch (error) {
              console.warn('Error saving memoryId to localStorage:', error);
            }
          }

          // Update dashboard context
          setConversation(merged);

          // Close sidebar when conversation is loaded
          setShowHistorySidebar(false);

          console.log('✅ Conversation loaded:', {
            messageCount: merged.length,
            snapshotsRestored: localSnapshots.length,
            memoryId,
            documentCount: chatLogData.uploadedDocuments?.length || 0,
          });
        }
      } catch (error) {
        console.error('❌ Error loading conversation:', error);
      }
    },
    [getUserStorageKey, setConversation, currentUser, getChatLog],
  );

  // Function to remove a dataset from selection - Enhanced to integrate with dataset widget functionality
  const removeDataset = useCallback(
    async (selectedItem) => {
      const datasetToRemove = selectedItem.dataset;

      setSelectedDatasets((prev) => prev.filter((item) => item.dataset.id !== datasetToRemove.id));

      // Also remove from active datasets
      setActiveDatasets((prev) => prev.filter((dataset) => dataset.id !== datasetToRemove.id));

      // Also remove from input message
      const shortName = selectedItem.shortName;
      const newValue = inputMessageRef.current.replace(new RegExp(`@${shortName}\\s*`, 'g'), '');
      setInputMessage(newValue);

      // Deactivate the map for this dataset using the same functionality as the dataset widget
      try {
        if (datasetToRemove._isCatastro) {
          dispatch(removeGeojsonLayer('catastro-minero'));
        } else if (datasetToRemove.layer && datasetToRemove.layer.length > 0) {
          // Use the same actions as the explore datasets widget
          dispatch(toggleMapLayerGroup({ dataset: datasetToRemove, toggle: false }));
          dispatch(resetMapLayerGroupsInteraction());

          // Remove the layer from active layers (same as DatasetListItem component)
          const defaultLayer =
            datasetToRemove.layer.find((l) => l.default) || datasetToRemove.layer[0];
          if (defaultLayer) {
            // Import the action dynamically to avoid circular dependencies
            const { setMapLayerGroupActive } = await import('layout/explore/actions');
            dispatch(setMapLayerGroupActive({ dataset: { id: datasetToRemove.id }, active: null }));
          }

          logger.info('Map deactivated for dataset:', getDatasetDisplayName(datasetToRemove));
        }
      } catch (error) {
        console.error('Error deactivating dataset on map:', error);
        // Continue with removal even if map deactivation fails
      }
    },
    [dispatch],
  );

  // Function to remove an uploaded file
  const removeUploadedFile = useCallback(
    (fileToRemove) => {
      // Remove from both pending and uploaded
      setPendingFiles((prev) => prev.filter((file) => file.id !== fileToRemove.id));
      setUploadedFiles((prev) => {
        const filtered = prev.filter((file) => file.id !== fileToRemove.id);
        // If removing a parent file, also remove its metadata file
        if (!fileToRemove.isMetadata) {
          return filtered.filter(
            (file) => !(file.isMetadata && file.parentFileId === fileToRemove.id),
          );
        }
        return filtered;
      });

      // If it was a GeoJSON layer, remove it from the map too
      if (fileToRemove.name?.toLowerCase().endsWith('.geojson')) {
        dispatch(removeGeojsonLayer(`geojson-upload-${fileToRemove.id}`));
      }

      logger.info('Removed uploaded file:', fileToRemove.name);
    },
    [dispatch],
  );

  // Handle PDF/image upload — send directly to OpenAI vector store via backend
  const handlePDFUpload = useCallback(
    (file) => {
      const actualFile = file.file || file;
      if (!(actualFile instanceof File)) {
        console.warn('handlePDFUpload: not a File object', file);
        return;
      }

      // Show indexing spinner immediately. `documentName` is the join key the
      // completion / failure WS handlers use to find THIS message — without it,
      // concurrent uploads would clobber each other's bubbles.
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          sender: 'system',
          message: indexingMessage(`"${actualFile.name}"`),
          messageType: 'pdf_rag',
          documentName: actualFile.name,
          timestamp: new Date(),
        },
      ]);
      setSpinnerActive(true);

      // Ensure memoryId exists
      let activeMemoryId = memoryId;
      if (!activeMemoryId && currentUser?.uid) {
        activeMemoryId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        setMemoryId(activeMemoryId);
        try {
          localStorage.setItem(`research-chatbot-memory-id-${currentUser.uid}`, activeMemoryId);
        } catch (_) {}
      }

      const formData = new FormData();
      formData.append('file', actualFile);
      if (activeMemoryId) formData.append('memoryId', activeMemoryId);
      if (currentUser?.uid) formData.append('userId', currentUser.uid);

      ingestPdf(formData).catch((err) => {
        const isNetworkOrTimeout =
          err?.code === 'ECONNABORTED' ||
          err?.message?.includes('timeout') ||
          err?.message === 'Network Error' ||
          err?.name === 'NetworkError';
        if (isNetworkOrTimeout) {
          // Backend is still running — keep the spinner, wait for ragIngestionCompleted WS event
          console.warn('PDF ingestion request timed out/network error (backend may still be running):', err);
          return;
        }
        console.warn('PDF ingestion request failed:', err);
        setMessages((prev) => {
          const updated = [...prev];
          // Match this file's own pdf_rag bubble (not just "last pdf_rag")
          // so concurrent uploads can't clobber each other.
          const idx = updated.findIndex(
            (m) =>
              m.sender === 'system' &&
              m.messageType === 'pdf_rag' &&
              m.documentName === actualFile.name,
          );
          if (idx < 0) return prev;
          updated[idx] = {
            ...updated[idx],
            message: indexingErrorMessage(actualFile.name, extractIngestionErrorReason(err)),
            messageType: 'error',
          };
          return updated;
        });
        setSpinnerActive(false);
      });
    },
    [memoryId, currentUser, setSpinnerActive],
  );

  // Compute a simple bounding box from a GeoJSON FeatureCollection
  const computeGeojsonBbox = (geojson) => {
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    const visit = (coords) => {
      if (typeof coords[0] === 'number') {
        if (coords[0] < minLng) minLng = coords[0];
        if (coords[0] > maxLng) maxLng = coords[0];
        if (coords[1] < minLat) minLat = coords[1];
        if (coords[1] > maxLat) maxLat = coords[1];
      } else {
        coords.forEach(visit);
      }
    };
    (geojson.features || []).forEach((f) => {
      if (f.geometry?.coordinates) visit(f.geometry.coordinates);
    });
    return [minLng, minLat, maxLng, maxLat];
  };

  // Handle GeoJSON file — add directly to the map, skip RAG entirely
  const handleGeoJSONUpload = useCallback(
    (file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const geojson = JSON.parse(e.target.result);
          const layerId = `geojson-upload-${file.id}`;

          // Pick color: index 0 → always green; subsequent → random from remaining palette entries
          const colorIdx = geojsonColorIndexRef.current;
          let layerColor;
          if (colorIdx === 0) {
            layerColor = GEOJSON_LAYER_PALETTE[0];
          } else {
            const remaining = GEOJSON_LAYER_PALETTE.slice(1);
            layerColor = remaining[Math.floor(Math.random() * remaining.length)];
          }
          geojsonColorIndexRef.current += 1;

          const layerSpec = {
            id: layerId,
            isGeojsonUpload: true,
            name: file.name,
            layerConfig: {
              type: 'geojson',
              source: { type: 'geojson', data: geojson },
              render: {
                layers: [
                  {
                    type: 'fill',
                    source: layerId,
                    paint: { 'fill-color': layerColor.fill, 'fill-opacity': 0.4 },
                  },
                  {
                    type: 'line',
                    source: layerId,
                    paint: { 'line-color': layerColor.line, 'line-width': 1 },
                  },
                ],
              },
            },
          };

          dispatch(addGeojsonLayer(layerSpec));

          // Fly to the layer's bounding box
          const [minLng, minLat, maxLng, maxLat] = computeGeojsonBbox(geojson);
          if (isFinite(minLng)) {
            dispatch(
              setBounds({ bbox: [minLng, minLat, maxLng, maxLat], options: { padding: 40 } }),
            );
          }

          // Show token in the chat input panel and Documents tab
          setPendingFiles((prev) => [...prev, file]);
          setUploadedFiles((prev) => [...prev, file]);

          // Register the frontend-generated id in Firestore BEFORE backend
          // ingestion runs — otherwise the backend's `addOrUpdateDocument`
          // creates the document with its own id, and downloads from the
          // Documents tab fail because `file.id` won't match.
          if (memoryId && currentUser?.uid) {
            addDocumentToConversation(
              memoryId,
              {
                id: file.id,
                name: file.name,
                size: file.size,
                type: file.type || 'application/geo+json',
                uploadTime: file.uploadTime,
                extractionStatus: 'pending',
              },
              currentUser.uid,
            ).catch((err) => console.warn('Firestore GeoJSON pre-register failed:', err));
          }

          // Use messageType 'geojson' (NOT 'intermediate') so that RAG extraction
          // handlers — which search for messageType === 'intermediate' — never find
          // and overwrite this message when a subsequent PDF is uploaded.
          setMessages((prev) => [
            ...prev,
            {
              sender: 'system',
              message: `GeoJSON layer "${file.name}" added to the map.`,
              messageType: 'geojson',
              timestamp: new Date(),
            },
          ]);

          // Show RAG progress message immediately (before API responds), like PDFs do
          const featureCount = geojson.features?.length || 0;
          setMessages((prev) => [
            ...prev,
            {
              sender: 'system',
              message: indexingMessage(
                `GeoJSON layer "${file.name}"`,
                pluralize(featureCount, 'feature'),
              ),
              messageType: 'geojson_rag',
              documentName: file.name,
              timestamp: new Date(),
            },
          ]);
          setSpinnerActive(true);

          // Ensure memoryId exists before RAG ingestion so chunks are scoped to this conversation.
          // If no memoryId yet (user hasn't sent first message), generate one now and persist it —
          // the same value will be used when the first message is sent (see handleSendMessage).
          let activeMemoryId = memoryId;
          if (!activeMemoryId && currentUser?.uid) {
            activeMemoryId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            setMemoryId(activeMemoryId);
            try {
              const storageKey = `research-chatbot-memory-id-${currentUser.uid}`;
              localStorage.setItem(storageKey, activeMemoryId);
            } catch (_) {}
          }

          // Trigger RAG ingestion so GeoJSON features are queryable via the chatbot
          // Pass the already-parsed geojson + filename as JSON — avoids all FormData/multipart issues
          ingestGeoJson(
            geojson,
            file.name || (file.file && file.file.name),
            activeMemoryId,
            currentUser?.uid,
          ).catch((err) => {
            const isTimeout = err?.code === 'ECONNABORTED' || err?.message?.includes('timeout');
            if (isTimeout) {
              // Timeout means the upload took too long but the backend may have received the file
              // and started ingestion. Keep the "indexing" spinner — the WS event will update it.
              console.warn(
                'GeoJSON RAG ingestion request timed out (backend may still be running):',
                err,
              );
              return;
            }
            console.warn('GeoJSON RAG ingestion request failed:', err);
            // Only show error for non-timeout failures (e.g. network error, 4xx/5xx)
            setMessages((prev) => {
              const updated = [...prev];
              const idx = updated.findIndex(
                (m) =>
                  m.sender === 'system' &&
                  m.messageType === 'geojson_rag' &&
                  m.documentName === file.name,
              );
              if (idx < 0) return prev;
              updated[idx] = {
                ...updated[idx],
                message: indexingErrorMessage(file.name, extractIngestionErrorReason(err)),
                messageType: 'error',
              };
              return updated;
            });
            setSpinnerActive(false);
          });
        } catch {
          console.error('Failed to parse GeoJSON file:', file.name);
          setMessages((prev) => [
            ...prev,
            {
              sender: 'system',
              message: `❌ Could not parse "${file.name}" — please check it is valid GeoJSON.`,
              messageType: 'geojson',
              timestamp: new Date(),
            },
          ]);
        }
      };
      reader.readAsText(file.file || file);
    },
    [dispatch, setPendingFiles, setUploadedFiles, memoryId, currentUser, setSpinnerActive],
  );

  // Handle plain JSON upload — parse, send to RAG ingestion, show progress
  const handleJSONUpload = useCallback(
    (file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        let data;
        try {
          data = JSON.parse(e.target.result);
        } catch {
          console.error('Failed to parse JSON file:', file.name);
          setMessages((prev) => [
            ...prev,
            {
              sender: 'system',
              message: `❌ Could not parse "${file.name}" — please check it is valid JSON.`,
              messageType: 'error',
              timestamp: new Date(),
            },
          ]);
          return;
        }

        setPendingFiles((prev) => [...prev, file]);
        setUploadedFiles((prev) => [...prev, file]);

        // Register local id in Firestore before backend ingestion so the
        // Documents tab download lookup (by id) succeeds.
        if (memoryId && currentUser?.uid) {
          addDocumentToConversation(
            memoryId,
            {
              id: file.id,
              name: file.name,
              size: file.size,
              type: file.type || 'application/json',
              uploadTime: file.uploadTime,
              extractionStatus: 'pending',
            },
            currentUser.uid,
          ).catch((err) => console.warn('Firestore JSON pre-register failed:', err));
        }

        const recordCount = Array.isArray(data)
          ? data.length
          : typeof data === 'object' && data !== null
          ? Object.keys(data).length
          : 1;
        const recordLabel = Array.isArray(data) ? 'records' : 'keys';

        setMessages((prev) => [
          ...prev,
          {
            sender: 'system',
            message: indexingMessage(
              `"${file.name}"`,
              `${recordCount} ${recordLabel}`,
            ),
            messageType: 'json_rag',
            documentName: file.name,
            timestamp: new Date(),
          },
        ]);
        setSpinnerActive(true);

        let activeMemoryId = memoryId;
        if (!activeMemoryId && currentUser?.uid) {
          activeMemoryId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
          setMemoryId(activeMemoryId);
          try {
            localStorage.setItem(`research-chatbot-memory-id-${currentUser.uid}`, activeMemoryId);
          } catch (_) {}
        }

        ingestJson(
          data,
          file.name || (file.file && file.file.name),
          activeMemoryId,
          currentUser?.uid,
        ).catch((err) => {
          console.warn('JSON RAG ingestion failed:', err);
          setMessages((prev) => {
            const updated = [...prev];
            const idx = updated.findIndex(
              (m) =>
                m.sender === 'system' &&
                m.messageType === 'json_rag' &&
                m.documentName === file.name,
            );
            if (idx < 0) return prev;
            updated[idx] = {
              ...updated[idx],
              message: indexingErrorMessage(file.name, extractIngestionErrorReason(err)),
              messageType: 'error',
            };
            return updated;
          });
          setSpinnerActive(false);
        });
      };
      reader.readAsText(file.file || file);
    },
    [dispatch, setPendingFiles, setUploadedFiles, memoryId, currentUser, setSpinnerActive],
  );

  // Function to handle file upload
  const handleFileUpload = useCallback(
    (event) => {
      const rawFiles = Array.from(event.target.files);
      const { accepted: files, rejected } = partitionFilesByType(rawFiles);
      if (rejected.length > 0) {
        rejected.forEach((r) => {
          setMessages((prev) => [
            ...prev,
            {
              sender: 'system',
              message: `❌ "${r.file.name}" rejected — ${r.reason}`,
              messageType: 'error',
              timestamp: new Date(),
            },
          ]);
        });
      }

      if (files.length > 0) {
        const newFiles = files.map((file) => ({
          id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          file: file,
          name: file.name,
          size: file.size,
          type: file.type,
          uploadTime: new Date(),
          extractionStatus: 'pending',
        }));

        // GeoJSON → map + RAG; plain JSON → RAG only; everything else → extraction
        const geojsonFiles = newFiles.filter((f) => f.name.toLowerCase().endsWith('.geojson'));
        const jsonFiles = newFiles.filter(
          (f) =>
            f.name.toLowerCase().endsWith('.json') && !f.name.toLowerCase().endsWith('.geojson'),
        );
        const regularFiles = newFiles.filter(
          (f) =>
            !f.name.toLowerCase().endsWith('.geojson') && !f.name.toLowerCase().endsWith('.json'),
        );

        geojsonFiles.forEach((f) => handleGeoJSONUpload(f));
        jsonFiles.forEach((f) => handleJSONUpload(f));

        if (regularFiles.length === 0) {
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // Add to both pending (for tokens) and uploaded (for Documents tab)
        setPendingFiles((prev) => [...prev, ...regularFiles]);
        setUploadedFiles((prev) => [...prev, ...regularFiles]);

        // Log uploaded files
        regularFiles.forEach((file) => {
          logger.info('File uploaded:', {
            name: file.name,
            size: file.size,
            type: file.type,
          });
        });

        // Save document metadata to Firestore if we have memoryId and userId
        if (memoryId && currentUser?.uid) {
          console.log(
            '📄 Saving documents to Firestore (memoryId exists):',
            memoryId,
            'files:',
            regularFiles.map((f) => f.name),
          );
          // Use Promise.all to properly handle async saves
          Promise.all(
            regularFiles.map(async (file) => {
              try {
                const documentData = {
                  id: file.id,
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  uploadTime: file.uploadTime,
                  extractionStatus: 'pending',
                };
                console.log('📄 Calling addDocumentToConversation:', {
                  memoryId,
                  documentData,
                  userId: currentUser.uid,
                });
                const result = await addDocumentToConversation(
                  memoryId,
                  documentData,
                  currentUser.uid,
                );
                console.log(
                  '📄 Document metadata saved to Firestore:',
                  file.name,
                  'result:',
                  result,
                );
                return result;
              } catch (error) {
                console.error(
                  '❌ Failed to save document metadata to Firestore:',
                  file.name,
                  error,
                );
                // Continue - local state is still updated even if Firestore fails
                return null;
              }
            }),
          )
            .then((results) => {
              console.log('📄 All document saves completed:', results);
            })
            .catch((err) => {
              console.error('❌ Error in document save batch:', err);
            });
        } else {
          console.log('📄 No memoryId yet - documents will be synced when first message is sent', {
            memoryId,
            userId: currentUser?.uid,
          });
        }

        // Automatically trigger PDF ingestion for PDF/image files
        setTimeout(() => {
          regularFiles.forEach((file) => {
            handlePDFUpload(file);
          });
        }, 100); // Small delay to ensure state is updated

        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [handlePDFUpload, memoryId, currentUser],
  );

  // Function to trigger file upload
  const triggerFileUpload = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  // Process a File[] directly (used by drag-and-drop in Documents tab)
  const handleDroppedFiles = useCallback(
    (files) => {
      if (!files || files.length === 0) return;

      const { accepted, rejected } = partitionFilesByType(files);
      if (rejected.length > 0) {
        rejected.forEach((r) => {
          setMessages((prev) => [
            ...prev,
            {
              sender: 'system',
              message: `❌ "${r.file.name}" rejected — ${r.reason}`,
              messageType: 'error',
              timestamp: new Date(),
            },
          ]);
        });
      }
      if (accepted.length === 0) return;

      const newFiles = accepted.map((file) => ({
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        uploadTime: new Date(),
        extractionStatus: 'pending',
      }));

      const geojsonFiles = newFiles.filter((f) => f.name.toLowerCase().endsWith('.geojson'));
      const jsonFiles = newFiles.filter(
        (f) =>
          f.name.toLowerCase().endsWith('.json') && !f.name.toLowerCase().endsWith('.geojson'),
      );
      const regularFiles = newFiles.filter(
        (f) =>
          !f.name.toLowerCase().endsWith('.geojson') && !f.name.toLowerCase().endsWith('.json'),
      );

      geojsonFiles.forEach((f) => handleGeoJSONUpload(f));
      jsonFiles.forEach((f) => handleJSONUpload(f));

      if (regularFiles.length === 0) return;

      setPendingFiles((prev) => [...prev, ...regularFiles]);
      setUploadedFiles((prev) => [...prev, ...regularFiles]);

      if (memoryId && currentUser?.uid) {
        Promise.all(
          regularFiles.map(async (file) => {
            try {
              await addDocumentToConversation(
                memoryId,
                { id: file.id, name: file.name, size: file.size, type: file.type, uploadTime: file.uploadTime, extractionStatus: 'pending' },
                currentUser.uid,
              );
            } catch (error) {
              console.error('❌ Failed to save dropped document to Firestore:', file.name, error);
            }
          }),
        );
      }

      setTimeout(() => {
        regularFiles.forEach((file) => handlePDFUpload(file));
      }, 100);
    },
    [handleGeoJSONUpload, handleJSONUpload, handlePDFUpload, memoryId, currentUser],
  );

  // Function to set assistant message in context
  const setAssistantMessageInContext = useCallback(
    (message) => {
      console.log(
        'ResearchChatbot: Setting assistant message in context:',
        message ? 'Has message' : 'No message',
      );
      setAssistantMessage(message);
      if (onAssistantMessage) {
        onAssistantMessage(message);
      }
    },
    [onAssistantMessage, setAssistantMessage],
  );

  // Function to save conversation to localStorage
  const saveConversationToStorage = useCallback(
    (messagesToSave) => {
      if (!isStorageEnabled || !messagesToSave || messagesToSave.length === 0) {
        return;
      }

      try {
        saveConversation(messagesToSave, conversationId);
      } catch (error) {
        console.error('Failed to save conversation:', error);
      }
    },
    [isStorageEnabled, conversationId],
  );

  // Function to load conversation from localStorage
  const loadConversationFromStorage = useCallback(() => {
    if (!isStorageEnabled) {
      return;
    }

    // Logged-in users restore conversation state from the backend by memoryId.
    // Rehydrating the legacy global localStorage cache here can pull remnants
    // from a different conversation into the active session.
    if (currentUser?.uid) {
      return;
    }

    try {
      const savedData = loadConversation();
      if (savedData.messages && savedData.messages.length > 0) {
        setMessages(savedData.messages);
        setConversationId(savedData.conversationId);
        // Sync to DashboardContext so report generator has snapshots available
        setConversation(savedData.messages);
        console.log('📂 Loaded conversation from storage:', {
          messageCount: savedData.messages.length,
          conversationId: savedData.conversationId,
        });
      }
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  }, [currentUser, isStorageEnabled, setConversation]);

  // Spinner verbs (picked once per thinking period)
  const SPINNER_VERBS = [
    'Cogitating', 'Brewing', 'Calculating', 'Contemplating', 'Crafting',
    'Deliberating', 'Generating', 'Inferring', 'Mulling', 'Orchestrating',
    'Percolating', 'Pondering', 'Processing', 'Reasoning', 'Reticulating',
    'Ruminating', 'Synthesizing', 'Thinking', 'Tinkering', 'Weaving',
    'Computing', 'Distilling', 'Crystallizing', 'Musing', 'Unravelling',
  ];

  // Refs
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const inputRef = useRef(null);
  const isConnectingRef = useRef(false);
  const streamingTimeoutRef = useRef(null);
  // Watchdog for stalled live responses. If the WebSocket goes silent while a
  // query is still in flight (dropped connection / lost final frame), the spinner
  // would otherwise hang forever even though the backend finished and persisted
  // the answer. These let us detect the silence and pull the persisted answer —
  // the same data a manual page refresh recovers.
  const lastWsActivityRef = useRef(Date.now());
  const responseWatchdogRef = useRef(null);
  const pendingUserQueryRef = useRef(null);
  const geojsonColorIndexRef = useRef(0);
  const dropdownRef = useRef(null);

  // Normalize browser zoom so the panel looks identical regardless of the user's
  // Ctrl+/- zoom level. outerWidth/innerWidth gives the zoom ratio on all major
  // desktop browsers (Chrome, Edge, Firefox, Safari).
  useEffect(() => {
    const el = dropdownRef.current;
    if (!el) return;
    const normalize = () => {
      const ratio = window.outerWidth / window.innerWidth;
      // Guard against edge cases (mobile, extensions that set outerWidth to 0)
      if (ratio > 0.25 && ratio < 4 && Math.abs(ratio - 1) > 0.02) {
        el.style.zoom = String(+(1 / ratio).toFixed(4));
      } else {
        el.style.zoom = '';
      }
    };
    normalize();
    window.addEventListener('resize', normalize);
    return () => window.removeEventListener('resize', normalize);
  }, [isOpen]);

  // Default info message
  const defaultInfoMessage =
    "I'm your helpful AI assistant. You can mention datasets with @datasetName (e.g., @climate, @population).";
  const textInputLabel = defaultInfoMessage;

  // Initialize localStorage when component mounts
  useEffect(() => {
    if (isOpen) {
      // Check if localStorage is available
      const storageAvailable = isStorageAvailable();
      setIsStorageEnabled(storageAvailable);

      if (storageAvailable && !currentUser?.uid) {
        // Load conversation from localStorage directly
        try {
          const savedData = loadConversation();
          if (savedData.messages && savedData.messages.length > 0) {
            setMessages(savedData.messages);
            setConversationId(savedData.conversationId);
            // Sync to DashboardContext so report generator has snapshots available
            setConversation(savedData.messages);
            console.log('📂 Loaded conversation from storage:', {
              messageCount: savedData.messages.length,
              conversationId: savedData.conversationId,
            });
          }
        } catch (error) {
          console.error('Failed to load conversation:', error);
        }
      }
    }
  }, [currentUser, isOpen, setConversation]);

  // Fetch datasets when component mounts (separate effect)
  useEffect(() => {
    if (isOpen) {
      fetchAllDatasets();
    }
  }, [isOpen]);

  const fetchAllDatasets = async () => {
    try {
      logger.info('Fetching datasets from API for @ autocomplete...');

      // Fetch a reasonable number of datasets for autocomplete
      const response = await fetchDatasets({
        'page[size]': 365, // Fetch 400 datasets for autocomplete
        //published: true,
        status: 'saved',
        includes: 'layer,metadata',
      });

      logger.info('Total datasets loaded:', response?.length || 0);

      // Debug: Log first few datasets to see their structure
      if (response && response.length > 0) {
        logger.info('Sample dataset structure:', {
          id: response[0].id,
          name: response[0].name,
          metadata: response[0].metadata,
          metadataLength: response[0].metadata?.length,
          firstMetadata: response[0].metadata?.[0],
          displayName: getDatasetDisplayName(response[0]),
        });

        // Log a few more datasets to see patterns
        for (let i = 1; i < Math.min(5, response.length); i++) {
          logger.info(`Dataset ${i}:`, {
            name: response[i].name,
            displayName: getDatasetDisplayName(response[i]),
          });
        }
      }

      if (response && Array.isArray(response)) {
        setAllDatasets(response);
      } else {
        logger.warn('Invalid response format, setting empty array');
        setAllDatasets([]);
      }
    } catch (error) {
      logger.error('Error fetching datasets from API:', error);
      setAllDatasets([]);
    }
  };

  // Function to get dataset display name (metadata name only)
  const getDatasetDisplayName = (dataset) => {
    // Try multiple metadata access patterns
    if (dataset.metadata && dataset.metadata.length > 0 && dataset.metadata[0]?.info?.name) {
      return dataset.metadata[0].info.name;
    }
    // Try direct metadata access (some datasets might have metadata at top level)
    if (dataset.metadata?.info?.name) {
      return dataset.metadata.info.name;
    }
    // Fallback to dataset name (but clean it up)
    const cleanName = dataset.name || '';
    // Remove common prefixes like "bio.017", "soc.068", etc.
    return cleanName.replace(/^[a-z]+\.[0-9]+\.?[a-z]*\s*/, '');
  };

  // Function to get dataset search terms (metadata name only)
  const getDatasetSearchTerms = (dataset) => {
    const displayName = getDatasetDisplayName(dataset);
    return displayName.toLowerCase();
  };

  /**
   * Scroll to bottom of messages
   */
  const scrollToBottom = useCallback(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  /**
   * Mark streaming as complete after timeout
   */
  const markStreamingComplete = useCallback(() => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (!last || !last.isStreaming) return prev;
      return [
        ...prev.slice(0, -1),
        { ...last, isStreaming: false, timestamp: new Date() },
      ];
    });
    setIsLoading(false);
  }, []);

  /**
   * Recover a stalled response from the persisted conversation.
   *
   * Called by the stall watchdog when the live WebSocket has gone silent while a
   * query is still in flight. Fetches the saved chat log (the same source a manual
   * refresh reads) and, if the answer to the in-flight query has been persisted,
   * surfaces it and stops the spinner.
   *
   * Returns true once the answer is recovered (or already shown), false if the
   * backend has not yet persisted it — in which case the watchdog keeps waiting.
   */
  const reconcileStalledResponse = useCallback(
    async (mId) => {
      if (!mId) return false;

      let chatLogData;
      try {
        chatLogData = await getChatLog(mId);
      } catch (err) {
        logger.warn('Stalled-response reconcile fetch failed:', err);
        return false;
      }

      const log = chatLogData?.chatLog;
      if (!Array.isArray(log) || log.length === 0) return false;

      const norm = (s) => (s || '').trim();
      const senderOf = (m) => (m.sender === 'bot' ? 'assistant' : m.sender);

      // Only accept an assistant message that comes AFTER the query we just sent.
      // This prevents recovering the previous turn's answer before the backend has
      // finished persisting the current one.
      const pendingQuery = pendingUserQueryRef.current;
      let startIdx = 0;
      if (pendingQuery) {
        for (let i = log.length - 1; i >= 0; i -= 1) {
          if (senderOf(log[i]) === 'user' && norm(log[i].message) === norm(pendingQuery)) {
            startIdx = i + 1;
            break;
          }
        }
      }

      let answer = null;
      for (let i = log.length - 1; i >= startIdx; i -= 1) {
        if (senderOf(log[i]) === 'assistant' && norm(log[i].message)) {
          answer = norm(log[i].message);
          break;
        }
      }
      if (!answer) return false; // answer not persisted yet — keep waiting

      const current = messagesRef.current || [];
      const alreadyShown = current.some(
        (m) => m.sender === 'assistant' && norm(m.message) === answer,
      );

      setMessages((prev) => {
        const cleaned = prev
          .filter(
            (m) =>
              m.messageType !== 'web_search' &&
              m.messageType !== 'code_interpreter' &&
              m.messageType !== 'file_search',
          )
          .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
        if (alreadyShown) return cleaned;
        return [
          ...cleaned,
          {
            id: `recovered_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            sender: 'assistant',
            message: answer,
            messageType: 'research_result',
            timestamp: new Date(),
            isStreaming: false,
          },
        ];
      });

      if (!alreadyShown) {
        setLastAssistantMessage(answer);
        setAssistantMessageInContext(answer);
        setTimeout(scrollToBottom, 100);
      }
      return true;
    },
    [setAssistantMessageInContext, scrollToBottom],
  );

  /**
   * Stall watchdog. While a query is in flight (isLoading), watch for prolonged
   * WebSocket silence. Every inbound message refreshes lastWsActivityRef, so a
   * slow-but-working stream never trips this. If the channel goes quiet past the
   * threshold, fall back to the persisted answer instead of spinning forever.
   */
  useEffect(() => {
    if (!isLoading) {
      if (responseWatchdogRef.current) {
        clearTimeout(responseWatchdogRef.current);
        responseWatchdogRef.current = null;
      }
      return undefined;
    }

    const STALL_MS = 90000; // total live-channel silence treated as a stall
    const RETRY_MS = 20000; // re-check cadence while waiting for persistence
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const silentFor = Date.now() - lastWsActivityRef.current;

      if (silentFor < STALL_MS) {
        responseWatchdogRef.current = setTimeout(tick, STALL_MS - silentFor);
        return;
      }

      const recovered = await reconcileStalledResponse(memoryId);
      if (cancelled) return;

      if (recovered) {
        setIsLoading(false);
        responseWatchdogRef.current = null;
      } else {
        // Backend hasn't persisted the answer yet — keep waiting.
        responseWatchdogRef.current = setTimeout(tick, RETRY_MS);
      }
    };

    responseWatchdogRef.current = setTimeout(tick, STALL_MS);

    return () => {
      cancelled = true;
      if (responseWatchdogRef.current) {
        clearTimeout(responseWatchdogRef.current);
        responseWatchdogRef.current = null;
      }
    };
  }, [isLoading, memoryId, reconcileStalledResponse]);

  /**
   * Clear old messages to prevent payload size issues
   */
  const clearOldMessagesCallback = useCallback(() => {
    setMessages((prev) => prev.slice(-10)); // Keep only last 10 messages
    logger.info('Cleared old messages using local state');
  }, []);

  /**
   * Add message to chat log (using simple local state with localStorage persistence)
   */
  const addMessage = useCallback(
    (sender, message, messageType = 'text', isStreaming = false) => {
      console.log('🔍 DEBUG: addMessage called with:', {
        sender,
        message,
        messageType,
        isStreaming,
      });
      const newMessage = {
        id: Date.now() + Math.random(),
        sender,
        message,
        messageType,
        timestamp: new Date(),
        isStreaming,
      };
      console.log('🔍 DEBUG: New message object:', newMessage);

      setMessages((prev) => [...prev, newMessage]);

      // Scroll to bottom after message is added
      setTimeout(scrollToBottom, 100);
    },
    [scrollToBottom],
  );

  /**
   * Update the last message (useful for progress updates) - using simple local state with localStorage persistence
   */
  const updateLastMessage = useCallback(
    (message, isStreaming = false, messageType = null) => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        // Never overwrite a user message — only update assistant/system messages
        if (!last || last.sender === 'user') return prev;
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            message,
            timestamp: new Date(),
            isStreaming,
            ...(messageType && { messageType }),
          },
        ];
      });
    },
    [],
  );

  /**
   * Initialize WebSocket connection
   */
  const initializeWebSocket = useCallback(async () => {
    console.log('🔍 DEBUG: initializeWebSocket called', {
      isConnecting: isConnectingRef.current,
      isInitializing,
    });

    // Check if already connecting or connected using the WebSocket manager status
    const status = researchAPI.getConnectionStatus();
    if (isConnectingRef.current || status.isConnected) {
      console.log('🔍 DEBUG: WebSocket already connecting or connected, skipping');
      return;
    }

    isConnectingRef.current = true;
    setIsInitializing(true);
    setConnectionError(null);

    try {
      console.log('🔍 DEBUG: Starting WebSocket connection...');
      logger.info('Initializing WebSocket connection for research chatbot');

      // Establish WebSocket connection and get client ID
      const clientId = await researchAPI.establishWebSocket();
      setWsClientId(clientId);
      setIsConnected(true);

      console.log('🔍 DEBUG: WebSocket connected successfully', { clientId });
      logger.info('Research chatbot WebSocket connected with client ID:', clientId);
    } catch (error) {
      console.error('🔍 DEBUG: WebSocket connection failed:', error);
      logger.error('Failed to initialize WebSocket connection:', error);
      setConnectionError(error.message || 'Failed to connect to research service');
    } finally {
      setIsInitializing(false);
      isConnectingRef.current = false;
      console.log('🔍 DEBUG: WebSocket initialization completed');
    }
  }, []); // Remove isConnected from dependencies to prevent recreation loop

  /**
   * Handle WebSocket messages
   */
  const handleWebSocketMessage = useCallback(
    (message) => {
      console.log('🔍 DEBUG: WebSocket message received in component:', message);
      logger.info('Research chatbot received WebSocket message:', message);

      // Any inbound traffic means the live channel is alive — keep the stall
      // watchdog from firing on a slow-but-working stream.
      lastWsActivityRef.current = Date.now();

      // Only process messages that are meant for user display
      switch (message.type) {
        case 'agentStart':
        case 'agent_start':
          // Handle agent start messages (research phase beginning)
          console.log('🔍 DEBUG: Processing agentStart message:', message);
          if (message.data?.name) {
            console.log('🔍 DEBUG: Adding agent start message:', message.data.name);
            addMessage('system', message.data.name, 'intermediate');
            setIsLoading(true);
          }
          break;

        case 'agentUpdate':
        case 'agent_update':
          // Handle agent update messages (progress updates)
          console.log('🔍 DEBUG: Processing agentUpdate message:', message);
          if (message.message) {
            console.log('🔍 DEBUG: Updating last message with:', message.message);
            updateLastMessage(message.message);
          }
          break;

        case 'agentCompleted':
        case 'agent_completed':
          // Handle agent completed messages (research phase completed)
          console.log('🔍 DEBUG: Processing agentCompleted message:', message);
          if (message.data?.name) {
            console.log('🔍 DEBUG: Updating last message with:', message.data.name);
            // Mark the last intermediate message as completed by updating both content and type
            updateLastMessage(message.data.name, false, 'completed');

            if (message.data.lastAgent === true) {
              setIsLoading(false);
            }
          }
          break;

        case 'chat_response':
        case 'chatResponse':
          // Handle complete chat responses
          if (message.data?.content || message.content) {
            const content = message.data?.content || message.content;
            addMessage('assistant', content, 'research_result');
            setLastAssistantMessage(content); // Track for dashboard creation
            setAssistantMessageInContext(content); // Set in context for header dropdown
            setIsLoading(false);

            // Notify parent component if this is the first assistant response
            if (!hasReceivedFirstResponse && onFirstResponse) {
              setHasReceivedFirstResponse(true);
              onFirstResponse();
            }
          }
          break;

        case 'stream_response':
        case 'streamResponse':
        case 'stream':
          // Handle streaming responses (only actual research content)
          const content =
            message.data?.content || message.content || message.data?.message || message.message;

          if (content && typeof content === 'string') {
            // Check if we have an existing streaming message to append to
            const lastMessage = messagesRef.current[messagesRef.current.length - 1];

            if (
              lastMessage &&
              lastMessage.sender === 'assistant' &&
              lastMessage.messageType === 'research_result' &&
              lastMessage.isStreaming
            ) {
              // Append to existing streaming message
              const updatedContent = lastMessage.message + content;
              updateLastMessage(updatedContent, true); // true = isStreaming
              // Update the tracked message for dashboard creation
              setLastAssistantMessage(updatedContent);
              setAssistantMessageInContext(updatedContent); // Set in context for header dropdown
            } else {
              // Remove web_search spinner (if present) and add first bot chunk atomically
              const firstChunk = {
                id: Date.now() + Math.random(),
                sender: 'assistant',
                message: content,
                messageType: 'research_result',
                timestamp: new Date(),
                isStreaming: true,
              };
              setMessages(prev => [
                ...prev.filter(m => m.messageType !== 'web_search' && m.messageType !== 'code_interpreter' && m.messageType !== 'file_search'),
                firstChunk,
              ]);
              setTimeout(scrollToBottom, 100);
              // Track for dashboard creation
              setLastAssistantMessage(content);
              setAssistantMessageInContext(content); // Set in context for header dropdown

              // Notify parent component if this is the first assistant response
              if (!hasReceivedFirstResponse && onFirstResponse) {
                setHasReceivedFirstResponse(true);
                onFirstResponse();
              }
            }

            // Clear existing timeout and set new one
            if (streamingTimeoutRef.current) {
              clearTimeout(streamingTimeoutRef.current);
            }
            streamingTimeoutRef.current = setTimeout(markStreamingComplete, 2000);

            // Scroll to bottom after update
            setTimeout(scrollToBottom, 100);
          }
          break;

        case 'stream_end':
        case 'streamEnd':
        case 'end':
        case 'complete':
        case 'finished':
          // End of streaming response

          // Clear streaming timeout
          if (streamingTimeoutRef.current) {
            clearTimeout(streamingTimeoutRef.current);
            streamingTimeoutRef.current = null;
          }

          // Always clean up any leftover web_search / code_interpreter spinners
          setMessages(prev => prev.filter(m => m.messageType !== 'web_search' && m.messageType !== 'code_interpreter' && m.messageType !== 'file_search'));

          // Mark the last streaming message as complete
          const lastMessage = messagesRef.current[messagesRef.current.length - 1];
          if (lastMessage && lastMessage.isStreaming) {
            updateLastMessage(lastMessage.message, false); // false = not streaming
          }
          setIsLoading(false);
          break;

        case 'error':
          addMessage(
            'system',
            `❌ Error: ${message.data?.message || message.message || 'An error occurred'}`,
          );
          setIsLoading(false);
          break;

        case 'web_search_start':
          addMessage('system', 'Searching the web…', 'web_search');
          break;

        case 'code_interpreter_start':
          addMessage('system', 'Running computation…', 'code_interpreter');
          break;

        case 'file_search_start':
          addMessage('system', 'Searching uploaded documents…', 'file_search');
          break;

        case 'memoryIdCreated':
          // Handle memory ID creation (backend setup)
          console.log('🔍 DEBUG: Memory ID created:', message.data);
          break;

        case 'liveLlmCosts':
          // Handle cost updates (optional display)
          if (message.data > 0) {
            console.log('🔍 DEBUG: Cost update:', message.data);
          }
          break;

        case 'cost_update':
          // Handle cost updates (transformed format)
          if (message.data > 0) {
            console.log('🔍 DEBUG: Cost update:', message.data);
          }
          break;

        case 'extractionFailed': {
          const { documentName: wsDocName } = message.data || {};
          // Match by documentName so concurrent uploads can't clobber each
          // other's bubbles. Includes `pdf_rag` (the old handler missed it,
          // leaving zombie bubbles that reappeared on the next upload).
          // Falls back to "last in-flight" only when the WS event has no name.
          // Only ingestion bubbles — `intermediate` belongs to the agent
          // lifecycle and is handled by `agentCompleted` separately.
          const INFLIGHT_TYPES = new Set(['pdf_rag', 'geojson_rag', 'json_rag']);
          setMessages((prev) => {
            const updated = [...prev];
            const matchByName = wsDocName
              ? updated.findIndex(
                  (m) =>
                    m.sender === 'system' &&
                    INFLIGHT_TYPES.has(m.messageType) &&
                    m.documentName === wsDocName,
                )
              : -1;
            const idx =
              matchByName >= 0
                ? matchByName
                : [...updated].reverse().findIndex(
                    (m) => m.sender === 'system' && INFLIGHT_TYPES.has(m.messageType),
                  );
            const realIdx =
              matchByName >= 0 ? matchByName : idx < 0 ? -1 : updated.length - 1 - idx;
            if (realIdx < 0) return prev;
            updated[realIdx] = {
              ...updated[realIdx],
              messageType: 'error',
              message: `Failed to process document${wsDocName ? ` "${wsDocName}"` : ''}. Please try again.`,
            };
            return updated;
          });
          break;
        }

        case 'ragIngestionCompleted': {
          // Handle RAG ingestion completion from backend (PDF, GeoJSON, JSON).
          // Match by documentName so concurrent uploads stay separated, and
          // include `pdf_rag` in the in-flight set (it was missing before,
          // which is what caused old "Indexing …" bubbles to revive on the
          // next upload — see the bug fix in CHATBOT_UI_STYLE.md anti-patterns).
          console.log('🔍 DEBUG: RAG ingestion completed:', message.data);
          const wsDocName = message.data?.documentName;
          // Only ingestion bubbles — `intermediate` belongs to the agent
          // lifecycle and is handled by `agentCompleted` separately.
          const INFLIGHT_TYPES = new Set(['pdf_rag', 'geojson_rag', 'json_rag']);
          setMessages((prev) => {
            const updated = [...prev];
            const matchByName = wsDocName
              ? updated.findIndex(
                  (m) =>
                    m.sender === 'system' &&
                    INFLIGHT_TYPES.has(m.messageType) &&
                    m.documentName === wsDocName,
                )
              : -1;
            let realIdx = matchByName;
            if (realIdx < 0) {
              // No name match — fall back to last in-flight bubble (used by
              // older WS payloads without `documentName`).
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].sender === 'system' && INFLIGHT_TYPES.has(updated[i].messageType)) {
                  realIdx = i;
                  break;
                }
              }
            }
            if (realIdx < 0) return prev;
            updated[realIdx] = {
              ...updated[realIdx],
              messageType: 'completed',
              message: message.data?.message || `"${wsDocName ?? updated[realIdx].documentName ?? 'Document'}" indexed and ready for queries`,
            };
            return updated;
          });
          setSpinnerActive(false);
          // Update the file object in uploadedFiles with the s3 refs and final
          // extractionStatus so the Documents tab reflects "ready" + can render
          // a download link.
          //
          // CRITICAL: do NOT overwrite `f.id` here. The canonical id is the one
          // the frontend generated at upload time and registered via
          // `addDocumentToConversation` — that's what Firestore persists
          // (`addOrUpdateDocument` matches by name and preserves the existing
          // id). The `message.data.fileId` is a throwaway backend-local var
          // that never lands in Firestore, so overwriting with it breaks the
          // download lookup (`d.id === documentId` fails) and forces the
          // brittle name-hint fallback.
          {
            const docName = message.data?.documentName;
            const s3Key = message.data?.s3Key;
            const s3Bucket = message.data?.s3Bucket;
            if (docName) {
              setUploadedFiles((prev) =>
                prev.map((f) => {
                  if (f.name === docName) {
                    return {
                      ...f,
                      extractionStatus: 'rag_ready',
                      ...(s3Key ? { s3Key } : {}),
                      ...(s3Bucket ? { s3Bucket } : {}),
                    };
                  }
                  return f;
                }),
              );
            }
          }
          break;
        }

        case 'map_concessions': {
          // Geocatmin spatial query result — render concessions on the Mapbox map
          const {
            geojson,
            buffer,
            place,
            count,
            radiusKm: resultRadiusKm,
            renderType,
          } = message.data || {};

          if (geojson?.features?.length > 0) {
            // ── PIN rendering (place_pins tool result) ────────────────────────
            if (renderType === 'pins') {
              const PIN_COLORS = {
                red: { fill: '#f43f5e', glow: '#f43f5e' },
                blue: { fill: '#3b82f6', glow: '#3b82f6' },
                green: { fill: '#22c55e', glow: '#22c55e' },
                black: { fill: '#1f2937', glow: '#6b7280' },
              };
              const { fill: pinFill, glow: pinGlow } =
                PIN_COLORS[message.data?.pinColor] || PIN_COLORS.red;
              const isCentroid = message.data?.pinShape === 'centroid';

              const pinLayerId = `geo-pins-${Date.now()}`;
              const pinLayerSpec = {
                id: pinLayerId,
                isGeojsonUpload: true,
                name: isCentroid
                  ? 'Centroid'
                  : `Pins — ${place || geojson.features.length + ' locations'}`,
                layerConfig: {
                  type: 'geojson',
                  source: { type: 'geojson', data: geojson },
                  render: {
                    layers: isCentroid
                      ? [
                          // Bullseye outer ring — large hollow circle
                          {
                            type: 'circle',
                            source: pinLayerId,
                            paint: {
                              'circle-radius': 22,
                              'circle-color': 'transparent',
                              'circle-opacity': 1,
                              'circle-stroke-width': 3,
                              'circle-stroke-color': '#f43f5e',
                              'circle-stroke-opacity': 0.9,
                            },
                          },
                          // Middle ring
                          {
                            type: 'circle',
                            source: pinLayerId,
                            paint: {
                              'circle-radius': 14,
                              'circle-color': 'transparent',
                              'circle-opacity': 1,
                              'circle-stroke-width': 2,
                              'circle-stroke-color': '#f43f5e',
                              'circle-stroke-opacity': 0.6,
                            },
                          },
                          // Solid red center dot
                          {
                            type: 'circle',
                            source: pinLayerId,
                            paint: {
                              'circle-radius': 6,
                              'circle-color': '#f43f5e',
                              'circle-opacity': 1,
                              'circle-stroke-width': 2,
                              'circle-stroke-color': '#ffffff',
                            },
                          },
                        ]
                      : [
                          // Standard pin — outer glow ring
                          {
                            type: 'circle',
                            source: pinLayerId,
                            paint: {
                              'circle-radius': 18,
                              'circle-color': pinGlow,
                              'circle-opacity': 0.2,
                              'circle-stroke-width': 0,
                            },
                          },
                          // Main pin circle
                          {
                            type: 'circle',
                            source: pinLayerId,
                            paint: {
                              'circle-radius': 10,
                              'circle-color': pinFill,
                              'circle-opacity': 1,
                              'circle-stroke-width': 2.5,
                              'circle-stroke-color': '#ffffff',
                            },
                          },
                        ],
                  },
                },
              };
              dispatch(addGeojsonLayer(pinLayerSpec));

              let [minLng, minLat, maxLng, maxLat] = computeGeojsonBbox(geojson);
              if (isFinite(minLng)) {
                // For a single point (centroid or lone pin) the bbox is degenerate —
                // expand it by ~25 km in every direction so the widget shows context.
                const MIN_SPAN = 0.22; // ~25 km at mid-latitudes
                if (maxLng - minLng < MIN_SPAN) {
                  const midLng = (minLng + maxLng) / 2;
                  minLng = midLng - MIN_SPAN / 2;
                  maxLng = midLng + MIN_SPAN / 2;
                }
                if (maxLat - minLat < MIN_SPAN) {
                  const midLat = (minLat + maxLat) / 2;
                  minLat = midLat - MIN_SPAN / 2;
                  maxLat = midLat + MIN_SPAN / 2;
                }
                dispatch(
                  setBounds({ bbox: [minLng, minLat, maxLng, maxLat], options: { padding: 80 } }),
                );
              }

              // Map snapshot widget (same as polygon path)
              const pinSnapshotId = `map-snap-${Date.now()}`;
              setMessages((prev) => {
                const precedingMessageCount = prev.filter(
                  (m) => m.messageType !== 'map_snapshot',
                ).length;
                const updated = [
                  ...prev,
                  {
                    id: pinSnapshotId,
                    sender: 'assistant',
                    messageType: 'map_snapshot',
                    message: '',
                    mapSnapshot: {
                      place:
                        place ||
                        `${geojson.features.length} location${
                          geojson.features.length !== 1 ? 's' : ''
                        }`,
                      count: geojson.features.length,
                      radiusKm: null,
                      loading: true,
                    },
                    timestamp: new Date(),
                    isStreaming: false,
                    memoryId: memoryId,
                    precedingMessageCount,
                  },
                ];
                setTimeout(() => saveConversationToStorage(updated), 0);
                return updated;
              });
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('polisense:capture_map'));
              }, 1800);

              break;
            }

            // ── POLYGON rendering (render_polygons / concessions) ─────────────
            const layerId = `geocatmin-concessions-${Date.now()}`;
            const isDocPolygon = geojson.features[0]?.properties?.source === 'documento';

            // Document polygon: orange with label; concessions: green
            const fillColor = isDocPolygon ? '#f97316' : '#22c55e';
            const lineColor = isDocPolygon ? '#c2410c' : '#16a34a';
            const lineWidth = isDocPolygon ? 2 : 1;
            const layerName = isDocPolygon
              ? `Polígono — ${place}`
              : `Concesiones mineras — ${place}`;

            const polygonLayers = [
              {
                type: 'fill',
                source: layerId,
                paint: { 'fill-color': fillColor, 'fill-opacity': isDocPolygon ? 0.35 : 0.45 },
              },
              {
                type: 'line',
                source: layerId,
                paint: { 'line-color': lineColor, 'line-width': lineWidth },
              },
            ];

            // For document polygons, add a symbol label at the polygon centroid so
            // the polygon is always findable even when zoomed far out.
            if (isDocPolygon) {
              polygonLayers.push({
                type: 'symbol',
                source: layerId,
                layout: {
                  'text-field': ['get', 'label'],
                  'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                  'text-size': 13,
                  'text-anchor': 'center',
                  'text-allow-overlap': true,
                  'text-ignore-placement': true,
                  'symbol-placement': 'point',
                },
                paint: {
                  'text-color': '#7c2d12',
                  'text-halo-color': '#ffffff',
                  'text-halo-width': 2,
                },
              });
            }

            // Add polygon layer
            const concessionLayerSpec = {
              id: layerId,
              isGeojsonUpload: true,
              name: layerName,
              layerConfig: {
                type: 'geojson',
                source: { type: 'geojson', data: geojson },
                render: { layers: polygonLayers },
              },
            };
            dispatch(addGeojsonLayer(concessionLayerSpec));

            // Optionally add the search buffer as a thin blue ring
            if (buffer) {
              const bufferLayerId = `geocatmin-buffer-${Date.now()}`;
              const bufferLayerSpec = {
                id: bufferLayerId,
                isGeojsonUpload: true,
                name: `Área de búsqueda — ${place}`,
                layerConfig: {
                  type: 'geojson',
                  source: {
                    type: 'geojson',
                    data: { type: 'Feature', geometry: buffer, properties: {} },
                  },
                  render: {
                    layers: [
                      {
                        type: 'line',
                        source: bufferLayerId,
                        paint: {
                          'line-color': '#3b82f6',
                          'line-width': 2,
                          'line-dasharray': [4, 2],
                        },
                      },
                    ],
                  },
                },
              };
              dispatch(addGeojsonLayer(bufferLayerSpec));
            }

            // Fly to the bounding box of the results
            const [minLng, minLat, maxLng, maxLat] = computeGeojsonBbox(geojson);
            if (isFinite(minLng)) {
              dispatch(
                setBounds({ bbox: [minLng, minLat, maxLng, maxLat], options: { padding: 60 } }),
              );
            }

            // ── Map snapshot widget ──────────────────────────────────────────
            // Add a loading placeholder then request the canvas capture.
            // The explore-map component will fire 'polisense:map_captured' once
            // the map has finished rendering the new layers.
            const snapshotPlace = message.data?.place ?? '';
            const snapshotCount = message.data?.count ?? null;
            const snapshotRadius = message.data?.radiusKm ?? null;
            const snapshotId = `map-snap-${Date.now()}`;

            setMessages((prev) => {
              // Count non-snapshot messages that precede this snapshot so we can
              // re-insert it at the correct position when restoring from Firestore
              // (Firestore messages have no timestamps, so position-count is the
              // only reliable insertion anchor).
              const precedingMessageCount = prev.filter(
                (m) => m.messageType !== 'map_snapshot',
              ).length;

              const updated = [
                ...prev,
                {
                  id: snapshotId,
                  sender: 'assistant',
                  messageType: 'map_snapshot',
                  message: '',
                  mapSnapshot: {
                    place: snapshotPlace,
                    count: snapshotCount,
                    radiusKm: snapshotRadius,
                    loading: true,
                  },
                  timestamp: new Date(),
                  isStreaming: false,
                  memoryId: memoryId,
                  precedingMessageCount,
                },
              ];
              setTimeout(() => saveConversationToStorage(updated), 0);
              return updated;
            });

            // Fire the capture request after Redux state has propagated to the map
            // component, layers have been added to Mapbox, and the fly-to animation
            // has started. explore-map then waits for 'idle' before capturing.
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('polisense:capture_map'));
            }, 1800);
          }

          setIsLoading(false);
          break;
        }

        case 'analysis_panel': {
          // Deep-analysis panel — HTML chart + explanation streamed panel by panel
          const { index, total, title, explanation, html } = message.data || {};
          const panelId = `analysis-panel-${Date.now()}-${index}`;
          setMessages((prev) => {
            const updated = [
              ...prev,
              {
                id: panelId,
                sender: 'assistant',
                messageType: 'analysis_panel',
                message: '',
                analysisPanel: { index, total, title, explanation, html },
                timestamp: new Date(),
                isStreaming: false,
                memoryId: memoryId,
              },
            ];
            // Sync to DashboardContext so "Generate Report" can access the Plotly HTML
            setConversation(updated);
            setTimeout(() => saveConversationToStorage(updated), 0);
            return updated;
          });
          break;
        }

        default:
          // Handle role/content chunks (OpenAI streaming format)
          console.log('🔍 DEBUG: Processing default case message:', message);
          if (message.role && message.content && typeof message.content === 'string') {
            // Check if we have an existing streaming message to append to
            const lastMessage = messagesRef.current[messagesRef.current.length - 1];

            if (
              lastMessage &&
              lastMessage.sender === 'assistant' &&
              lastMessage.messageType === 'research_result' &&
              lastMessage.isStreaming
            ) {
              // Append to existing streaming message
              const updatedContent = lastMessage.message + message.content;
              updateLastMessage(updatedContent, true); // true = isStreaming
              // Update the tracked message for dashboard creation
              setLastAssistantMessage(updatedContent);
              setAssistantMessageInContext(updatedContent); // Set in context for header dropdown
            } else {
              // Create new streaming message
              addMessage('assistant', message.content, 'research_result', true); // true = isStreaming
              // Track for dashboard creation
              setLastAssistantMessage(message.content);
              setAssistantMessageInContext(message.content); // Set in context for header dropdown
            }

            // Clear existing timeout and set new one
            if (streamingTimeoutRef.current) {
              clearTimeout(streamingTimeoutRef.current);
            }
            streamingTimeoutRef.current = setTimeout(markStreamingComplete, 2000);

            // Scroll to bottom after update
            setTimeout(scrollToBottom, 100);
          }
          break;
      }
    },
    [
      addMessage,
      updateLastMessage,
      scrollToBottom,
      setLastAssistantMessage,
      setAssistantMessageInContext,
    ],
  );

  /**
   * Handle connection status changes
   */
  const handleConnectionChange = useCallback((status) => {
    logger.info('Research chatbot connection status changed:', status);

    if (status.type === 'connected') {
      setIsConnected(true);
      setConnectionError(null);
      setIsInitializing(false);
      // Get client ID from WebSocket manager
      const wsStatus = researchAPI.getConnectionStatus();
      if (wsStatus.clientId) {
        setWsClientId(wsStatus.clientId);
      }
    } else if (status.type === 'disconnected') {
      // Don't set isConnected to false immediately - let WebSocket manager handle reconnection
      // Only update if we're sure it's disconnected and not reconnecting
      const wsStatus = researchAPI.getConnectionStatus();
      if (!wsStatus.isConnected && wsStatus.reconnectAttempts >= 5) {
        setIsConnected(false);
        // Don't show connection errors to user - WebSocket reconnects automatically
        setConnectionError(null);
      } else {
        // Connection lost but reconnecting - handle silently
        setConnectionError(null);
      }
      setIsInitializing(false);
    }
  }, []);

  /**
   * Handle spinner state changes
   */
  const handleSpinnerChange = useCallback((active) => {
    console.log('🔍 DEBUG: Spinner state changed:', active);
    setSpinnerActive(active);
  }, []);

  /**
   * Handle connection errors
   */
  const handleConnectionError = useCallback((error) => {
    logger.error('Research chatbot connection error:', error);
    // Only log the error internally - don't display it to the user
    // WebSocket reconnects automatically, so these errors are transient
    setConnectionError(null); // Clear any previous error messages
    // Don't set isConnected to false here - let handleConnectionChange handle it
    // This prevents triggering re-initialization loops
    const status = researchAPI.getConnectionStatus();
    if (!status.isConnected) {
      setWsClientId(null);
      // Don't add error message to UI - WebSocket manager handles reconnection silently
    }
  }, []);

  /**
   * Handle dataset mention - Enhanced to integrate with dataset widget functionality
   */
  const handleDatasetMention = useCallback(
    async (datasetName) => {
      // Find dataset using the same search logic as the dropdown (includes metadata names)
      const dataset = allDatasets.find((ds) => {
        const searchTerms = getDatasetSearchTerms(ds);
        return searchTerms.includes(datasetName.toLowerCase());
      });

      if (!dataset) {
        logger.warn(`Dataset "${datasetName}" not found`);
        addMessage(
          'system',
          `❌ Dataset "${datasetName}" not found. Try typing @ followed by a dataset name to see available options.`,
        );
        return;
      }

      // Check if dataset is already active
      if (!activeDatasets.find((ds) => ds.id === dataset.id)) {
        const datasetWithActive = { ...dataset, active: true };
        setActiveDatasets((prev) => [...prev, datasetWithActive]);

        // Add dataset context
        const contextMessage = `Dataset "${getDatasetDisplayName(
          dataset,
        )}" has been added to the conversation context. This dataset contains information about ${getDatasetDisplayName(
          dataset,
        ).toLowerCase()}.`;
        setDatasetContext((prev) => [...prev, contextMessage]);

        // Activate the map for this dataset using the exact same functionality as the "Add to map" button
        if (dataset.layer && dataset.layer.length > 0) {
          // Use the exact same actions as the explore datasets widget "Add to map" button
          dispatch(toggleMapLayerGroup({ dataset, toggle: true }));
          dispatch(resetMapLayerGroupsInteraction());

          logger.info('Map activated for dataset:', getDatasetDisplayName(dataset));
        }

        // Dataset is added silently without showing a message to the user

        logger.info(
          `Dataset "${getDatasetDisplayName(
            dataset,
          )}" added to context and map using widget integration`,
        );
      } else {
        // Dataset is already active, no message shown
      }
    },
    [allDatasets, activeDatasets, getDatasetDisplayName, addMessage, dispatch],
  );

  /**
   * Send chat message
   */
  const sendChatMessage = useCallback(async () => {
    console.log('🔍 DEBUG: sendChatMessage called', {
      hasInput: !!inputMessage.trim(),
      wsClientId,
      isLoading,
      isConnected,
      isRagInProgress,
    });

    // `isRagInProgress` is the source of truth for "indexing in flight" — the
    // textarea + Send button are both disabled when it's true, but we re-check
    // here so any code path that calls sendChatMessage directly (keyboard
    // shortcuts, future programmatic sends, race during the disable flip)
    // still respects the lock. Sending a query while file_search is being
    // built against an in-flight upload yields unreliable retrieval.
    if (!inputMessage.trim() || !wsClientId || isLoading || isRagInProgress) {
      console.log('🔍 DEBUG: Cannot send message', {
        reason: !inputMessage.trim()
          ? 'no input'
          : !wsClientId
          ? 'no wsClientId'
          : isLoading
          ? 'isLoading'
          : 'isRagInProgress',
      });
      return;
    }

    const userMessage = inputMessage.trim();
    setInputMessage('');

    // Add user message to chat as is
    addMessage('user', userMessage);

    // Keep selected datasets active after sending (don't clear them)
    setIsLoading(true);

    // Arm the stall watchdog: remember the query so recovery can match the
    // answer that follows it, and reset the silence clock to now so a long gap
    // before this send doesn't trip the watchdog prematurely.
    pendingUserQueryRef.current = userMessage;
    lastWsActivityRef.current = Date.now();

    try {
      // Convert messages to simplified format for API
      // Filter out system messages and limit to recent messages to prevent payload size issues
      const relevantMessages = [...messages, { sender: 'user', message: userMessage }]
        .filter((msg) => msg.sender === 'user' || msg.sender === 'assistant')
        .slice(-20); // Keep only last 20 messages to prevent payload size issues

      const simplifiedChatLog = relevantMessages.map((msg) => ({
        sender: msg.sender,
        message: msg.message,
        timestamp: msg.timestamp,
      }));

      // Check payload size and auto-clear if too large
      const payloadSize = JSON.stringify(simplifiedChatLog).length;

      if (payloadSize > 100000) {
        // 100KB limit
        logger.warn('Payload too large, clearing old messages automatically');
        clearOldMessagesCallback();
        // Recreate simplified chat log with fewer messages
        const recentMessages = [...messages, { sender: 'user', message: userMessage }]
          .filter((msg) => msg.sender === 'user' || msg.sender === 'assistant')
          .slice(-10); // Keep only last 10 messages

        simplifiedChatLog.length = 0; // Clear array
        simplifiedChatLog.push(
          ...recentMessages.map((msg) => ({
            sender: msg.sender,
            message: msg.message,
            timestamp: msg.timestamp,
          })),
        );
      }

      // Log final payload size for debugging
      const finalPayloadSize = JSON.stringify(simplifiedChatLog).length;
      logger.info('Sending research conversation request with parameters:', {
        numberOfSelectQueries,
        percentOfTopQueriesToSearch,
        percentOfTopResultsToScan,
        chatLogLength: simplifiedChatLog.length,
        payloadSizeBytes: finalPayloadSize,
        payloadSizeKB: Math.round((finalPayloadSize / 1024) * 100) / 100,
        wsClientId,
      });

      // Warn if payload is still getting large
      if (finalPayloadSize > 50000) {
        // 50KB limit
        logger.warn('Large payload detected, consider reducing chat history');
      }

      // Generate memoryId if not exists (for new conversation)
      let currentMemoryId = memoryId;
      if (!currentMemoryId) {
        currentMemoryId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        setMemoryId(currentMemoryId);
        // Only access localStorage in browser - use user-specific key
        if (typeof window !== 'undefined' && currentUser?.uid) {
          try {
            const storageKey = getUserStorageKey('research-chatbot-memory-id');
            localStorage.setItem(storageKey, currentMemoryId);
          } catch (error) {
            console.warn('Error saving to localStorage:', error);
          }
        }

        // Sync any existing uploaded files to Firestore now that we have a memoryId
        if (currentUser?.uid && uploadedFiles.length > 0) {
          console.log(
            '📄 Syncing uploaded files to new conversation:',
            currentMemoryId,
            'count:',
            uploadedFiles.length,
          );
          console.log(
            '📄 Files to sync:',
            uploadedFiles.map((f) => ({ id: f.id, name: f.name, isMetadata: f.isMetadata })),
          );

          // Use Promise.all to ensure all documents are synced before continuing
          const syncPromises = uploadedFiles
            .filter((file) => !file.isMetadata) // Skip metadata files
            .map(async (file) => {
              try {
                const documentData = {
                  id: file.id,
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  uploadTime: file.uploadTime,
                  extractionStatus: file.extractionStatus || 'pending',
                  ...(file.s3Key ? { s3Key: file.s3Key } : {}),
                  ...(file.s3Bucket ? { s3Bucket: file.s3Bucket } : {}),
                };
                console.log('📄 Syncing document:', documentData);
                const result = await addDocumentToConversation(
                  currentMemoryId,
                  documentData,
                  currentUser.uid,
                );
                console.log('📄 Document synced to Firestore:', file.name, result);
                return result;
              } catch (error) {
                console.error('❌ Failed to sync document to Firestore:', file.name, error);
                throw error;
              }
            });

          try {
            await Promise.all(syncPromises);
            console.log('✅ All documents synced to Firestore for conversation:', currentMemoryId);
          } catch (error) {
            console.error('❌ Some documents failed to sync:', error);
          }
        } else {
          console.log('📄 No files to sync or user not logged in:', {
            hasUser: !!currentUser?.uid,
            fileCount: uploadedFiles.length,
          });
        }
      }

      // Prepare uploaded documents for API (only send names and metadata references, not full metadata content)
      // Include ALL uploadedFiles (not just pendingFiles) so they persist across messages
      // This includes both regular files and metadata files
      // IMPORTANT: Do NOT send full metadata (markdown, structuredData) as it can be very large (MBs)
      // Instead, send only a reference that the backend can use to fetch the full metadata if needed
      const documentsToSend = uploadedFiles.map((file) => {
        const doc = {
          id: file.id, // Include document ID for proper tracking
          name: file.name || file.file?.name || '',
          size: file.size || file.file?.size,
          type: file.type || file.file?.type,
          uploadTime: file.uploadTime || new Date(),
          isMetadata: file.isMetadata || false,
          parentFileId: file.parentFileId || undefined,
          // Include extraction status for proper restoration
          extractionStatus: file.extractionStatus || 'pending',
        };

        return doc;
      });

      // Send conversation request to research API
      await researchAPI.conversation(simplifiedChatLog, {
        memoryId: currentMemoryId,
        userId: currentUser?.uid, // Send Firebase Auth UID
        numberOfSelectQueries,
        percentOfTopQueriesToSearch,
        percentOfTopResultsToScan,
        uploadedDocuments: documentsToSend.length > 0 ? documentsToSend : undefined,
      });

      // Clear pending files (tokens disappear from input area) after sending
      // But keep them in uploadedFiles for Documents tab
      setPendingFiles([]);

      logger.info('Research conversation request sent successfully', {
        documentsSent: documentsToSend.length,
        documentNames: documentsToSend.map((d) => d.name),
      });

      // Refresh conversation history after sending message (delay to allow backend to save)
      if (currentUser?.uid) {
        setTimeout(() => {
          loadAllConversations(currentUser.uid);
        }, 1000);
      }
    } catch (error) {
      logger.error('Error sending research conversation request:', error);
      setIsLoading(false);
    }
  }, [
    inputMessage,
    wsClientId,
    isLoading,
    isRagInProgress,
    messages,
    addMessage,
    memoryId,
    currentUser,
    numberOfSelectQueries,
    percentOfTopQueriesToSearch,
    percentOfTopResultsToScan,
    selectedDatasets,
    pendingFiles,
    loadAllConversations,
    getUserStorageKey,
  ]);

  /**
   * Handle input changes and show dataset autocomplete
   */
  const handleInputChange = useCallback(
    (e) => {
      const value = e.target.value;
      setInputMessage(value);

      // Check if we're typing after an @ symbol
      const lastAtSymbol = value.lastIndexOf('@');

      if (lastAtSymbol !== -1) {
        const afterAt = value.substring(lastAtSymbol + 1);
        const beforeAt = value.substring(0, lastAtSymbol);

        // Check if there's a space after @ (meaning we're not in a dataset name)
        const hasSpaceAfterAt = /\s/.test(afterAt);

        if (!hasSpaceAfterAt) {
          // Filter datasets based on what's typed after @
          const filtered = allDatasets
            .filter((dataset) => {
              const searchTerms = getDatasetSearchTerms(dataset);
              return searchTerms.includes(afterAt.toLowerCase());
            })
            .slice(0, 365); // Limit to 400 results for better coverage

          // Always prepend the fixed Catastro dataset when the search term matches
          const catastroTerms = ['catastro', 'minero', 'geocatmin', 'ingemmet', ''];
          const showCatastro = catastroTerms.some((t) => t.startsWith(afterAt.toLowerCase()));
          const withCatastro = showCatastro ? [CATASTRO_DATASET, ...filtered] : filtered;

          setFilteredDatasets(withCatastro);
          setShowDatasetDropdown(withCatastro.length > 0);
          setCursorPosition(lastAtSymbol);
          setSelectedDatasetIndex(0);
        } else {
          setShowDatasetDropdown(false);
        }
      } else {
        setShowDatasetDropdown(false);
      }
    },
    [allDatasets, getDatasetSearchTerms],
  );

  /**
   * Select a dataset from dropdown - Enhanced to integrate with dataset widget functionality
   */
  const selectDataset = useCallback(
    async (dataset) => {
      const beforeAt = inputMessage.substring(0, cursorPosition);
      const afterAt = inputMessage.substring(cursorPosition + 1);
      const spaceAfterAt = afterAt.indexOf(' ');
      const afterDataset = spaceAfterAt !== -1 ? afterAt.substring(spaceAfterAt) : '';

      // Use the metadata name as the identifier
      const datasetName = getDatasetDisplayName(dataset);
      const tokenLabel = datasetName; // no longer shorten; show full friendly name

      // Remove the @ and dataset name from input, keep only the text before and after
      const newValue = beforeAt + afterDataset;
      setInputMessage(newValue);

      // Add to selected datasets for visual indication (store full dataset object)
      setSelectedDatasets((prev) => [...prev, { dataset, shortName: tokenLabel }]);

      if (dataset._isCatastro) {
        // Fetch Catastro.geojson and render it on the map — no RAG ingestion.
        try {
          const apiBase = process.env.NEXT_PUBLIC_RESEARCH_API_URL || '/api';
          const res = await fetch(`${apiBase}/policy_research/catastro-geojson`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const geojson = await res.json();
          const layerId = 'catastro-minero';
          dispatch(
            addGeojsonLayer({
              id: layerId,
              isGeojsonUpload: true,
              name: 'Catastro Minero (GEOCATMIN)',
              layerConfig: {
                type: 'geojson',
                source: { type: 'geojson', data: geojson },
                render: {
                  layers: [
                    {
                      type: 'fill',
                      source: layerId,
                      paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.4 },
                    },
                    {
                      type: 'line',
                      source: layerId,
                      paint: { 'line-color': '#16a34a', 'line-width': 1 },
                    },
                  ],
                },
              },
            }),
          );
          const [minLng, minLat, maxLng, maxLat] = computeGeojsonBbox(geojson);
          if (isFinite(minLng)) {
            dispatch(
              setBounds({ bbox: [minLng, minLat, maxLng, maxLat], options: { padding: 40 } }),
            );
          }
        } catch (err) {
          console.error('Failed to load Catastro.geojson:', err);
        }
      } else {
        // Activate the map for this dataset using the same functionality as the dataset widget
        try {
          if (dataset.layer && dataset.layer.length > 0) {
            dispatch(toggleMapLayerGroup({ dataset, toggle: true }));
            dispatch(resetMapLayerGroupsInteraction());

            const defaultLayer = dataset.layer.find((l) => l.default) || dataset.layer[0];
            if (defaultLayer) {
              const { setMapLayerGroupActive } = await import('layout/explore/actions');
              dispatch(
                setMapLayerGroupActive({ dataset: { id: dataset.id }, active: defaultLayer.id }),
              );
            }

            logger.info('Map activated for dataset:', getDatasetDisplayName(dataset));
          }
        } catch (error) {
          console.error('Error activating dataset on map:', error);
        }
      }

      setShowDatasetDropdown(false);

      // Focus back on input at the position where the @ was
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const newCursorPos = beforeAt.length;
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    },
    [inputMessage, cursorPosition, dispatch],
  );

  /**
   * Handle key press in input
   */
  const handleKeyPress = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (showDatasetDropdown && filteredDatasets.length > 0) {
          // Select the currently highlighted dataset
          selectDataset(filteredDatasets[selectedDatasetIndex]);
        } else {
          sendChatMessage();
        }
      } else if (e.key === 'Escape') {
        setShowDatasetDropdown(false);
      } else if (e.key === 'ArrowDown' && showDatasetDropdown) {
        e.preventDefault();
        setSelectedDatasetIndex((prev) => (prev < filteredDatasets.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp' && showDatasetDropdown) {
        e.preventDefault();
        setSelectedDatasetIndex((prev) => (prev > 0 ? prev - 1 : filteredDatasets.length - 1));
      }
    },
    [sendChatMessage, showDatasetDropdown, filteredDatasets, selectedDatasetIndex, selectDataset],
  );

  /**
   * Retry connection
   */
  const retryConnection = useCallback(() => {
    setConnectionError(null);
    initializeWebSocket();
  }, [initializeWebSocket]);

  // Effect: Initialize WebSocket when component opens (only once)
  useEffect(() => {
    if (!isOpen) {
      return; // Don't initialize if component is closed
    }

    // Check connection status from the WebSocket manager
    const status = researchAPI.getConnectionStatus();
    if (status.isConnected) {
      // Already connected, sync state
      setIsConnected(true);
      setWsClientId(status.clientId);
      return;
    }

    if (isInitializing || isConnectingRef.current) {
      return; // Already initializing
    }

    console.log('🔍 DEBUG: Initializing WebSocket connection');
    initializeWebSocket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // Only depend on isOpen to prevent re-initialization loops

  // Effect: Add test message when component loads

  // Effect: Set up WebSocket message handlers
  useEffect(() => {
    if (isOpen) {
      console.log('🔍 DEBUG: Setting up WebSocket message handlers');
      // Add message handlers
      researchAPI.onMessage('*', handleWebSocketMessage);
      researchAPI.onConnection(handleConnectionChange);
      researchAPI.onError(handleConnectionError);
      researchAPI.onSpinnerChange(handleSpinnerChange); // Register spinner change handler

      // Test if the message handler is working
      console.log('🔍 DEBUG: Testing message handler registration');
      setTimeout(() => {
        console.log('🔍 DEBUG: Sending test message to handler');
        handleWebSocketMessage({
          type: 'test',
          data: { name: 'Test message' },
          message: 'This is a test',
        });
      }, 1000);

      return () => {
        // Clean up handlers
        researchAPI.offMessage('*', handleWebSocketMessage);
        researchAPI.offConnection(handleConnectionChange);
        researchAPI.offError(handleConnectionError);
        researchAPI.offSpinnerChange(handleSpinnerChange); // Clean up spinner handler
      };
    }
  }, [
    isOpen,
    handleWebSocketMessage,
    handleConnectionChange,
    handleConnectionError,
    handleSpinnerChange,
  ]);

  // Effect: Focus input when connected
  useEffect(() => {
    if (isConnected && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isConnected]);

  // Effect: Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isOpen) {
        // Don't close connection on unmount to maintain state
        // Connection will be managed by the service
      }
    };
  }, [isOpen]);

  // Keep DashboardContext memoryId in sync so the header can fetch the full log
  useEffect(() => {
    setMemoryIdInContext(memoryId);
  }, [memoryId, setMemoryIdInContext]);

  // Function to load user's conversation history (loads most recent on login)
  const loadUserConversationHistory = useCallback(
    async (userId) => {
      if (!userId) {
        console.warn('⚠️ loadUserConversationHistory called without userId');
        return;
      }

      try {
        console.log('📚 Loading conversation history for user:', userId);

        // Get user's conversations from backend
        const conversations = await fetchUserConversations(userId);
        console.log('📋 Received conversations:', conversations?.length || 0, conversations);

        if (conversations && conversations.length > 0) {
          // Get the most recent conversation
          const mostRecent = conversations[0];
          console.log('📖 Found conversation history:', {
            memoryId: mostRecent.memoryId,
            messageCount: mostRecent.messageCount,
            title: mostRecent.conversationTitle,
          });

          // Load the chat log for the most recent conversation
          console.log('📥 Loading chat log for memoryId:', mostRecent.memoryId);
          const chatLogData = await getChatLog(mostRecent.memoryId);
          console.log('📨 Received chatLogData:', {
            hasChatLog: !!chatLogData?.chatLog,
            chatLogLength: chatLogData?.chatLog?.length || 0,
            hasDocuments: !!chatLogData?.uploadedDocuments,
            documentCount: chatLogData?.uploadedDocuments?.length || 0,
            documents: chatLogData?.uploadedDocuments,
          });

          // Restore memoryId — prefer an in-progress session already saved in localStorage
          // (e.g. a GeoJSON was uploaded before the first message was sent, which writes a new
          // memoryId to localStorage but doesn't yet appear in Firestore conversation history).
          // Only fall back to mostRecent.memoryId when localStorage is empty or points to the
          // same conversation that Firestore already knows about.
          if (chatLogData || mostRecent.memoryId) {
            let activeMemoryId = mostRecent.memoryId;
            if (typeof window !== 'undefined') {
              try {
                const storageKey = getUserStorageKey('research-chatbot-memory-id');
                const storedId = localStorage.getItem(storageKey);
                // If localStorage has a different (newer) memoryId, that session is still active.
                // Keep it so an in-flight upload doesn't get orphaned.
                if (storedId && storedId !== mostRecent.memoryId) {
                  console.log(
                    '📌 Keeping in-progress memoryId from localStorage:',
                    storedId,
                    '(Firestore most-recent:',
                    mostRecent.memoryId,
                    ')',
                  );
                  activeMemoryId = storedId;
                } else {
                  localStorage.setItem(storageKey, mostRecent.memoryId);
                }
              } catch (error) {
                console.warn('Error reading memoryId from localStorage:', error);
              }
            }
            setMemoryId(activeMemoryId);
          }

          // Restore uploaded documents from Firestore
          // Use the same memoryId we just resolved so documents match the active session
          const activeMemoryIdForDocs = (() => {
            try {
              const storageKey = getUserStorageKey('research-chatbot-memory-id');
              return (
                (typeof window !== 'undefined' && localStorage.getItem(storageKey)) ||
                mostRecent.memoryId
              );
            } catch (_) {
              return mostRecent.memoryId;
            }
          })();
          try {
            const firestoreDocuments = await getConversationDocuments(activeMemoryIdForDocs);
            console.log('📄 Fetched documents from Firestore on login:', {
              memoryId: activeMemoryIdForDocs,
              count: firestoreDocuments?.length || 0,
            });

            if (firestoreDocuments && firestoreDocuments.length > 0) {
              const restoredFiles = firestoreDocuments.map((doc) => {
                // Parse uploadTime - handle Date, Firestore Timestamp, ISO string, or object with seconds
                let uploadTime = new Date();
                if (doc.uploadTime) {
                  if (doc.uploadTime instanceof Date) {
                    uploadTime = doc.uploadTime;
                  } else if (typeof doc.uploadTime === 'string') {
                    uploadTime = new Date(doc.uploadTime);
                  } else if (doc.uploadTime.toDate && typeof doc.uploadTime.toDate === 'function') {
                    uploadTime = doc.uploadTime.toDate();
                  } else if (doc.uploadTime.seconds) {
                    uploadTime = new Date(doc.uploadTime.seconds * 1000);
                  } else if (doc.uploadTime._seconds) {
                    uploadTime = new Date(doc.uploadTime._seconds * 1000);
                  }
                }

                return {
                  id: doc.id,
                  name: doc.name,
                  size: doc.size || 0,
                  type: doc.type || 'application/octet-stream',
                  uploadTime,
                  extractionStatus: doc.extractionStatus,
                  markdownFileName: doc.markdownFileName,
                  extractedMetadata: doc.extractedMetadata,
                  extractionError: doc.extractionError,
                  s3Bucket: doc.s3Bucket,
                  s3Key: doc.s3Key,
                };
              });

              console.log(
                '📄 Restored files on login:',
                restoredFiles.map((f) => ({
                  id: f.id,
                  name: f.name,
                  uploadTime: f.uploadTime,
                  isValidDate: f.uploadTime instanceof Date && !isNaN(f.uploadTime),
                })),
              );

              setUploadedFiles(restoredFiles);
              setPendingFiles([]);
              console.log('✅ Restored documents from Firestore on login:', {
                memoryId: activeMemoryIdForDocs,
                count: restoredFiles.length,
                names: restoredFiles.map((f) => f.name),
              });
            } else {
              console.log('📭 No documents found in Firestore on login:', activeMemoryIdForDocs);
              setUploadedFiles([]);
              setPendingFiles([]);
            }
          } catch (docError) {
            console.warn('Failed to fetch documents from Firestore on login:', docError);
            setUploadedFiles([]);
            setPendingFiles([]);
          }

          if (chatLogData && chatLogData.chatLog && chatLogData.chatLog.length > 0) {
            // Convert chatLog to messages format, preserving original formatting
            const restoredMessages = chatLogData.chatLog.map((msg, index) => {
              // PolicySynth saves assistant messages with sender:'bot' — normalize to 'assistant'.
              let sender = msg.sender === 'bot' ? 'assistant' : msg.sender;
              if (!sender || (sender !== 'user' && sender !== 'assistant' && sender !== 'system')) {
                // If sender is invalid/missing, try to infer from messageType
                if (
                  msg.messageType === 'research_result' ||
                  msg.messageType === 'intermediate' ||
                  msg.messageType === 'completed'
                ) {
                  sender = 'assistant';
                } else if (msg.messageType === 'user_query') {
                  sender = 'user';
                } else {
                  // Last resort: infer from message content or default to 'user' only if truly unknown
                  // But prefer to preserve what was stored
                  sender = msg.sender || 'user';
                }
              }

              // Preserve messageType exactly as stored - no defaults to maintain formatting
              const messageType = msg.messageType; // Keep undefined if not set, don't default to 'text'

              // Handle timestamp conversion - could be Date, string, or Firestore Timestamp
              let timestamp;
              if (msg.timestamp) {
                if (msg.timestamp instanceof Date) {
                  timestamp = msg.timestamp;
                } else if (typeof msg.timestamp === 'string') {
                  timestamp = new Date(msg.timestamp);
                } else if (msg.timestamp.toDate && typeof msg.timestamp.toDate === 'function') {
                  // Firestore Timestamp object
                  timestamp = msg.timestamp.toDate();
                } else if (msg.timestamp.seconds) {
                  // Firestore Timestamp in serialized form
                  timestamp = new Date(msg.timestamp.seconds * 1000);
                } else {
                  timestamp = new Date(msg.timestamp);
                }
              } else {
                timestamp = new Date();
              }

              return {
                id: msg.id || `restored_${mostRecent.memoryId}_${index}_${Date.now()}`,
                sender: sender, // Preserve exactly as stored
                message: msg.message || '',
                messageType: messageType, // Preserve exactly as stored (may be undefined)
                timestamp: timestamp,
                isStreaming: false,
              };
            });

            // Merge map_snapshot messages for this specific conversation.
            // Snapshots are never written to Firestore — they live in a dedicated
            // per-memoryId localStorage key so there is no cross-conversation bleed.
            const localSnapshots = loadMapSnapshotsForConversation(mostRecent.memoryId);
            const merged = insertSnapshotsByPosition(restoredMessages, localSnapshots);

            // Restore messages
            setMessages(merged);

            // Update dashboard context
            setConversation(merged);

            console.log('✅ Conversation history restored:', {
              messageCount: merged.length,
              snapshotsRestored: localSnapshots.length,
              memoryId: mostRecent.memoryId,
              documentCount: chatLogData.uploadedDocuments?.length || 0,
            });
          } else {
            // No Firestore messages — restore any local map snapshots for this conversation.
            const localSnapshots = loadMapSnapshotsForConversation(mostRecent.memoryId);
            setMessages(localSnapshots);
            setConversation(localSnapshots);
            console.log('📭 No messages found in conversation, but documents may be available');
          }
        } else {
          console.log('📭 No conversation history found for user');
        }
      } catch (error) {
        console.error('❌ Error loading conversation history:', error);
        // Don't throw - just log the error and continue with empty state
      }
    },
    [getUserStorageKey, setConversation, fetchUserConversations, getChatLog, loadAllConversations],
  );

  // Effect: Handle user login/logout/switch and restore conversation history
  useEffect(() => {
    // Don't run until auth is finished loading
    if (authLoading) {
      console.log('⏳ Auth still loading, waiting...');
      return;
    }

    const currentUserId = currentUser?.uid || null;
    const previousUserId = previousUserIdRef.current;

    console.log('🔍 Auth state check:', {
      currentUserId,
      previousUserId,
      authLoading,
      hasCurrentUser: !!currentUser,
    });

    // If user logged out (currentUserId is null but previousUserId was set)
    if (!currentUserId && previousUserId) {
      console.log('🔒 User logged out - clearing chatbot data');
      // Clear all chatbot state
      setMessages([]);
      setConversationId(null);
      setMemoryId(null);
      setLastAssistantMessage(null);
      setUploadedFiles([]); // Clear uploaded files
      setPendingFiles([]); // Clear pending files

      // Clear user-specific localStorage
      clearUserStorage();

      // Clear dashboard context
      setConversation([]);
      setAssistantMessage(null);

      // Reset load attempt flag
      conversationsLoadAttemptedRef.current = false;
    }

    // If user switched (different userId)
    if (currentUserId && previousUserId && currentUserId !== previousUserId) {
      console.log('🔄 User switched - clearing chatbot data for previous user');
      // Clear all chatbot state
      setMessages([]);
      setConversationId(null);
      setMemoryId(null);
      setLastAssistantMessage(null);
      setUploadedFiles([]); // Clear uploaded files
      setPendingFiles([]); // Clear pending files

      // Clear previous user's localStorage
      clearUserStorage();

      // Clear dashboard context
      setConversation([]);
      setAssistantMessage(null);

      // Reset load attempt flag for new user
      conversationsLoadAttemptedRef.current = false;

      // Load new user's conversation history
      console.log('📚 Loading conversation history for switched user:', currentUserId);
      loadUserConversationHistory(currentUserId);
      // Also load all conversations for sidebar
      loadAllConversations(currentUserId);
    }

    // If same user logged back in (currentUserId exists but was null before)
    if (currentUserId && !previousUserId) {
      console.log('👤 User logged in - loading conversation history for:', currentUserId);
      // Reset load attempt flag for new login
      conversationsLoadAttemptedRef.current = false;
      // Load user's conversation history
      loadUserConversationHistory(currentUserId);
      // Also load all conversations for sidebar
      loadAllConversations(currentUserId);
    }

    // Auto-load conversations only once per user session (when chatbot opens and hasn't been attempted)
    if (currentUserId && isOpen && !conversationsLoadAttemptedRef.current && !isLoadingHistory) {
      console.log('🔄 Auto-loading conversations for logged-in user (first time)');
      loadAllConversations(currentUserId);
    }

    // Update previous user ID ref
    previousUserIdRef.current = currentUserId;
  }, [
    currentUser,
    authLoading,
    isOpen,
    clearUserStorage,
    setConversation,
    setAssistantMessage,
    loadUserConversationHistory,
    loadAllConversations,
    isLoadingHistory,
  ]);

  // Format date for display (must be before conditional return)
  const formatDate = useCallback((date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }, []);

  // ── Map snapshot listener ───────────────────────────────────────────────
  // When explore-map fires 'polisense:map_captured', update the last pending
  // map_snapshot message with the real dataUrl, then sync to DashboardContext
  // so the report generator can include it.
  useEffect(() => {
    const handleMapCaptured = async (e) => {
      const { dataUrl } = e.detail || {};
      if (!dataUrl) return;

      // Upload to Firebase Storage for persistence across sessions
      const userId = currentUser?.uid || 'anon';
      const url = await uploadMapSnapshot(dataUrl, { userId, memoryId: memoryId || 'unknown' });

      setMessages((prev) => {
        // Find the most-recent loading snapshot and fill it in
        const updated = [...prev];
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].messageType === 'map_snapshot' && updated[i].mapSnapshot?.loading) {
            updated[i] = {
              ...updated[i],
              mapSnapshot: { ...updated[i].mapSnapshot, url, loading: false },
            };
            break;
          }
        }
        // Persist finalized snapshots for this conversation under its own key.
        // We filter to only completed snapshots (loading:false with a real url)
        // so restoring them later never shows a stuck spinner.
        const finalizedSnapshots = updated.filter(
          (m) =>
            m.messageType === 'map_snapshot' &&
            !m.mapSnapshot?.loading &&
            (m.mapSnapshot?.url || m.mapSnapshot?.dataUrl),
        );
        if (memoryId) saveMapSnapshots(memoryId, finalizedSnapshots);
        // Sync the complete updated list (including snapshot) to context immediately
        setConversation(updated);
        setTimeout(() => saveConversationToStorage(updated), 0);
        return updated;
      });
    };
    window.addEventListener('polisense:map_captured', handleMapCaptured);
    return () => window.removeEventListener('polisense:map_captured', handleMapCaptured);
  }, [saveConversationToStorage, setConversation, currentUser, memoryId]);

  // Format file size for display
  const formatFileSize = useCallback((bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }, []);

  // Function to create a new conversation
  const createNewConversation = useCallback(() => {
    if (!currentUser?.uid) {
      console.warn('Cannot create conversation: user not logged in');
      return;
    }

    try {
      // Generate new memoryId
      const newMemoryId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Clear current conversation state (including all UI state that could block the view)
      setMessages([]);
      setConversationId(null);
      setMemoryId(newMemoryId);
      setLastAssistantMessage(null);
      setUploadedFiles([]);
      setPendingFiles([]);
      setViewingMetadata(null); // Clear any open metadata view
      setIsLoading(false); // Reset loading state from previous conversation
      setSpinnerActive(false); // Reset spinner state
      setHasReceivedFirstResponse(false); // Reset first response tracking
      setInputMessage(''); // Clear any typed input
      setShowHistorySidebar(false); // Close history sidebar if open
      setShowDatasetDropdown(false); // Close dataset dropdown if open
      setSelectedDatasets([]); // Clear selected datasets
      setActiveDatasets([]); // Clear active datasets
      setDatasetContext([]); // Clear dataset context

      // Save to user-specific localStorage
      if (typeof window !== 'undefined') {
        try {
          const storageKey = getUserStorageKey('research-chatbot-memory-id');
          localStorage.setItem(storageKey, newMemoryId);
        } catch (error) {
          console.warn('Error saving to localStorage:', error);
        }
      }

      // Clear dashboard context
      setConversation([]);
      setAssistantMessage(null);

      // Don't create conversation in Firestore eagerly - it will be created
      // automatically when the first message is sent in sendChatMessage().
      // Calling researchAPI.conversation() here with an empty chatLog can
      // trigger WebSocket responses that override the just-cleared state,
      // causing the UI to not reflect the new empty conversation.
      console.log('✅ New conversation ready:', newMemoryId);

      // Reload conversation list
      if (currentUser.uid) {
        setTimeout(() => {
          loadAllConversations(currentUser.uid);
        }, 500);
      }

      // Focus the input field for immediate typing
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 0);
    } catch (error) {
      console.error('Error creating new conversation:', error);
    }
  }, [currentUser, getUserStorageKey, setConversation, setAssistantMessage, loadAllConversations]);

  // Function to delete a conversation

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div ref={dropdownRef} className={`research-chatbot-dropdown ${className}`}>
      <div className="research-chatbot-container">
        {/* Close Button - Top Right Corner */}
        <button
          className="research-chatbot-close-btn"
          onClick={onClose}
          title="Close chatbot"
          aria-label="Close chatbot"
        >
          ✕
        </button>

        {/* Conversation History Panel - Top */}
        {showHistorySidebar && currentUser && (
          <div className="research-chatbot-history-panel">
            <div className="research-chatbot-history-list">
              {isLoadingHistory ? (
                <div className="research-chatbot-history-loading">Loading...</div>
              ) : conversationHistory.length === 0 ? (
                <div className="research-chatbot-history-empty">No conversations yet</div>
              ) : (
                conversationHistory.map((conv) => (
                  <div
                    key={conv.memoryId}
                    className={`research-chatbot-history-item ${
                      conv.memoryId === memoryId ? 'research-chatbot-history-item-active' : ''
                    }`}
                    onClick={() => {
                      loadConversationFromHistory(conv.memoryId);
                    }}
                  >
                    <div className="research-chatbot-history-item-title">
                      {(() => {
                        const title =
                          conv.conversationTitle || conv.lastUserMessage || 'Untitled Conversation';
                        // Truncate to 50 characters to save space
                        return title.length > 50 ? title.substring(0, 50) + '...' : title;
                      })()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* History Sidebar Toggle Button */}
        {currentUser && (
          <button
            className="research-chatbot-history-toggle"
            onClick={() => {
              const newState = !showHistorySidebar;
              setShowHistorySidebar(newState);
              if (newState) {
                // Always reload when opening to ensure fresh data
                loadAllConversations(currentUser.uid);
              }
            }}
            title="Show conversation history"
            aria-label="Show conversation history"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: 'inline-block', verticalAlign: 'middle' }}
            >
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </button>
        )}

        {/* Tab Bar */}
        <div className="research-chatbot-tabs">
          <button
            className={`research-chatbot-tab ${
              activeTab === 'chat' ? 'research-chatbot-tab-active' : ''
            }`}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button
            className={`research-chatbot-tab ${
              activeTab === 'documents' ? 'research-chatbot-tab-active' : ''
            }`}
            onClick={() => setActiveTab('documents')}
          >
            Documents{' '}
            {uploadedFiles.filter((f) => !f.isMetadata).length > 0 &&
              `(${uploadedFiles.filter((f) => !f.isMetadata).length})`}
          </button>
        </div>

        {/* Messages — shown only in Chat tab */}
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className={`research-chatbot-messages ${
            showHistorySidebar ? 'research-chatbot-messages-with-panel' : ''
          } ${activeTab !== 'chat' ? 'research-chatbot-tab-hidden' : ''}`}
        >
          {/* No filtering by spinnerActive — each ingestion message owns its own
              lifecycle (pdf_rag → completed/error). See CHATBOT_UI_STYLE.md. */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`research-chatbot-message research-chatbot-message-${msg.sender} ${
                msg.messageType === 'research_result' ? 'research-chatbot-message-research' : ''
              } ${
                msg.messageType === 'intermediate' ||
                msg.messageType === 'completed' ||
                msg.messageType === 'geojson' ||
                msg.messageType === 'geojson_rag' ||
                msg.messageType === 'json_rag' ||
                msg.messageType === 'pdf_rag' ||
                msg.messageType === 'web_search' ||
                msg.messageType === 'code_interpreter' ||
                msg.messageType === 'file_search'
                  ? 'research-chatbot-message-intermediate'
                  : ''
              } ${msg.messageType === 'error' ? 'research-chatbot-message-error' : ''}`}
            >
              <div className="research-chatbot-message-content">
                {/* Terminal tree-style tool rows for all agent activity */}
                {msg.messageType === 'intermediate' ||
                msg.messageType === 'geojson_rag' ||
                msg.messageType === 'json_rag' ||
                msg.messageType === 'pdf_rag' ||
                msg.messageType === 'web_search' ||
                msg.messageType === 'code_interpreter' ||
                msg.messageType === 'file_search' ? (
                  // In-flight tool row: spinner first, then turquoise subject.
                  // One uniform layout for every "agent is working" event —
                  // no name chip, no icon, no trailing status. See
                  // CHATBOT_UI_STYLE.md for the canonical anatomy.
                  <div className="rcc-tool-row rcc-tool-row--running">
                    <SpinnerChar color="#4effd0" />
                    <span className="rcc-tool-subject">{msg.message}</span>
                  </div>
                ) : msg.messageType === 'completed' ? (
                  <div className="rcc-tool-row rcc-tool-row--done">
                    <span className="rcc-tool-subject">{msg.message}</span>
                  </div>
                ) : msg.messageType === 'geojson' ? (
                  <div className="rcc-tool-row rcc-tool-row--done">
                    <span className="rcc-tool-subject">{msg.message}</span>
                  </div>
                ) : msg.messageType === 'map_snapshot' ? (
                  <div className="research-chatbot-map-snapshot">
                    {msg.mapSnapshot?.loading ? (
                      <div className="research-chatbot-map-snapshot__loading">
                        <svg
                          className="progress-ring"
                          width="20"
                          height="20"
                          style={{ verticalAlign: 'middle', marginRight: 8 }}
                        >
                          <circle
                            className="progress-ring__circle"
                            stroke="#4effd0"
                            strokeWidth="2"
                            fill="transparent"
                            r="7"
                            cx="10"
                            cy="10"
                          />
                        </svg>
                        <span style={{ color: '#aaa', fontSize: 20 }}>
                          Capturando vista del mapa…
                        </span>
                      </div>
                    ) : msg.mapSnapshot?.url || msg.mapSnapshot?.dataUrl ? (
                      <div className="research-chatbot-map-snapshot__card">
                        <img
                          src={msg.mapSnapshot.url || msg.mapSnapshot.dataUrl}
                          alt={`Mapa — ${msg.mapSnapshot.place || 'resultados geoespaciales'}`}
                          style={{
                            width: '100%',
                            maxWidth: 460,
                            borderRadius: 8,
                            border: '1px solid rgba(255,255,255,0.12)',
                            display: 'block',
                            marginBottom: 6,
                          }}
                        />
                        <div style={{ fontSize: 16, color: '#888', marginTop: 4 }}>
                          {msg.mapSnapshot.place && (
                            <strong style={{ color: '#ccc' }}>
                              {msg.mapSnapshot.place}
                            </strong>
                          )}
                          {msg.mapSnapshot.count != null && (
                            <span style={{ marginLeft: 6 }}>
                              · {msg.mapSnapshot.count} concesión
                              {msg.mapSnapshot.count !== 1 ? 'es' : ''}
                            </span>
                          )}
                          {msg.mapSnapshot.radiusKm > 0 && (
                            <span style={{ marginLeft: 6 }}>
                              · radio {msg.mapSnapshot.radiusKm} km
                            </span>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : msg.messageType === 'analysis_panel' ? (
                  // ── Deep-analysis panel: embedded Plotly chart only ──
                  // Explanation text is streamed as regular chat text before this widget.
                  <div className="research-chatbot-analysis-panel">
                    <div className="research-chatbot-analysis-panel__header">
                      <span className="research-chatbot-analysis-panel__index">
                        {msg.analysisPanel?.index}/{msg.analysisPanel?.total}
                      </span>
                      <span className="research-chatbot-analysis-panel__title">
                        {msg.analysisPanel?.title}
                      </span>
                    </div>
                    {msg.analysisPanel?.html && (
                      <div className="research-chatbot-analysis-panel__chart">
                        <iframe
                          srcDoc={msg.analysisPanel.html}
                          title={msg.analysisPanel.title}
                          sandbox="allow-scripts allow-same-origin"
                          style={{
                            width: '100%',
                            height: 520,
                            border: 'none',
                            borderRadius: 6,
                            background: '#fff',
                            display: 'block',
                          }}
                          loading="lazy"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  (() => {
                    // Check if message contains markdown formatting
                    const messageText = (msg.message || '').trim();
                    const hasMarkdown =
                      messageText.includes('**') ||
                      (messageText.includes('*') && messageText.split('*').length > 2) ||
                      messageText.includes('###') ||
                      messageText.includes('##') ||
                      messageText.includes('# ') ||
                      (messageText.includes('- ') && messageText.split('- ').length > 2) ||
                      messageText.includes('1. ') ||
                      messageText.includes('2. ');

                    // Use MessageRenderer for:
                    // 1. Non-user messages (assistant, system, undefined)
                    // 2. Messages with markdown formatting (even if sender is 'user', it might be incorrectly set)
                    // 3. Long messages that look like assistant responses
                    const shouldUseMessageRenderer =
                      msg.sender !== 'user' ||
                      hasMarkdown ||
                      (messageText.length > 200 &&
                        !messageText.toLowerCase().startsWith('what') &&
                        !messageText.toLowerCase().startsWith('how') &&
                        !messageText.toLowerCase().startsWith('why'));

                    if (shouldUseMessageRenderer) {
                      return (
                        <div className="research-chatbot-research-content">
                          <MessageRenderer
                            message={msg.message || ''}
                            sender={msg.sender || 'assistant'}
                          />
                        </div>
                      );
                    } else {
                      // User messages are displayed as plain text
                      return <div style={{ whiteSpace: 'pre-wrap' }}>{msg.message}</div>;
                    }
                  })()
                )}
                {msg.isStreaming && <span className="research-chatbot-streaming-indicator">▋</span>}
              </div>

              {/* Only show timestamp for non-intermediate messages */}
              {msg.messageType !== 'intermediate' &&
                msg.messageType !== 'completed' &&
                msg.messageType !== 'geojson' &&
                msg.messageType !== 'geojson_rag' &&
                msg.messageType !== 'json_rag' &&
                msg.messageType !== 'web_search' &&
                msg.messageType !== 'code_interpreter' &&
                msg.messageType !== 'file_search' &&
                msg.messageType !== 'analysis_panel' && (
                  <div className="research-chatbot-message-time">
                    {msg.timestamp?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
            </div>
          ))}

          {/* Spinner verb — shown only while waiting for first bot output */}
          {isLoading && spinnerVerb && !messages.some(m => m.isStreaming) &&
            !messages.slice(-3).some(m => m.messageType === 'web_search' || m.messageType === 'code_interpreter' || m.messageType === 'file_search' || m.messageType === 'intermediate') && (
            <div className="rcc-spinner-verb-row">
              <SpinnerChar color="#4effd0" />
              <span className="rcc-spinner-verb-text">{spinnerVerb}…</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Documents Tab Panel */}
        {activeTab === 'documents' && (
          <div
            className={`research-chatbot-documents-panel${isDraggingOver ? ' rcc-drop-active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDraggingOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              const files = Array.from(e.dataTransfer.files);
              if (files.length > 0) handleDroppedFiles(files);
            }}
          >
            {isDraggingOver && (
              <div className="rcc-drop-overlay">
                <div className="rcc-drop-overlay-icon">📂</div>
                <div className="rcc-drop-overlay-text">Drop files to upload</div>
                <div className="rcc-drop-overlay-types">
                  Accepted: {ACCEPTED_FILE_TYPES_LABEL}
                </div>
              </div>
            )}
            {uploadedFiles.filter((f) => !f.isMetadata).length === 0 ? (
              <div className="research-chatbot-documents-empty">
                <div className="research-chatbot-documents-empty-icon">📄</div>
                <div className="research-chatbot-documents-empty-text">
                  No documents uploaded yet
                </div>
                <div className="research-chatbot-documents-empty-hint">
                  Drop files here or use the upload button in the Chat tab
                </div>
              </div>
            ) : (
              <div className="research-chatbot-documents-list">
                {uploadedFiles
                  .filter((f) => !f.isMetadata)
                  .map((file) => (
                    <div key={file.id} className="research-chatbot-document-item">
                      <div className="research-chatbot-document-icon">
                        {file.name.endsWith('.pdf') || file.type?.includes('pdf')
                          ? '📕'
                          : file.type?.startsWith('image/')
                          ? '🖼️'
                          : file.name.endsWith('.doc') || file.name.endsWith('.docx')
                          ? '📘'
                          : file.name.endsWith('.xlsx') ||
                            file.name.endsWith('.xls') ||
                            file.name.endsWith('.csv')
                          ? '📊'
                          : file.name.endsWith('.geojson')
                          ? '🗺️'
                          : file.name.endsWith('.json')
                          ? '📋'
                          : file.name.endsWith('.txt')
                          ? '📄'
                          : '📎'}
                      </div>
                      <div className="research-chatbot-document-info">
                        <div className="research-chatbot-document-name">{file.name}</div>
                        <div className="research-chatbot-document-meta">
                          <span>{formatFileSize(file.size)}</span>
                          {file.uploadTime &&
                            file.uploadTime instanceof Date &&
                            !isNaN(file.uploadTime) && (
                              <>
                                <span>•</span>
                                <span>{file.uploadTime.toLocaleDateString()}</span>
                              </>
                            )}
                        </div>
                        {(() => {
                          const status = file.extractionStatus;
                          const isReady = status === 'rag_ready' || status === 'completed';
                          const isFailed = status === 'failed';
                          if (isFailed) {
                            return (
                              <div className="research-chatbot-document-status research-chatbot-document-status-failed">
                                ✗ Processing failed
                              </div>
                            );
                          }
                          if (!isReady) {
                            return (
                              <div className="research-chatbot-document-status">
                                <span className="research-chatbot-document-spinner">⟳</span>
                                {' '}Processing…
                              </div>
                            );
                          }
                          return (
                            <button
                              className={`research-chatbot-download-button ${
                                downloadingId === file.id
                                  ? 'research-chatbot-download-button-loading'
                                  : ''
                              }`}
                              disabled={downloadingId === file.id}
                              onClick={async () => {
                                setDownloadError((prev) => ({ ...prev, [file.id]: null }));
                                setDownloadingId(file.id);
                                try {
                                  await downloadDocument(memoryId, file.id, file.name);
                                } catch (err) {
                                  let msg = 'Download failed';
                                  try {
                                    const blob = err?.response?.data;
                                    if (blob instanceof Blob) {
                                      const text = await blob.text();
                                      msg = JSON.parse(text)?.error || msg;
                                    }
                                  } catch {
                                    /* ignore parse error */
                                  }
                                  setDownloadError((prev) => ({ ...prev, [file.id]: msg }));
                                } finally {
                                  setDownloadingId(null);
                                }
                              }}
                              title={`Download ${file.name}`}
                            >
                              {downloadingId === file.id ? '...' : 'Download'}
                            </button>
                          );
                        })()}
                        {downloadError[file.id] && (
                          <div className="research-chatbot-download-error">
                            {downloadError[file.id]}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Status bar — only visible while the bot is running */}
        {activeTab === 'chat' && isLoading && (
          <div className="rcc-status-bar rcc-status-bar--running">
            <span className="rcc-status-dot" />
            <span className="rcc-status-label">Running</span>
            {(() => {
              const activeCount = messages.filter(m =>
                m.messageType === 'intermediate' || m.messageType === 'web_search' || m.messageType === 'code_interpreter' || m.messageType === 'file_search'
              ).length;
              return activeCount > 0 ? (
                <span className="rcc-status-detail">· {activeCount} step{activeCount !== 1 ? 's' : ''} active</span>
              ) : null;
            })()}
          </div>
        )}

        {/* Input Section — hidden when Documents tab is active */}
        <div
          className={`research-chatbot-input-container ${
            activeTab !== 'chat' ? 'research-chatbot-tab-hidden' : ''
          }`}
        >
          {/* Connection errors are handled silently - WebSocket reconnects automatically */}

          {(selectedDatasets.length > 0 || pendingFiles.length > 0) && (
            <div className="research-chatbot-tokens-container">
              <div className="research-chatbot-tokens-list">
                {/* Dataset tokens */}
                {selectedDatasets.map((selectedItem, index) => {
                  // Use the display name for tokens
                  const shortName = selectedItem.shortName;
                  return (
                    <span
                      key={`dataset-${index}`}
                      className="research-chatbot-token research-chatbot-token-dataset"
                    >
                      @{shortName}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          removeDataset(selectedItem);
                        }}
                        className="research-chatbot-token-remove"
                        title={`Remove ${getDatasetDisplayName(selectedItem.dataset)}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}

                {/* File tokens - only show pending files (not yet sent) */}
                {pendingFiles.map((file) => {
                  // Extract filename without extension for token display
                  const fileName = file.name.replace(/\.[^/.]+$/, '');
                  return (
                    <span
                      key={`file-${file.id}`}
                      className="research-chatbot-token research-chatbot-token-file"
                    >
                      @{fileName}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          removeUploadedFile(file);
                        }}
                        className="research-chatbot-token-remove"
                        title={`Remove ${file.name}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {isRagInProgress && (
            <div className="research-chatbot-rag-banner">
              <svg className="progress-ring" width="14" height="14">
                <circle
                  className="progress-ring__circle"
                  stroke="#4effd0"
                  strokeWidth="2"
                  fill="transparent"
                  r="5"
                  cx="7"
                  cy="7"
                />
              </svg>
              Processing document — chat will be available once indexing is complete
            </div>
          )}

          <div className="research-chatbot-input-wrapper">
            <div className="research-chatbot-input-row">
              <div className="research-chatbot-input-area">
                <textarea
                  ref={inputRef}
                  value={inputMessage}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  onKeyDown={undefined}
                  placeholder={
                    !isConnected
                      ? 'Connecting...'
                      : isRagInProgress
                      ? 'Processing document — available when indexing completes...'
                      : textInputLabel
                  }
                  disabled={!isConnected || isLoading || isInitializing || isRagInProgress}
                  className="research-chatbot-input"
                  style={{
                    minHeight: '140px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                  }}
                />

                {/* Dataset autocomplete dropdown */}
                {showDatasetDropdown && filteredDatasets.length > 0 && (
                  <div className="dataset-dropdown">
                    <div
                      style={{
                        padding: '8px 12px',
                        fontSize: '16px',
                        fontWeight: '600',
                        color: '#333',
                        borderBottom: '1px solid #eee',
                        background: '#f8f9fa',
                      }}
                    >
                      Available datasets ({filteredDatasets.length})
                    </div>
                    {filteredDatasets.map((dataset, index) => {
                      const isCatastro = dataset._isCatastro;
                      return (
                        <div
                          key={dataset.id}
                          className={classnames('dataset-option', {
                            '-active': selectedDatasetIndex === index,
                          })}
                          onClick={() => selectDataset(dataset)}
                          onMouseEnter={() => setSelectedDatasetIndex(index)}
                          style={
                            isCatastro
                              ? {
                                  borderBottom: '2px solid #e5e7eb',
                                  background:
                                    selectedDatasetIndex === index ? '#f0fdf4' : '#f9fafb',
                                }
                              : {}
                          }
                        >
                          <div style={{ flex: 1 }}>
                            <div
                              className="dataset-name"
                              style={isCatastro ? { fontWeight: 600, color: '#166534' } : {}}
                            >
                              {isCatastro && <span style={{ marginRight: 6 }}>🗺️</span>}
                              {getDatasetDisplayName(dataset)}
                            </div>
                            {isCatastro && (
                              <div style={{ fontSize: '15px', color: '#6b7280', marginTop: 2 }}>
                                Indexar en RAG — INGEMMET GEOCATMIN
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="research-chatbot-actions">
                <button
                  onClick={triggerFileUpload}
                  disabled={!isConnected || isLoading || isInitializing || isRagInProgress}
                  className="research-chatbot-action-button research-chatbot-action-button-upload"
                  aria-label="Upload documents"
                >
                  {isLoading ? '•' : '•'}
                </button>
                <button
                  onClick={sendChatMessage}
                  disabled={
                    !isConnected ||
                    isLoading ||
                    !inputMessage.trim() ||
                    isInitializing ||
                    isRagInProgress
                  }
                  className="research-chatbot-action-button research-chatbot-action-button-send"
                  aria-label="Send message"
                >
                  {isLoading ? '•' : '→'}
                </button>
                <button
                  className="research-chatbot-action-button research-chatbot-action-button-new"
                  onClick={createNewConversation}
                  title="Create new conversation"
                  aria-label="Create new conversation"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.xlsm,.xlsb,.xltx,.xltm,.ppt,.pptx,.md,.rtf,.html,.htm,.jpg,.jpeg,.png,.gif,.bmp,.webp,.svg,.geojson,.json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      <style jsx>{`
        .research-chatbot-dropdown {
          position: fixed;
          top: 70px; /* Start 15px below header (55px header + 15px gap) */
          right: 15px; /* Position unchanged - panel expands to the left */
          z-index: 9999;
          width: calc(
            837px + 353px
          ); /* Increased by 30px: 173px -> 203px (1040px total, expands left) */
          max-width: calc(100vw - 16px); /* Account for 8px margin on each side */
        }

        .research-chatbot-container {
          background: #44546a;
          backdrop-filter: blur(8px);
          border-radius: 15px;
          box-shadow: 0 10px 40px rgba(68, 84, 106, 0.3);
          width: 100%;
          height: calc(100vh - 90px); /* Account for 15px gap: 75px + 15px = 90px */
          max-height: calc(100vh - 90px); /* Ensure it reaches near bottom with gap */
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 3px solid #4effd0; // Turquoise border for modern look (scaled proportionally)
          position: relative; // For absolute positioning of floating actions
        }

        .research-chatbot-close-btn {
          position: absolute;
          bottom: 0px;
          right: 0px;
          background: rgba(78, 255, 208, 0.15);
          border: 1px solid #4effd0;
          border-radius: 12px;
          width: 35px;
          height: 35px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 33px;
          color: #ffffff;
          z-index: 10;
          transition: all 0.2s ease;
        }

        .research-chatbot-close-btn:hover {
          background: rgba(78, 255, 208, 0.25);
          border-color: #4effd0;
          transform: scale(1.1);
          box-shadow: 0 0 15px rgba(78, 255, 208, 0.4);
        }

        .research-chatbot-close-btn:active {
          background: rgba(255, 255, 255, 0.3);
          transform: scale(0.95);
        }

        /* ── Tab Bar ──────────────────────────────────────────────────── */
        .research-chatbot-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.15);
          flex-shrink: 0;
        }

        .research-chatbot-tab {
          flex: 1;
          padding: 8px 0;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: rgba(255, 255, 255, 0.5);
          font-size: 18px;
          font-weight: 800;
          cursor: pointer;
          letter-spacing: 0.03em;
          transition: color 0.15s, border-color 0.15s;
        }

        .research-chatbot-tab:hover {
          color: rgba(255, 255, 255, 0.8);
        }

        .research-chatbot-tab-active {
          color: #4effd0;
          border-bottom-color: #4effd0;
        }

        .research-chatbot-tab-hidden {
          display: none !important;
        }

        /* ── Documents Panel ──────────────────────────────────────────── */
        .research-chatbot-documents-panel {
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
          position: relative;
          transition: background 0.15s;
        }
        .research-chatbot-documents-panel.rcc-drop-active {
          background: rgba(78, 255, 208, 0.07);
          outline: 2px dashed rgba(78, 255, 208, 0.5);
          outline-offset: -6px;
        }
        .rcc-drop-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          pointer-events: none;
          z-index: 10;
        }
        .rcc-drop-overlay-icon {
          font-size: 36px;
        }
        .rcc-drop-overlay-text {
          font-size: 15px;
          font-weight: 500;
          color: #4effd0;
        }
        .rcc-drop-overlay-types {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.55);
          max-width: 86%;
          text-align: center;
          line-height: 1.5;
          letter-spacing: 0.2px;
        }

        .research-chatbot-documents-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 40px 20px;
          color: rgba(255, 255, 255, 0.4);
          text-align: center;
        }

        .research-chatbot-documents-empty-icon {
          font-size: 32px;
        }
        .research-chatbot-documents-empty-text {
          font-size: 14px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.6);
        }
        .research-chatbot-documents-empty-hint {
          font-size: 12px;
        }

        .research-chatbot-documents-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .research-chatbot-document-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          transition: background 0.15s;
        }

        .research-chatbot-document-item:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .research-chatbot-document-icon {
          font-size: 22px;
          flex-shrink: 0;
        }

        .research-chatbot-document-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .research-chatbot-document-name {
          font-size: 14px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .research-chatbot-document-meta {
          font-size: 22px;
          color: rgba(255, 255, 255, 0.4);
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .research-chatbot-download-button {
          margin-top: 5px;
          padding: 4px 12px;
          background: rgba(78, 255, 208, 0.12);
          border: 1px solid rgba(78, 255, 208, 0.3);
          border-radius: 5px;
          color: #4effd0;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          width: fit-content;
          transition: background 0.15s, border-color 0.15s;
        }

        .research-chatbot-download-button:hover:not(:disabled) {
          background: rgba(78, 255, 208, 0.22);
          border-color: rgba(78, 255, 208, 0.6);
        }

        .research-chatbot-download-button-loading,
        .research-chatbot-download-button:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .research-chatbot-download-error {
          font-size: 10px;
          color: #ff6b6b;
          margin-top: 3px;
          max-width: 200px;
          line-height: 1.3;
        }

        .research-chatbot-document-status {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.55);
          margin-top: 4px;
          font-style: italic;
        }
        .research-chatbot-document-status-failed {
          color: #ff6b6b;
          font-style: normal;
        }
        .research-chatbot-document-spinner {
          display: inline-block;
          animation: rcc-doc-spin 1s linear infinite;
        }
        @keyframes rcc-doc-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .messages-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 14px;
          color: #666;
          font-size: 18px;
        }

        /* Create Dashboard button moved to header dropdown */

        .research-chatbot-clear {
          background: rgba(255, 255, 255, 0.1); // Subtle background like header
          border: 1px solid #ffffff; // White border like header
          font-size: 18px;
          cursor: pointer;
          color: #ffffff; // Pure white like header
          padding: 5px 10px;
          border-radius: 6px;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 300; // Light weight like Climate TRACE
          text-transform: uppercase; // Uppercase like Climate TRACE
          letter-spacing: 0.3px; // Letter spacing like Climate TRACE
        }

        .research-chatbot-clear:hover {
          background: rgba(255, 255, 255, 0.2); // Subtle hover like header
          color: #ffffff;
          border-color: #ffffff;
        }

        .research-chatbot-close {
          background: rgba(255, 255, 255, 0.1); // Subtle background like header
          border: 1px solid #ffffff; // White border like header
          font-size: 30px;
          cursor: pointer;
          color: #ffffff; // Pure white like header
          padding: 5px;
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          transition: all 0.2s ease;
        }

        .research-chatbot-close:hover {
          background: rgba(255, 255, 255, 0.2); // Subtle hover like header
          color: #ffffff;
        }

        .research-chatbot-messages {
          flex: 1;
          overflow-y: auto;
          padding: 10px 14px 8px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: #44546a;
          backdrop-filter: blur(8px);
          transition: height 0.3s ease;
        }

        .research-chatbot-messages-with-panel {
          height: calc(100% - 200px);
        }

        .research-chatbot-history-toggle {
          position: absolute;
          top: 0px;
          right: 12px;
          background: rgba(78, 255, 208, 0.15);
          border: 1px solid #4effd0;
          border-radius: 10px;
          width: 46px;
          height: 46px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 10;
          transition: all 0.2s ease;
        }

        .research-chatbot-history-toggle svg {
          width: 24px;
          height: 24px;
        }

        .research-chatbot-history-toggle:hover {
          background: rgba(78, 255, 208, 0.25);
          transform: scale(1.1);
        }

        .research-chatbot-history-panel {
          width: 100%;
          max-height: 250px;
          background: rgba(40, 50, 65, 0.95);
          backdrop-filter: blur(8px);
          border-bottom: 1px solid rgba(78, 255, 208, 0.2);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          z-index: 5;
        }

        .research-chatbot-history-list {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 10px;
          display: flex;
          flex-direction: row;
          gap: 10px;
          flex-wrap: wrap;
        }

        .research-chatbot-history-loading,
        .research-chatbot-history-empty {
          padding: 14px;
          text-align: center;
          color: rgba(255, 255, 255, 0.6);
          font-size: 18px;
        }

        .research-chatbot-history-item {
          padding: 8px 10px;
          margin-bottom: 6px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 1px solid transparent;
          min-width: 180px;
          max-width: 280px;
          flex: 0 0 auto;
        }

        .research-chatbot-history-item:hover {
          background: rgba(78, 255, 208, 0.1);
          border-color: rgba(78, 255, 208, 0.3);
        }

        .research-chatbot-history-item-active {
          background: rgba(78, 255, 208, 0.15);
          border-color: rgba(78, 255, 208, 0.5);
        }

        .research-chatbot-history-item-title {
          color: #ffffff;
          font-size: 18px;
          font-weight: 500;
          margin-bottom: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .research-chatbot-history-item-meta {
          color: rgba(255, 255, 255, 0.5);
          font-size: 15px;
          display: flex;
          gap: 6px;
          margin-bottom: 3px;
        }

        .research-chatbot-history-item-preview {
          color: rgba(255, 255, 255, 0.6);
          font-size: 15px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          margin-top: 3px;
        }

        /* (Documents drawer moved to header — see header-documents/component.jsx) */
        .research-chatbot-documents {
          flex: 1;
          overflow-y: auto;
          padding: 31px;
          display: flex;
          flex-direction: column;
          background: #44546a;
          backdrop-filter: blur(8px);
        }

        .research-chatbot-documents-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 31px;
          padding-bottom: 21px;
          border-bottom: 1px solid rgba(78, 255, 208, 0.2);
        }

        .research-chatbot-documents-header h3 {
          color: #ffffff;
          font-size: 40px;
          font-weight: 500;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .research-chatbot-documents-count {
          color: rgba(255, 255, 255, 0.6);
          font-size: 30px;
          font-weight: 300;
        }

        .research-chatbot-documents-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px 20px;
          text-align: center;
        }

        .research-chatbot-documents-empty-icon {
          font-size: 48px;
          margin-bottom: 21px;
          opacity: 0.5;
        }

        .research-chatbot-documents-empty-text {
          color: rgba(255, 255, 255, 0.8);
          font-size: 16px;
          font-weight: 400;
          margin-bottom: 10px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .research-chatbot-documents-empty-hint {
          color: rgba(255, 255, 255, 0.5);
          font-size: 13px;
          font-weight: 300;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .research-chatbot-documents-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .research-chatbot-document-item {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 20px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          transition: all 0.2s ease;
        }

        .research-chatbot-document-item:hover {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(78, 255, 208, 0.3);
        }

        .research-chatbot-document-icon {
          font-size: 28px;
          flex-shrink: 0;
        }

        .research-chatbot-document-info {
          flex: 1;
          min-width: 0;
        }

        .research-chatbot-document-name {
          color: #ffffff;
          font-size: 14px;
          font-weight: 400;
          margin-bottom: 8px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          word-break: break-word;
        }

        .research-chatbot-document-meta {
          color: rgba(255, 255, 255, 0.5);
          font-size: 12px;
          display: flex;
          gap: 10px;
          align-items: center;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .research-chatbot-document-remove {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.6);
          width: 37px;
          height: 37px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          flex-shrink: 0;
          padding: 0;
        }

        .research-chatbot-document-remove:hover {
          background: rgba(239, 68, 68, 0.2);
          border-color: rgba(239, 68, 68, 0.5);
          color: #ffffff;
        }

        /* AI Extraction Button */
        .research-chatbot-extract-button {
          margin-top: 10px;
          padding: 8px 15px;
          background: rgba(78, 255, 208, 0.15);
          border: 1px solid rgba(78, 255, 208, 0.4);
          color: #4effd0;
          border-radius: 8px;
          cursor: pointer;
          font-size: 22px;
          font-weight: 500;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .research-chatbot-extract-button:hover {
          background: rgba(78, 255, 208, 0.25);
          border-color: rgba(78, 255, 208, 0.6);
          transform: translateY(-1px);
        }

        /* Extraction Progress Bar */
        .research-chatbot-extraction-progress {
          margin-top: 8px;
          width: 100%;
        }

        .research-chatbot-extraction-progress-bar {
          width: 100%;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 5px;
        }

        .research-chatbot-extraction-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4effd0, #00d4ff);
          border-radius: 3px;
          transition: width 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .research-chatbot-extraction-progress-fill::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
          animation: shimmer 2s infinite;
        }

        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        .research-chatbot-extraction-progress-text {
          color: rgba(78, 255, 208, 0.8);
          font-size: 21px;
          font-weight: 500;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        /* Extraction Error State */
        .research-chatbot-extraction-error {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 15px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          margin-top: 10px;
          font-size: 22px;
        }

        .research-chatbot-extraction-error-icon {
          color: #ef4444;
          font-size: 27px;
          flex-shrink: 0;
        }

        .research-chatbot-extraction-error-message {
          color: rgba(255, 255, 255, 0.9);
          flex: 1;
          word-break: break-word;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .research-chatbot-extraction-retry-button {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #ffffff;
          padding: 5px 15px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 21px;
          font-weight: 500;
          transition: all 0.2s ease;
          flex-shrink: 0;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .research-chatbot-extraction-retry-button:hover {
          background: rgba(239, 68, 68, 0.3);
          border-color: rgba(239, 68, 68, 0.6);
        }

        /* Metadata File Item Styling */
        .research-chatbot-document-item-metadata {
          margin-left: 40px;
          background: rgba(78, 255, 208, 0.05);
          border-color: rgba(78, 255, 208, 0.2);
          border-left: 4px solid rgba(78, 255, 208, 0.4);
        }

        .research-chatbot-document-item-metadata:hover {
          background: rgba(78, 255, 208, 0.08);
          border-color: rgba(78, 255, 208, 0.3);
        }

        .research-chatbot-metadata-badge {
          background: rgba(78, 255, 208, 0.2);
          color: #4effd0;
          padding: 3px 8px;
          border-radius: 5px;
          font-size: 20px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .research-chatbot-view-metadata-button {
          margin-top: 10px;
          padding: 8px 15px;
          background: rgba(78, 255, 208, 0.15);
          border: 1px solid rgba(78, 255, 208, 0.4);
          color: #4effd0;
          border-radius: 8px;
          cursor: pointer;
          font-size: 22px;
          font-weight: 500;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .research-chatbot-view-metadata-button:hover {
          background: rgba(78, 255, 208, 0.25);
          border-color: rgba(78, 255, 208, 0.6);
          transform: translateY(-1px);
        }

        /* Document Type Checklist */
        .research-chatbot-document-checklist {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .research-chatbot-checklist-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .research-chatbot-checklist-header {
          color: #ffffff;
          font-size: 27px;
          font-weight: 500;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          line-height: 1.4;
          margin-bottom: 5px;
        }

        .research-chatbot-checklist-criterion {
          color: rgba(255, 255, 255, 0.85);
          font-size: 22px;
          font-weight: 400;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          line-height: 1.5;
          padding-left: 10px;
          margin-top: 5px;
        }

        .research-chatbot-checklist-criterion-error {
          color: #ff6b6b;
          font-weight: 500;
        }

        .research-chatbot-checklist-error {
          color: #ff6b6b;
          font-size: 22px;
          font-weight: 500;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-style: italic;
          padding: 5px 10px;
          background: rgba(255, 107, 107, 0.15);
          border-left: 4px solid #ff6b6b;
          border-radius: 5px;
          margin: 5px 0;
        }

        .research-chatbot-metadata-modal-overlay {
          display: none;
        }

        .research-chatbot-metadata-modal {
          background: #44546a;
          border-radius: 15px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          width: 100%;
          max-width: 1000px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          border: 3px solid #4effd0;
        }

        .research-chatbot-metadata-modal-header {
          padding: 25px;
          border-bottom: 1px solid rgba(78, 255, 208, 0.3);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .research-chatbot-metadata-modal-header h3 {
          margin: 0;
          color: #ffffff;
          font-size: 36px;
          font-weight: 600;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .research-chatbot-metadata-modal-close {
          background: rgba(78, 255, 208, 0.15);
          border: 1px solid rgba(78, 255, 208, 0.4);
          color: #4effd0;
          border-radius: 8px;
          width: 41px;
          height: 41px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 39px;
          transition: all 0.2s ease;
        }

        .research-chatbot-metadata-modal-close:hover {
          background: rgba(78, 255, 208, 0.25);
          border-color: rgba(78, 255, 208, 0.6);
        }

        .research-chatbot-metadata-modal-content {
          flex: 1;
          overflow: auto;
          padding: 25px;
          background: #44546a;
        }

        .research-chatbot-metadata-summary {
          margin-bottom: 25px;
          padding: 20px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(78, 255, 208, 0.2);
          border-radius: 10px;
          font-size: 27px;
          color: #ffffff;
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
        }

        .research-chatbot-metadata-summary strong {
          color: #4effd0;
          font-weight: 600;
        }

        .research-chatbot-metadata-feature {
          color: #4effd0 !important;
        }

        .research-chatbot-metadata-markdown {
          padding: 25px;
          background: rgba(40, 50, 65, 0.6);
          border: 1px solid rgba(78, 255, 208, 0.2);
          border-radius: 10px;
          max-height: 70vh;
          overflow-y: auto;
          color: #ffffff;
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
          font-size: 28px;
          line-height: 1.7;
        }

        .research-chatbot-metadata-markdown :global(h1),
        .research-chatbot-metadata-markdown :global(h2),
        .research-chatbot-metadata-markdown :global(h3),
        .research-chatbot-metadata-markdown :global(h4),
        .research-chatbot-metadata-markdown :global(h5),
        .research-chatbot-metadata-markdown :global(h6) {
          color: #ffffff;
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
        }

        .research-chatbot-metadata-markdown :global(h1) {
          font-size: 2.625rem;
          color: #4effd0;
          border-bottom: 2px solid rgba(78, 255, 208, 0.3);
          padding-bottom: 0.5rem;
        }

        .research-chatbot-metadata-markdown :global(h2) {
          font-size: 2.25rem;
          color: #4effd0;
        }

        .research-chatbot-metadata-markdown :global(h3) {
          font-size: 1.875rem;
        }

        .research-chatbot-metadata-markdown :global(p) {
          color: #ffffff;
          margin: 1rem 0;
          line-height: 1.7;
        }

        .research-chatbot-metadata-markdown :global(ul),
        .research-chatbot-metadata-markdown :global(ol) {
          color: #ffffff;
          margin: 1rem 0;
          padding-left: 2rem;
        }

        .research-chatbot-metadata-markdown :global(li) {
          margin: 0.5rem 0;
          color: #ffffff;
        }

        .research-chatbot-metadata-markdown :global(blockquote) {
          margin: 1rem 0;
          padding: 0.75rem 1.25rem;
          border-left: 4px solid #4effd0;
          background: rgba(78, 255, 208, 0.1);
          color: rgba(255, 255, 255, 0.9);
          font-style: italic;
          border-radius: 4px;
        }

        .research-chatbot-metadata-markdown :global(code) {
          background: rgba(0, 0, 0, 0.4);
          color: #4effd0;
          padding: 0.2rem 0.4rem;
          border-radius: 4px;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Courier New', monospace;
          font-size: 1.35em;
          border: 1px solid rgba(78, 255, 208, 0.2);
        }

        .research-chatbot-metadata-markdown :global(pre) {
          background: rgba(0, 0, 0, 0.5);
          color: #ffffff;
          padding: 1rem;
          border-radius: 6px;
          overflow-x: auto;
          margin: 1rem 0;
          border: 1px solid rgba(78, 255, 208, 0.2);
        }

        .research-chatbot-metadata-markdown :global(pre code) {
          background: none;
          padding: 0;
          color: #ffffff;
          border: none;
        }

        .research-chatbot-metadata-markdown :global(a) {
          color: #4effd0;
          text-decoration: none;
          font-weight: 500;
        }

        .research-chatbot-metadata-markdown :global(a:hover) {
          color: #ffffff;
          text-decoration: underline;
        }

        .research-chatbot-metadata-markdown :global(table) {
          border-collapse: collapse;
          width: 100%;
          margin: 1rem 0;
          font-size: 1.35rem;
          border: 1px solid rgba(78, 255, 208, 0.2);
          border-radius: 6px;
          overflow: hidden;
        }

        .research-chatbot-metadata-markdown :global(th),
        .research-chatbot-metadata-markdown :global(td) {
          border: 1px solid rgba(78, 255, 208, 0.2);
          padding: 0.75rem;
          text-align: left;
          color: #ffffff;
        }

        .research-chatbot-metadata-markdown :global(th) {
          background: rgba(78, 255, 208, 0.15);
          color: #4effd0;
          font-weight: 600;
        }

        .research-chatbot-metadata-markdown :global(tr:nth-child(even)) {
          background: rgba(255, 255, 255, 0.05);
        }

        .research-chatbot-metadata-markdown :global(hr) {
          border: none;
          border-top: 1px solid rgba(78, 255, 208, 0.2);
          margin: 1.5rem 0;
        }

        .research-chatbot-metadata-json {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(78, 255, 208, 0.2);
          border-radius: 10px;
          padding: 21px;
          margin: 0;
          color: #ffffff;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Courier New', monospace;
          font-size: 24px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-wrap: break-word;
          overflow-x: auto;
          max-height: 70vh;
        }

        .research-chatbot-metadata-empty-state {
          text-align: center;
          padding: 50px;
          color: rgba(255, 255, 255, 0.6);
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
        }

        .research-chatbot-metadata-loading-state {
          text-align: center;
          padding: 50px;
          color: rgba(255, 255, 255, 0.8);
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
        }

        .research-chatbot-metadata-loading-state p {
          margin-top: 25px;
          color: rgba(255, 255, 255, 0.7);
        }

        .research-chatbot-metadata-error-state {
          text-align: center;
          padding: 50px;
          color: #ffffff;
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
        }

        .research-chatbot-metadata-error-state p {
          margin-bottom: 25px;
          color: rgba(255, 255, 255, 0.9);
        }

        .research-chatbot-metadata-retry-button {
          padding: 13px 25px;
          background: rgba(78, 255, 208, 0.15);
          border: 1px solid rgba(78, 255, 208, 0.4);
          color: #4effd0;
          border-radius: 8px;
          cursor: pointer;
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
          font-size: 27px;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .research-chatbot-metadata-retry-button:hover {
          background: rgba(78, 255, 208, 0.25);
          border-color: rgba(78, 255, 208, 0.6);
          transform: translateY(-1px);
        }

        /* ── Continuous text flow — no bubbles, no boxes ─────────────── */
        .research-chatbot-message {
          display: block;
          width: 100%;
        }

        .research-chatbot-message-user,
        .research-chatbot-message-assistant,
        .research-chatbot-message-system {
          align-items: unset;
        }

        .research-chatbot-message-content {
          max-width: 100%;
          width: 100%;
          padding: 7px 11px;
          border-radius: 8px;
          font-size: 26px;
          line-height: 1.55;
          word-wrap: break-word;
          box-sizing: border-box;
        }

        /* User bubble — darker opaque background, stands out */
        .research-chatbot-message-user .research-chatbot-message-content {
          background: rgba(78, 255, 208, 0.08);
          color: #ffffff;
          border: 1px solid rgba(78, 255, 208, 0.5);
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 400;
        }

        /* Bot — no bubble, blends into panel */
        .research-chatbot-message-assistant .research-chatbot-message-content {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.82);
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 400;
          padding: 2px 0;
        }

        /* System — no bubble, subtle turquoise left accent */
        .research-chatbot-message-system .research-chatbot-message-content {
          background: none;
          border: none;
          border-left: 2px solid rgba(78, 255, 208, 0.5);
          color: rgba(255, 255, 255, 0.5);
          font-style: italic;
          font-size: 16px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 400;
          padding: 2px 0 2px 8px;
        }


        .research-chatbot-message-error .research-chatbot-message-content {
          background: rgba(239, 68, 68, 0.1); // Error background
          color: #ffffff; // Pure white like header
          border: 1px solid #ef4444;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 300; // Light weight like Climate TRACE
        }

        .research-chatbot-input-container {
          padding: 10px 14px 8px 14px;
          border-top: 1px solid #4effd0; // Turquoise border
          background: #44546a;
          backdrop-filter: blur(8px);
        }

        .research-chatbot-error {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(239, 68, 68, 0.1);
          color: #ffffff; // Pure white like header
          padding: 10px 15px;
          border-radius: 8px; // Scaled proportionally
          margin-bottom: 15px;
          border: 1px solid #ef4444;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 300; // Light weight like Climate TRACE
        }

        .research-chatbot-retry {
          background: rgba(255, 255, 255, 0.1); // Subtle background like header
          border: 1px solid #ffffff; // White border like header
          color: #ffffff; // Pure white like header
          padding: 5px 10px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 22px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 300; // Light weight like Climate TRACE
          text-transform: uppercase; // Uppercase like Climate TRACE
          letter-spacing: 0.3px; // Letter spacing like Climate TRACE
        }

        .research-chatbot-input-wrapper {
          display: block;
        }

        .research-chatbot-input-row {
          display: flex;
          align-items: stretch;
          gap: 10px;
        }

        .research-chatbot-input-area {
          position: relative;
          flex: 1;
        }

        .research-chatbot-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-left: 5px;
        }

        /* Action buttons - scaled proportionally */
        .research-chatbot-action-button {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: #ffffff;
          padding: 0;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 34px;
          width: 34px;
          height: 34px;
          font-size: 21px;
          font-weight: 300;
        }

        .research-chatbot-action-button:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.2);
          border-color: #ffffff;
        }

        .research-chatbot-action-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .research-chatbot-action-button-new {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: #ffffff;
          font-size: 27px;
          font-weight: 300;
          line-height: 1;
        }

        .research-chatbot-action-button-new:hover:not(:disabled) {
          background: rgba(78, 255, 208, 0.2);
          border-color: rgba(78, 255, 208, 0.5);
        }

        .research-chatbot-input {
          width: 100%; // Ensure full width
          min-height: 90px;
          padding: 10px 14px;
          border: 1px solid rgba(78, 255, 208, 0.3); // Subtle turquoise border
          border-radius: 8px;
          background: transparent; // Clean transparent background
          color: #ffffff; // Pure white like header
          font-size: 26px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 300; // Light weight like Climate TRACE
          outline: none;
          transition: all 0.2s ease;
          line-height: 1.45;
          box-sizing: border-box; // Include padding in width calculation
          word-wrap: break-word;
          white-space: pre-wrap;
        }

        .research-chatbot-input:focus {
          border-color: rgba(78, 255, 208, 0.6); // Slightly more visible turquoise border on focus
          background: transparent; // Keep transparent background
        }

        .research-chatbot-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .research-chatbot-input::placeholder {
          color: rgba(255, 255, 255, 0.6); // Subtle placeholder color
        }

        /* Dataset dropdown styling */
        .dataset-dropdown {
          position: absolute;
          bottom: 100%;
          left: 0;
          right: 0;
          background: white;
          border: 1px solid #ddd;
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          max-height: 200px;
          overflow-y: auto;
          margin-bottom: 8px;
        }

        .dataset-option {
          padding: 8px 12px;
          cursor: pointer;
          border-bottom: 1px solid #f0f0f0;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 21px;
          transition: background-color 0.2s ease;
        }

        .dataset-option:last-child {
          border-bottom: none;
        }

        .dataset-option:hover,
        .dataset-option.-active {
          background-color: #f8f9fa;
        }

        .dataset-option .dataset-name {
          font-weight: 600;
          font-size: 21px;
          color: #444; // Softer gray
        }

        .dataset-option .dataset-description {
          font-size: 16px; // Smaller font size
          color: #666;
          margin-top: 2px;
        }

        .research-chatbot-send {
          background: rgba(
            255,
            255,
            255,
            0.1
          ); // Subtle background for better visibility inside input
          border: 1px solid rgba(255, 255, 255, 0.3); // Subtle border
          color: #ffffff; // Pure white like header
          padding: 6px 8px;
          border-radius: 5px; // Scaled proportionally
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 42px;
          height: 42px;
          font-size: 21px;
          font-weight: 300; // Light weight for minimalistic look
        }

        .research-chatbot-send:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1); // Subtle hover like header
          border-color: #ffffff;
        }

        .research-chatbot-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Redesigned token display styling */
        .research-chatbot-tokens-container {
          padding: 6px 14px 8px 14px;
          background: #44546a;
          backdrop-filter: blur(8px);
          border-top: 1px solid rgba(78, 255, 208, 0.3);
        }

        .research-chatbot-tokens-list {
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          gap: 5px;
          max-height: 150px;
          overflow-y: auto;
          padding-right: 10px;
          align-items: flex-start;
        }

        .research-chatbot-token {
          display: inline-flex;
          align-items: center;
          padding: 3px 8px;
          background: rgba(78, 255, 208, 0.1);
          color: #4effd0;
          border-radius: 4px;
          font-size: 16px;
          font-family: 'Inter', sans-serif;
          font-weight: 400;
          border: 1px solid rgba(78, 255, 208, 0.3);
          cursor: default;
          gap: 5px;
          width: fit-content;
          white-space: nowrap;
          overflow: hidden;
        }

        .research-chatbot-token-remove {
          background: none;
          border: none;
          color: rgba(78, 255, 208, 0.6);
          cursor: pointer;
          font-size: 32px;
          padding: 0;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .research-chatbot-token-remove:hover {
          background: rgba(78, 255, 208, 0.2);
          color: #4effd0;
        }

        /* File token styling - match new turquoise theme */
        .research-chatbot-token-file {
          background: rgba(78, 255, 208, 0.1) !important;
          color: #4effd0 !important;
          border-color: rgba(78, 255, 208, 0.3) !important;
        }

        .research-chatbot-token-file:hover {
          background: rgba(78, 255, 208, 0.15) !important;
        }

        /* Dataset token styling */
        .research-chatbot-token-dataset {
          background: rgba(78, 255, 208, 0.1);
          color: #4effd0;
          border-color: rgba(78, 255, 208, 0.3);
        }

        /* Inline upload button styling - same size as send button */
        .research-chatbot-upload-button-inline {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: #ffffff;
          padding: 8px 10px;
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 40px;
          height: 40px;
          font-size: 22px;
          font-weight: 300;
        }

        .research-chatbot-upload-button-inline:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.2);
          border-color: #ffffff;
        }

        .research-chatbot-upload-button-inline:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .research-chatbot-upload-icon-inline {
          width: 21px;
          height: 21px;
          fill: currentColor;
        }

        /* Custom scrollbar for tokens list */
        .research-chatbot-tokens-list::-webkit-scrollbar {
          width: 5px;
        }

        .research-chatbot-tokens-list::-webkit-scrollbar-track {
          background: rgba(78, 255, 208, 0.1);
          border-radius: 3px;
        }

        .research-chatbot-tokens-list::-webkit-scrollbar-thumb {
          background: rgba(78, 255, 208, 0.3);
          border-radius: 3px;
        }

        .research-chatbot-tokens-list::-webkit-scrollbar-thumb:hover {
          background: rgba(78, 255, 208, 0.5);
        }

        .research-chatbot-message-time {
          font-size: 21px;
          color: rgba(255, 255, 255, 0.6); // Subtle time color
          margin-top: 5px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 300; // Light weight like Climate TRACE
          text-transform: uppercase; // Uppercase like Climate TRACE
          letter-spacing: 0.3px; // Letter spacing like Climate TRACE
        }

        .research-chatbot-typing {
          display: flex;
          gap: 5px;
          align-items: center;
        }

        .research-chatbot-typing span {
          width: 8px;
          height: 8px;
          background: #ffffff; // Pure white like header
          border-radius: 50%;
          animation: typing 1.4s infinite ease-in-out;
        }

        .research-chatbot-typing span:nth-child(1) {
          animation-delay: -0.32s;
        }

        .research-chatbot-typing span:nth-child(2) {
          animation-delay: -0.16s;
        }

        @keyframes typing {
          0%,
          80%,
          100% {
            transform: scale(0.8);
            opacity: 0.5;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .research-chatbot-research-content {
          line-height: 1.6;
          color: #ffffff; // Pure white like header
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-weight: 300; // Light weight like Climate TRACE
        }

        .research-chatbot-line {
          margin-bottom: 10px;
        }

        .research-chatbot-line:last-child {
          margin-bottom: 0;
        }

        .research-chatbot-link {
          color: #ffffff; // Pure white like header
          text-decoration: underline;
          font-weight: 400; // Slightly bolder for links
          transition: color 0.2s ease;
        }

        .research-chatbot-link:hover {
          color: #ffffff; // Pure white like header
          text-decoration: none;
        }

        .research-chatbot-link:visited {
          color: rgba(224, 224, 224, 0.8); // Slightly dimmer for visited links
        }

        .research-chatbot-streaming-indicator {
          display: inline-block;
          width: 10px;
          height: 20px;
          background: #e0e0e0; // Light grey like Climate TRACE
          margin-left: 5px;
          animation: blink 1s infinite;
        }

        @keyframes blink {
          0%,
          50% {
            opacity: 1;
          }
          51%,
          100% {
            opacity: 0;
          }
        }

        /* ── Deep-analysis panel ───────────────────────────────────────── */
        .research-chatbot-analysis-panel {
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(78, 255, 208, 0.2);
          border-radius: 10px;
          overflow: hidden;
          width: 100%;
        }

        .research-chatbot-analysis-panel__header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: rgba(78, 255, 208, 0.08);
          border-bottom: 1px solid rgba(78, 255, 208, 0.15);
        }

        .research-chatbot-analysis-panel__index {
          font-size: 16px;
          font-weight: 700;
          color: #4effd0;
          background: rgba(78, 255, 208, 0.15);
          border-radius: 4px;
          padding: 2px 7px;
          white-space: nowrap;
          letter-spacing: 0.04em;
        }

        .research-chatbot-analysis-panel__title {
          font-size: 20px;
          font-weight: 600;
          color: #e8f4f0;
          letter-spacing: 0.01em;
        }

        .research-chatbot-analysis-panel__explanation {
          padding: 10px 14px;
          font-size: 18px;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.75);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .research-chatbot-analysis-panel__chart {
          padding: 0;
          background: #fff;
          border-radius: 0 0 10px 10px;
          overflow: hidden;
        }

        /* Progress message styling — overridden by continuous-flow rule above */

        /* Status message styling - larger font for intermediate/completed messages */
        .research-chatbot-message-with-spinner {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 26px;
          font-weight: 500;
          color: #4effd0; /* Keep turquoise color for status messages */
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .research-chatbot-spinner-text-inline {
          font-size: 26px;
          font-weight: 500;
          color: #4effd0; /* Keep turquoise color for status messages */
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .done-icon {
          font-size: 26px;
          color: #4effd0; /* Turquoise color for checkmark */
          font-weight: bold;
        }

        .progress-ring {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        /* ── Terminal-style tool rows ─────────────────────────────────── */
        .rcc-tool-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 2px 0;
          font-size: 26px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          line-height: 1.5;
        }

        /* Subject color uses full accent turquoise (not the muted secondary)
         * so it reads as turquoise on the slate panel — see
         * CHATBOT_UI_STYLE.md. .8 opacity matches the spinner-verb-row treatment
         * so "thinking…" and "Indexing …" feel like the same family. */
        .rcc-tool-subject {
          color: #4effd0;
          opacity: 0.85;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 26px;
          font-style: italic;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        .rcc-spinner-char {
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #4effd0;
          font-size: 26px;
          display: inline-block;
          width: 1.2em;
          text-align: center;
        }

        /* Spinner verb row — shown while waiting for first bot output */
        .rcc-spinner-verb-row {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 2px 0;
          font-size: 26px;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #4effd0;
          animation: rcc-fade-in 0.25s ease;
        }

        .rcc-spinner-verb-text {
          color: #4effd0;
          opacity: 0.8;
          letter-spacing: 0.01em;
          font-style: italic;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
        }

        @keyframes rcc-fade-in {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Status bar */
        .rcc-status-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 14px;
          border-top: 1px solid rgba(78, 255, 208, 0.2);
          font-size: 26px;
          color: #4effd0;
          font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          letter-spacing: 0.02em;
          background: rgba(78, 255, 208, 0.04);
        }

        .rcc-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
          background: rgba(78, 255, 208, 0.4);
        }

        .rcc-status-bar--Running .rcc-status-dot {
          background: #4effd0;
          animation: rcc-pulse 1.4s ease-in-out infinite;
        }


        .rcc-status-label {
          color: #4effd0;
          opacity: 0.85;
        }

        .rcc-status-detail {
          color: rgba(78, 255, 208, 0.6);
        }

        @keyframes rcc-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.25; }
        }

        /* Mobile responsiveness */
        @media (max-width: 768px) {
          .research-chatbot-dropdown {
            top: 10px;
            right: 10px;
            width: calc(100vw - 20px);
          }

          .research-chatbot-container {
            width: 100%;
            height: 600px;
            max-height: 80vh;
            border-radius: 10px;
          }

          .research-chatbot-messages {
            padding: 8px 10px;
          }

          .research-chatbot-input-container {
            padding: 8px 10px;
          }

          .research-chatbot-welcome {
            padding: 16px;
          }

          .research-chatbot-welcome-icon {
            font-size: 48px;
          }

          .research-chatbot-welcome h4 {
            font-size: 24px;
          }

          .research-chatbot-welcome p {
            font-size: 20px;
          }
        }

        .research-chatbot-rag-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: rgba(78, 255, 208, 0.08);
          border-top: 1px solid rgba(78, 255, 208, 0.2);
          color: rgba(255, 255, 255, 0.75);
          font-size: 18px;
        }
      `}</style>
    </div>
  );
};

ResearchChatbot.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  numberOfSelectQueries: PropTypes.number,
  percentOfTopQueriesToSearch: PropTypes.number,
  percentOfTopResultsToScan: PropTypes.number,
  className: PropTypes.string,
  onAssistantMessage: PropTypes.func, // Callback for assistant message
};

export default ResearchChatbot;
