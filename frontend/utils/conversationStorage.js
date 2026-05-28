/**
 * Conversation Storage Utility
 * Simple localStorage-based persistence for chatbot conversations
 */

// Generate a unique conversation ID
const generateConversationId = () => {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Storage key for conversation data
const STORAGE_KEY = 'research-chatbot-conversation';

/**
 * Save conversation to localStorage
 * @param {Array} messages - Array of message objects
 * @param {string} conversationId - Optional conversation ID
 */
export const saveConversation = (messages, conversationId = null) => {
  try {
    const conversationData = {
      messages: messages.map(msg => ({
        ...msg,
        // Convert Date objects to ISO strings for storage
        timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp
      })),
      timestamp: Date.now(),
      conversationId: conversationId || generateConversationId(),
      version: '1.0' // For future compatibility
    };
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationData));
    console.log('💾 Conversation saved to localStorage:', {
      messageCount: messages.length,
      conversationId: conversationData.conversationId,
      size: JSON.stringify(conversationData).length
    });
  } catch (error) {
    console.error('❌ Failed to save conversation to localStorage:', error);
    
    // Handle quota exceeded error
    if (error.name === 'QuotaExceededError') {
      console.warn('⚠️ Storage quota exceeded, stripping inline images first');
      // First pass: strip base64 dataUrls from map snapshots (keep metadata)
      const stripped = messages.map(msg => {
        if (msg.messageType === 'map_snapshot' && msg.mapSnapshot?.url?.startsWith('data:')) {
          return { ...msg, mapSnapshot: { ...msg.mapSnapshot, url: null } };
        }
        return msg;
      });
      try {
        const conversationData = {
          messages: stripped.map(msg => ({
            ...msg,
            timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp
          })),
          timestamp: Date.now(),
          conversationId: conversationId || generateConversationId(),
          version: '1.0'
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationData));
      } catch (_) {
        // Still too large — keep last 20 messages as final fallback
        saveConversation(stripped.slice(-20), conversationId);
      }
    }
  }
};

/**
 * Load conversation from localStorage
 * @returns {Object} Conversation data with messages array
 */
export const loadConversation = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      console.log('📭 No saved conversation found');
      return { messages: [], conversationId: null };
    }
    
    const conversationData = JSON.parse(data);
    
    // Convert ISO strings back to Date objects
    const messages = conversationData.messages.map(msg => ({
      ...msg,
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
    }));
    
    console.log('📂 Conversation loaded from localStorage:', {
      messageCount: messages.length,
      conversationId: conversationData.conversationId,
      version: conversationData.version || 'unknown'
    });
    
    return {
      messages,
      conversationId: conversationData.conversationId,
      timestamp: conversationData.timestamp,
      version: conversationData.version
    };
  } catch (error) {
    console.error('❌ Failed to load conversation from localStorage:', error);
    return { messages: [], conversationId: null };
  }
};

/**
 * Clear conversation from localStorage
 */
export const clearConversation = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    console.log('🗑️ Conversation cleared from localStorage');
  } catch (error) {
    console.error('❌ Failed to clear conversation from localStorage:', error);
  }
};

/**
 * Get conversation metadata (size, message count, etc.)
 * @returns {Object} Conversation metadata
 */
export const getConversationMetadata = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    
    const conversationData = JSON.parse(data);
    return {
      messageCount: conversationData.messages?.length || 0,
      conversationId: conversationData.conversationId,
      timestamp: conversationData.timestamp,
      size: data.length,
      sizeKB: Math.round(data.length / 1024 * 100) / 100
    };
  } catch (error) {
    console.error('❌ Failed to get conversation metadata:', error);
    return null;
  }
};

// ── Per-memoryId map snapshot storage ────────────────────────────────────────
// Map snapshots are never written to Firestore, so we persist them in a
// separate localStorage key per conversation so they can be restored when the
// user refreshes or switches conversations.

const SNAPSHOTS_KEY_PREFIX = 'polisense-map-snapshots-';

/**
 * Persist the finalized map_snapshot messages for a conversation.
 * Call this every time a snapshot is added or updated in the message list.
 * @param {string} memoryId
 * @param {Array} snapshots - Only map_snapshot messages with a real url (not loading)
 */
export const saveMapSnapshots = (memoryId, snapshots) => {
  if (!memoryId || !Array.isArray(snapshots)) return;
  try {
    const payload = snapshots.map(msg => ({
      ...msg,
      timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
    }));
    localStorage.setItem(`${SNAPSHOTS_KEY_PREFIX}${memoryId}`, JSON.stringify(payload));
  } catch (error) {
    console.warn('⚠️ Failed to save map snapshots:', error?.message);
  }
};

