# Chatbot Panel UI Configuration Guide

This document provides comprehensive information about the Research Chatbot panel UI system, including colors, functionality, styling, files involved, integration, and code snippets for complete customization.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [File Structure](#file-structure)
3. [AI Button Configuration](#ai-button-configuration)
4. [Chatbot Panel Configuration](#chatbot-panel-configuration)
5. [Color Scheme](#color-scheme)
6. [Typography Configuration](#typography-configuration)
7. [Button Configurations](#button-configurations)
8. [Message System](#message-system)
9. [Input System](#input-system)
10. [Dataset Integration](#dataset-integration)
11. [File Upload System](#file-upload-system)
12. [Responsive Design](#responsive-design)
13. [Integration Points](#integration-points)
14. [Customization Guide](#customization-guide)
15. [Code Snippets](#code-snippets)

## Architecture Overview

The chatbot system consists of two main components:

1. **AI Button**: Floating button that triggers the chatbot panel
2. **Chatbot Panel**: Full-featured chat interface with research capabilities

### Component Hierarchy
```
AI Button (research-btn)
├── Triggers chatbot panel
├── Disappears when panel opens
└── Reappears when panel closes

Chatbot Panel (research-chatbot-dropdown)
├── Close Button (X)
├── Messages Area
├── Input Area
│   ├── Text Input
│   ├── Dataset Dropdown
│   └── Action Buttons (Send, Clear, Upload)
└── Token Display Area
```

## File Structure

### Core Files
```
resource-watch/
├── components/research/
│   ├── research-chatbot.jsx          # Main chatbot component
│   ├── CHATBOT_UI_CONFIGURATION.md  # This documentation
│   └── CHATBOT_README.md            # Technical implementation details
├── pages/dashboard/index.jsx        # Dashboard page with AI button
├── layout/explore/component.jsx     # Explore page with AI button
└── css/components/app/pages/
    └── explore.scss                 # AI button styling
```

### Integration Files
```
resource-watch/
├── services/research-api.js        # WebSocket API integration
├── services/dataset.js              # Dataset fetching
├── utils/conversationStorage.js     # Local storage management
├── contexts/DashboardContext.js     # Dashboard integration
└── components/ui/
    ├── MessageRenderer.jsx          # Message rendering
    └── Spinner.jsx                  # Loading indicators
```

## AI Button Configuration

### File Locations
- **Dashboard**: [`resource-watch/pages/dashboard/index.jsx`](resource-watch/pages/dashboard/index.jsx)
- **Explore**: [`resource-watch/layout/explore/component.jsx`](resource-watch/layout/explore/component.jsx)
- **Styling**: [`resource-watch/css/components/app/pages/explore.scss`](resource-watch/css/components/app/pages/explore.scss)

### AI Button Implementation
```jsx
// Dashboard and Explore pages
{!isChatOpen && (
  <button
    className="research-btn"
    onClick={() => setIsChatOpen(!isChatOpen)}
  >
    <img src="/favicon.ico" alt="AI Icon" className="ai-button-icon" />
    <span>AI</span>
  </button>
)}
```

### AI Button Styling
```scss
// resource-watch/css/components/app/pages/explore.scss
.research-btn {
  position: fixed;
  bottom: 20px;
  right: 8px;
  z-index: 999999;
  background: transparent;
  color: #FFFFFF;
  padding: 12px 16px;
  font-size: 14px;
  border: 1px solid #FFFFFF;
  border-radius: 6px;
  cursor: pointer;
  font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);

  .ai-button-icon {
    width: 20px;
    height: 20px;
    object-fit: contain;
  }
}

.research-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: #4effd0;
  transform: translateY(-1px);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.25), 
              0 0 20px rgba(78, 255, 208, 0.6), 
              0 0 40px rgba(78, 255, 208, 0.4);
}
```

### AI Button Properties
- **Position**: Fixed, bottom-right corner
- **Background**: Transparent with backdrop blur
- **Border**: White with turquoise hover effect
- **Icon**: Favicon.ico (20px × 20px)
- **Text**: "AI" in uppercase
- **Hover Effect**: Glow with turquoise color (`#4effd0`)

## Chatbot Panel Configuration

### Panel Dimensions
```css
.research-chatbot-dropdown {
  position: fixed;
  top: 55px;                    /* Start under header */
  right: 8px;                   /* Small margin from right */
  z-index: 9999;
  width: calc(400px + 65px);    /* 465px total width */
  max-width: calc(100vw - 16px);
}

.research-chatbot-container {
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 100%;
  height: calc(100vh - 75px);   /* Stretch close to bottom */
  max-height: calc(100vh - 75px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #E0E0E0;
  position: relative;
}
```

### Panel Properties
- **Width**: 465px (400px base + 65px extension)
- **Height**: Full viewport minus 75px margin
- **Background**: Dark semi-transparent with blur effect
- **Border**: Light gray (`#E0E0E0`)
- **Position**: Fixed, top-right corner
- **Z-index**: 9999 (high priority)

## Color Scheme

### Primary Colors
```scss
// Background Colors
$panel-bg: rgba(30, 30, 30, 0.85);     // Main panel background
$message-bg-user: rgba(255, 255, 255, 0.15);    // User message background
$message-bg-assistant: rgba(255, 255, 255, 0.08); // Assistant message background
$input-bg: rgba(255, 255, 255, 0.08);  // Input field background

// Text Colors
$text-primary: #FFFFFF;                // Primary text (white)
$text-secondary: rgba(255, 255, 255, 0.6); // Secondary text
$text-placeholder: rgba(255, 255, 255, 0.6); // Placeholder text

// Accent Colors
$accent-turquoise: #4effd0;            // Hover/active states
$accent-border: #E0E0E0;              // Light borders
$accent-error: #ef4444;                // Error states
```

### Color Usage
- **Panel Background**: `rgba(30, 30, 30, 0.85)` with `blur(8px)`
- **Text**: Pure white (`#FFFFFF`) for primary text
- **Borders**: Light gray (`#E0E0E0`) for subtle definition
- **Hover Effects**: Turquoise (`#4effd0`) for interactive elements
- **Error States**: Red (`#ef4444`) for error messages

## Typography Configuration

### Font Family
```css
font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
```

### Font Sizes
```css
/* Message Text */
.research-chatbot-message-content {
  font-size: 18px;           /* Main message text */
  line-height: 1.6;
  font-weight: 400;
}

/* Input Field */
.research-chatbot-input {
  font-size: 18px;           /* Input field text */
  line-height: 1.4;
  font-weight: 300;
}

/* Button Text */
.research-chatbot-action-button {
  font-size: 12px;           /* Small action buttons */
  font-weight: 300;
}

/* Token Text */
.research-chatbot-token {
  font-size: 10px;           /* Dataset tokens */
  font-weight: 400;
}

/* Time Stamps */
.research-chatbot-message-time {
  font-size: 11px;           /* Message timestamps */
  font-weight: 300;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
```

### Typography Properties
- **Primary Font**: Inter (fallback to Lato, Helvetica Neue, Arial)
- **Weight**: 300 (light) for UI elements, 400 (regular) for content
- **Transform**: Uppercase for buttons and timestamps
- **Spacing**: 0.1em for buttons, 0.3px for timestamps

## Button Configurations

### 1. Close Button (X)
**Location**: Bottom-right corner of panel
```css
.research-chatbot-close-btn {
  position: absolute;
  bottom: 0px;
  right: 0px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 21px;
  color: #ffffff;
  z-index: 10;
  transition: all 0.2s ease;
}

.research-chatbot-close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.4);
  transform: scale(1.1);
}
```

### 2. Send Button (→)
**Location**: Right side of input area
```css
.research-chatbot-send {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #FFFFFF;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  font-size: 16px;
  font-weight: 300;
}
```

### 3. Clear Button (🗑️)
**Location**: Next to send button
```css
.research-chatbot-action-button-clear {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #FFFFFF;
  filter: brightness(0) invert(1); /* Makes emoji white */
  width: 24px;
  height: 24px;
  font-size: 12px;
}
```

### 4. Upload Button (•)
**Location**: Above send button
```css
.research-chatbot-action-button-upload {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #FFFFFF;
  width: 24px;
  height: 24px;
  font-size: 12px;
}
```

## Message System

### Message Types
1. **User Messages**: Right-aligned, white background
2. **Assistant Messages**: Left-aligned, subtle background
3. **System Messages**: Italic, left border accent
4. **Intermediate Messages**: With spinner/checkmark
5. **Error Messages**: Red background, error styling

### Message Styling
```css
/* User Messages */
.research-chatbot-message-user .research-chatbot-message-content {
  background: rgba(255, 255, 255, 0.15);
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 400;
}

/* Assistant Messages */
.research-chatbot-message-assistant .research-chatbot-message-content {
  background: rgba(255, 255, 255, 0.08);
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 400;
}

/* System Messages */
.research-chatbot-message-system .research-chatbot-message-content {
  background: rgba(255, 255, 255, 0.08);
  color: #FFFFFF;
  border-radius: 8px;
  font-style: italic;
  font-size: 13px;
  border-left: 4px solid rgba(255, 255, 255, 0.3);
  padding-left: 16px;
}

/* Error Messages */
.research-chatbot-message-error .research-chatbot-message-content {
  background: rgba(239, 68, 68, 0.1);
  color: #FFFFFF;
  border: 1px solid #ef4444;
  font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 300;
}
```

### Message Properties
- **Padding**: 16px 20px for content
- **Border Radius**: 8px for rounded corners
- **Line Height**: 1.6 for readability
- **Word Wrap**: Break-word for long content
- **Timestamps**: 11px, uppercase, subtle color

## Input System

### Input Field Configuration
```css
.research-chatbot-input {
  width: 100%;
  min-height: 180px;                    /* Taller input area */
  padding: 16px 20px;
  border: 1px solid #FFFFFF;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #FFFFFF;
  font-size: 18px;
  font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 300;
  outline: none;
  transition: all 0.2s ease;
  line-height: 1.4;
  box-sizing: border-box;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.research-chatbot-input:focus {
  border-color: #FFFFFF;
  background: rgba(255, 255, 255, 0.15);
}

.research-chatbot-input::placeholder {
  color: rgba(255, 255, 255, 0.6);
}
```

### Input Container
```css
.research-chatbot-input-container {
  padding: 16px 24px 12px 24px;
  border-top: 1px solid #FFFFFF;
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(8px);
}
```

### Input Properties
- **Height**: 180px minimum (expandable)
- **Background**: Semi-transparent white
- **Border**: White with focus enhancement
- **Font**: 18px Inter, light weight
- **Placeholder**: Subtle white color

## Dataset Integration

### Dataset Dropdown
```css
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
  font-size: 12px;
  transition: background-color 0.2s ease;
}

.dataset-option:hover,
.dataset-option.-active {
  background-color: #f8f9fa;
}
```

### Dataset Tokens
```css
.research-chatbot-token {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.1);
  color: #FFFFFF;
  border-radius: 3px;
  font-size: 10px;
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  border: 1px solid rgba(255, 255, 255, 0.2);
  cursor: default;
  gap: 3px;
  width: fit-content;
  white-space: nowrap;
  overflow: hidden;
}

.research-chatbot-token-remove {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  transition: all 0.2s ease;
  flex-shrink: 0;
}
```

### Dataset Integration Features
- **@ Symbol Trigger**: Type `@` to show dataset dropdown
- **Search Filtering**: Filter datasets by typing after `@`
- **Token Display**: Selected datasets shown as removable tokens
- **Map Integration**: Tokens automatically add datasets to map
- **Auto-complete**: Friendly names with fallback to dataset names

## File Upload System

### Upload Button
```css
.research-chatbot-upload-button-inline {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #FFFFFF;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  font-size: 12px;
  font-weight: 300;
}
```

### File Token Styling
```css
.research-chatbot-token-file {
  background: rgba(255, 255, 255, 0.1) !important;
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.research-chatbot-token-file:hover {
  background: rgba(255, 255, 255, 0.15) !important;
}
```

### Supported File Types
- **Documents**: `.pdf`, `.doc`, `.docx`, `.txt`
- **Spreadsheets**: `.csv`, `.xlsx`, `.xls`
- **Multiple Files**: Supports multiple file selection
- **Hidden Input**: File input is hidden, triggered by button

## Responsive Design

### Mobile Configuration
```css
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
    border-radius: 8px;
  }

  .research-chatbot-messages {
    padding: 16px 20px;
  }

  .research-chatbot-input-container {
    padding: 16px 20px;
  }
}
```

### Responsive Properties
- **Mobile Width**: Full viewport minus 20px margin
- **Mobile Height**: 600px or 80vh maximum
- **Reduced Padding**: Smaller padding on mobile
- **Touch-Friendly**: Larger touch targets

## Integration Points

### WebSocket Integration
```javascript
// WebSocket message handling
const handleWebSocketMessage = useCallback((message) => {
  switch (message.type) {
    case 'agentStart':
    case 'agent_start':
      addMessage('system', message.data.name, 'intermediate');
      setIsLoading(true);
      break;
    case 'agentUpdate':
    case 'agent_update':
      updateLastMessage(message.message);
      break;
    case 'agentCompleted':
    case 'agent_completed':
      updateLastMessage(message.data.name, false, 'completed');
      if (message.data.lastAgent === true) {
        setIsLoading(false);
      }
      break;
    case 'chat_response':
    case 'chatResponse':
      addMessage('assistant', message.message, 'chat');
      setIsLoading(false);
      break;
  }
}, []);
```

### Redux Integration
```javascript
// Dataset integration with map
const selectDataset = useCallback(async (dataset) => {
  dispatch(toggleMapLayerGroup({ dataset, toggle: true }));
  setMapLayerGroupActive(dataset.id, dataset.defaultLayer);
}, [dispatch]);

const removeDataset = useCallback(async (selectedItem) => {
  dispatch(toggleMapLayerGroup({ dataset: selectedItem, toggle: false }));
  dispatch(resetMapLayerGroupsInteraction());
}, [dispatch]);
```

### Local Storage Integration
```javascript
// Conversation persistence
const saveConversation = (messages, conversationId) => {
  if (isStorageAvailable()) {
    localStorage.setItem('chatbot-conversation', JSON.stringify({
      messages,
      conversationId,
      timestamp: Date.now()
    }));
  }
};

const loadConversation = () => {
  if (isStorageAvailable()) {
    const stored = localStorage.getItem('chatbot-conversation');
    if (stored) {
      const { messages, conversationId } = JSON.parse(stored);
      return { messages, conversationId };
    }
  }
  return { messages: [], conversationId: null };
};
```

## Customization Guide

### Changing Panel Size
```css
/* Modify width */
.research-chatbot-dropdown {
  width: calc(400px + YOUR_EXTENSION); /* Change YOUR_EXTENSION */
}

/* Modify height */
.research-chatbot-container {
  height: calc(100vh - YOUR_MARGIN); /* Change YOUR_MARGIN */
  max-height: calc(100vh - YOUR_MARGIN);
}
```

### Changing Colors
```css
/* Panel background */
.research-chatbot-container {
  background: rgba(YOUR_R, YOUR_G, YOUR_B, YOUR_ALPHA);
}

/* Text colors */
.research-chatbot-message-content {
  color: YOUR_COLOR;
}

/* Button colors */
.research-chatbot-action-button {
  background: rgba(YOUR_R, YOUR_G, YOUR_B, YOUR_ALPHA);
  border: 1px solid YOUR_BORDER_COLOR;
  color: YOUR_TEXT_COLOR;
}
```

### Changing Typography
```css
/* Font family */
.research-chatbot-message-content,
.research-chatbot-input {
  font-family: 'YOUR_FONT', sans-serif;
}

/* Font sizes */
.research-chatbot-message-content {
  font-size: YOUR_SIZE; /* Default: 18px */
}

.research-chatbot-input {
  font-size: YOUR_SIZE; /* Default: 18px */
}
```

### Adding New Button Types
```css
.research-chatbot-action-button-YOUR_TYPE {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #FFFFFF;
  /* Add your custom styling */
}
```

## Code Snippets

### Complete Panel Styling
```css
.research-chatbot-dropdown {
  position: fixed;
  top: 55px;
  right: 8px;
  z-index: 9999;
  width: calc(400px + 65px);
  max-width: calc(100vw - 16px);
}

.research-chatbot-container {
  background: rgba(30, 30, 30, 0.85);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  width: 100%;
  height: calc(100vh - 75px);
  max-height: calc(100vh - 75px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #E0E0E0;
  position: relative;
}
```

### Complete Button Styling
```css
.research-chatbot-close-btn {
  position: absolute;
  bottom: 0px;
  right: 0px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 21px;
  color: #ffffff;
  z-index: 10;
  transition: all 0.2s ease;
}

.research-chatbot-action-button {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #FFFFFF;
  padding: 0;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  width: 24px;
  height: 24px;
  font-size: 12px;
  font-weight: 300;
}
```

### Complete Input Styling
```css
.research-chatbot-input {
  width: 100%;
  min-height: 180px;
  padding: 16px 20px;
  border: 1px solid #FFFFFF;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #FFFFFF;
  font-size: 18px;
  font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 300;
  outline: none;
  transition: all 0.2s ease;
  line-height: 1.4;
  box-sizing: border-box;
  word-wrap: break-word;
  white-space: pre-wrap;
}

.research-chatbot-input:focus {
  border-color: #FFFFFF;
  background: rgba(255, 255, 255, 0.15);
}

.research-chatbot-input::placeholder {
  color: rgba(255, 255, 255, 0.6);
}
```

### Complete Message Styling
```css
.research-chatbot-message-content {
  max-width: 100%;
  width: 100%;
  padding: 16px 20px;
  border-radius: 8px;
  font-size: 18px;
  line-height: 1.6;
  word-wrap: break-word;
  box-sizing: border-box;
}

.research-chatbot-message-user .research-chatbot-message-content {
  background: rgba(255, 255, 255, 0.15);
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 400;
}

.research-chatbot-message-assistant .research-chatbot-message-content {
  background: rgba(255, 255, 255, 0.08);
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 400;
}
```

---

This comprehensive documentation provides everything needed to understand, customize, and extend the chatbot panel UI system. All styling is embedded within the component using `<style jsx>` for component-scoped CSS, ensuring no global style conflicts.
.research-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: #4effd0;
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.25), 
              0 0 20px rgba(64, 224, 208, 0.6), 
              0 0 40px rgba(64, 224, 208, 0.4);
}
```

## Responsive Design

### Mobile Breakpoints
```css
@media screen and (max-width: 768px) {
  .research-chatbot-dropdown {
    top: 10px;
    right: 10px;
    width: calc(100vw - 20px);
  }
  
  .research-chatbot-container {
    width: 100%;
    height: 600px;
    max-height: 80vh;
    border-radius: 8px;
  }
}
```

## Common Modifications

### 1. Change Panel Width
To make the panel wider or narrower:
```css
width: calc(400px + [DESIRED_EXTENSION]px);
```

### 2. Move Close Button
To position the close button elsewhere:
```css
.research-chatbot-close-btn {
  position: absolute;
  top: [TOP_DISTANCE]px;    /* or bottom: [BOTTOM_DISTANCE]px */
  right: [RIGHT_DISTANCE]px; /* or left: [LEFT_DISTANCE]px */
}
```

### 3. Scale All Elements
To scale everything proportionally:
1. Change panel width
2. Multiply all font sizes by the same factor
3. Multiply all button sizes by the same factor
4. Adjust padding and margins proportionally

### 4. Change Color Scheme
To modify colors:
1. Update background colors in `.research-chatbot-container`
2. Update button colors in `.research-chatbot-close-btn`
3. Update text colors throughout the component

### 5. Modify Button Shapes
- **Square**: `border-radius: 6px` or `8px`
- **Circle**: `border-radius: 50%`
- **Rounded**: `border-radius: 12px` or higher

## File Structure

```
resource-watch/
├── components/research/
│   └── research-chatbot.jsx          # Main chatbot component
├── pages/dashboard/
│   └── index.jsx                      # Dashboard page with AI button
├── layout/explore/
│   └── component.jsx                  # Explore page with AI button
└── css/components/app/pages/
    └── explore.scss                   # AI button styling
```

## Key Features

1. **Conditional Rendering**: AI button hides when chatbot is open
2. **Absolute Positioning**: Close button positioned independently
3. **Responsive Design**: Adapts to different screen sizes
4. **Hover Effects**: Interactive feedback on buttons
5. **Consistent Styling**: Matches overall application design
6. **Accessibility**: Proper ARIA labels and keyboard navigation

## Troubleshooting

### Common Issues
1. **Button not visible**: Check z-index and positioning
2. **Styling not applied**: Verify CSS specificity and class names
3. **Responsive issues**: Check media query breakpoints
4. **Position conflicts**: Ensure proper absolute/fixed positioning

### Debug Tips
1. Use browser dev tools to inspect element positioning
2. Check console for CSS conflicts
3. Verify component state (isOpen) for conditional rendering
4. Test on different screen sizes for responsive behavior

---

**Last Updated**: December 2024
**Version**: 1.0
**Maintainer**: Development Team
