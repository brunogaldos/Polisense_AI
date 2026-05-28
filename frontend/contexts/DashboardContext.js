import React, { createContext, useContext, useState, useEffect } from 'react';

const DashboardContext = createContext();

export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
};

export const DashboardProvider = ({ children }) => {
  const [lastAssistantMessage, setLastAssistantMessage] = useState(null);
  const [fullConversation, setFullConversation] = useState([]);
  const [dynamicDashboardData, setDynamicDashboardData] = useState(null);
  const [showDynamicDashboard, setShowDynamicDashboard] = useState(false);
  const [memoryId, setMemoryIdState] = useState(null);
  // Uploaded documents shared between chatbot and header
  const [uploadedDocuments, setUploadedDocuments] = useState([]);

  // Load persisted state from localStorage on mount
  useEffect(() => {
    try {
      const storedLastMessage = localStorage.getItem('dashboard-last-assistant-message');
      if (storedLastMessage) {
        setLastAssistantMessage(storedLastMessage);
        console.log('📱 Loaded last assistant message from localStorage');
      }

      const storedConversation = localStorage.getItem('dashboard-full-conversation');
      if (storedConversation) {
        const parsedConversation = JSON.parse(storedConversation);
        setFullConversation(parsedConversation);
        console.log('📱 Loaded full conversation from localStorage');
      }

      const storedDashboardData = localStorage.getItem('dashboard-dynamic-data');
      if (storedDashboardData) {
        const parsedData = JSON.parse(storedDashboardData);
        setDynamicDashboardData(parsedData);
        console.log('📱 Loaded dynamic dashboard data from localStorage');
      }

      const storedShowDynamic = localStorage.getItem('dashboard-show-dynamic');
      if (storedShowDynamic) {
        setShowDynamicDashboard(storedShowDynamic === 'true');
        console.log('📱 Loaded show dynamic dashboard state from localStorage');
      }

      const storedDocs = localStorage.getItem('dashboard-uploaded-documents');
      if (storedDocs) {
        setUploadedDocuments(JSON.parse(storedDocs));
      }
    } catch (error) {
      console.error('❌ Error loading dashboard state from localStorage:', error);
    }
  }, []);

  // Persist uploadedDocuments (id + name only) whenever they change
  useEffect(() => {
    try {
      if (uploadedDocuments.length > 0) {
        localStorage.setItem(
          'dashboard-uploaded-documents',
          JSON.stringify(uploadedDocuments.map((d) => ({ id: d.id, name: d.name }))),
        );
      } else {
        localStorage.removeItem('dashboard-uploaded-documents');
      }
    } catch (_) {}
  }, [uploadedDocuments]);

  const handleDashboardCreate = (dashboardData) => {
    setDynamicDashboardData(dashboardData);
    setShowDynamicDashboard(true);
    
    // Persist to localStorage
    try {
      localStorage.setItem('dashboard-dynamic-data', JSON.stringify(dashboardData));
      localStorage.setItem('dashboard-show-dynamic', 'true');
      console.log('💾 Saved dashboard creation state to localStorage');
    } catch (error) {
      console.error('❌ Error saving dashboard state to localStorage:', error);
    }
  };

  const handleBackToDefault = () => {
    setShowDynamicDashboard(false);
    setDynamicDashboardData(null);
    
    // Persist to localStorage
    try {
      localStorage.removeItem('dashboard-dynamic-data');
      localStorage.setItem('dashboard-show-dynamic', 'false');
      console.log('💾 Saved back to default state to localStorage');
    } catch (error) {
      console.error('❌ Error saving back to default state to localStorage:', error);
    }
  };

  const setAssistantMessage = (message) => {
    console.log('DashboardContext: Setting assistant message:', message ? 'Has message' : 'No message');
    setLastAssistantMessage(message);
    
    // Persist to localStorage
    try {
      if (message) {
        localStorage.setItem('dashboard-last-assistant-message', message);
        console.log('💾 Saved last assistant message to localStorage');
      } else {
        localStorage.removeItem('dashboard-last-assistant-message');
        console.log('💾 Cleared last assistant message from localStorage');
      }
    } catch (error) {
      console.error('❌ Error saving assistant message to localStorage:', error);
    }
  };

  const setConversation = (conversation) => {
    console.log('DashboardContext: Setting full conversation:', conversation ? `${conversation.length} messages` : 'No conversation');
    setFullConversation(conversation || []);
    
    // Persist to localStorage
    try {
      if (conversation && conversation.length > 0) {
        localStorage.setItem('dashboard-full-conversation', JSON.stringify(conversation));
        console.log('💾 Saved full conversation to localStorage');
      } else {
        localStorage.removeItem('dashboard-full-conversation');
        console.log('💾 Cleared full conversation from localStorage');
      }
    } catch (error) {
      console.error('❌ Error saving conversation to localStorage:', error);
    }
  };

  const setMemoryId = (id) => {
    setMemoryIdState(id);
  };

  const value = {
    lastAssistantMessage,
    fullConversation,
    dynamicDashboardData,
    showDynamicDashboard,
    memoryId,
    handleDashboardCreate,
    handleBackToDefault,
    setAssistantMessage,
    setConversation,
    setMemoryId,
    uploadedDocuments,
    setUploadedDocuments,
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
};