/**
 * Load the finalized map_snapshot messages for a conversation.
 * @param {string} memoryId
 * @returns {Array} snapshot messages (empty array if none)
 */
export const loadMapSnapshots = (memoryId) => {
  if (!memoryId) return [];
  try {
    const data = localStorage.getItem(`${SNAPSHOTS_KEY_PREFIX}${memoryId}`);
    if (!data) return [];
    return JSON.parse(data).map(msg => ({
      ...msg,
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
    }));
  } catch (error) {
    console.warn('⚠️ Failed to load map snapshots:', error?.message);
    return [];
  }
};

/**
 * Load finalized map_snapshot messages for a conversation, checking both the
 * dedicated per-memoryId key AND the main conversation storage (fallback for
 * snapshots captured before the dedicated key existed, or in the same session
 * before a page reload). Automatically migrates legacy snapshots to the
 * dedicated key on first access.
 * @param {string} memoryId
 * @returns {Array} deduplicated snapshot messages, sorted by timestamp ascending
 */
export const loadMapSnapshotsForConversation = (memoryId) => {
  if (!memoryId) return [];

  // 1. Dedicated per-memoryId key (new system)
  const dedicated = loadMapSnapshots(memoryId);

  // 2. Main conversation storage (same session not yet migrated, or legacy)
  let mainSnapshots = [];
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      mainSnapshots = (parsed.messages || [])
        .filter(m =>
          m.messageType === 'map_snapshot' &&
          !m.mapSnapshot?.loading &&
          (m.mapSnapshot?.url || m.mapSnapshot?.dataUrl) &&
          // Accept messages tagged for this conversation OR untagged legacy ones
          (!m.memoryId || m.memoryId === memoryId)
        )
        .map(msg => ({
          ...msg,
          timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        }));
    }
  } catch (_) {}

  // 3. Merge, deduplicate by id (dedicated key wins on conflict)
  const map = new Map();
  mainSnapshots.forEach(s => map.set(s.id, s));
  dedicated.forEach(s => map.set(s.id, s));
  const all = Array.from(map.values());

  // 4. Auto-migrate to dedicated key if we found extra snapshots not yet there
  if (all.length > dedicated.length) {
    saveMapSnapshots(memoryId, all);
  }

  return all;
};

/**
 * Insert snapshot messages into a Firestore-restored message list at their
 * original positions, using the `precedingMessageCount` field stored on each
 * snapshot (number of non-snapshot messages that preceded it when it was
 * created). Falls back to appending at the end for legacy snapshots that
 * don't have this field.
 *
 * This avoids timestamp-based sorting, which breaks because Firestore chatLog
 * entries are stored without timestamps and all get `new Date()` on restore.
 *
 * @param {Array} firestoreMessages - Messages restored from Firestore (in order)
 * @param {Array} snapshots - map_snapshot messages to insert
 * @returns {Array} merged list with snapshots at their correct positions
 */
export const insertSnapshotsByPosition = (firestoreMessages, snapshots) => {
  if (!snapshots.length) return [...firestoreMessages];

  const result = [...firestoreMessages];

  // Sort snapshots by their recorded position so we process them in order
  const sorted = [...snapshots].sort(
    (a, b) => (a.precedingMessageCount ?? 999999) - (b.precedingMessageCount ?? 999999)
  );

  sorted.forEach(snap => {
    const targetCount = snap.precedingMessageCount ?? null;

    if (targetCount === null) {
      // Legacy snapshot without position info — append at end
      result.push(snap);
      return;
    }

    // Walk through the current result to find the insertion point:
    // insert right after the Nth non-snapshot message
    let nonSnapCount = 0;
    let insertIdx = result.length; // default: end

    for (let i = 0; i < result.length; i++) {
      if (result[i].messageType !== 'map_snapshot') {
        nonSnapCount++;
      }
      if (nonSnapCount === targetCount) {
        insertIdx = i + 1;
        break;
      }
    }

    result.splice(insertIdx, 0, snap);
  });

  return result;
};

/**
 * Delete the map snapshot storage for a conversation (e.g. when it's deleted).
 * @param {string} memoryId
 */
export const clearMapSnapshots = (memoryId) => {
  if (!memoryId) return;
  try {
    localStorage.removeItem(`${SNAPSHOTS_KEY_PREFIX}${memoryId}`);
  } catch (_) {}
};

/**
 * Check if localStorage is available
 * @returns {boolean} True if localStorage is available
 */
export const isStorageAvailable = () => {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (error) {
    console.warn('⚠️ localStorage not available:', error);
    return false;
  }
};
