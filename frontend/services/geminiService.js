/**
 * Report generation service — calls the server-side API route (backed by GPT-4o)
 */

const MAX_REPORT_REQUEST_BYTES = 8 * 1024 * 1024;

const measureJsonBytes = (value) => {
  const json = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  return json.length;
};

const looksLikeAssistantMessage = (message = '') => {
  const messageText = String(message || '').trim();
  if (!messageText) return false;

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

  return (
    hasMarkdown ||
    (isLongMessage &&
      !messageText.startsWith('?') &&
      !messageText.toLowerCase().startsWith('what') &&
      !messageText.toLowerCase().startsWith('how'))
  );
};

const normalizeSenderForReport = (msg = {}) => {
  const sender = msg.sender;
  const isAssistantLike =
    msg.messageType === 'research_result' ||
    msg.messageType === 'intermediate' ||
    msg.messageType === 'completed' ||
    looksLikeAssistantMessage(msg.message);

  if (sender === 'assistant') {
    return 'assistant';
  }

  if (sender === 'bot') {
    return 'assistant';
  }

  if (isAssistantLike) {
    return 'assistant';
  }

  if (msg.messageType === 'user_query') {
    return 'user';
  }

  if (sender === 'user' || sender === 'system') {
    return sender;
  }

  return sender || 'user';
};

/**
 * Test report API with a simple request via server-side API
 * @returns {Promise<Object>} - Test result
 */
export const testGeminiAPI = async () => {
  try {
    console.log('🧪 Testing report API via server...');

    // Create a simple test conversation
    const testConversation = [
      {
        sender: 'user',
        message: 'Write a short paragraph about renewable energy in Peru',
        messageType: 'user_query',
        timestamp: new Date().toISOString(),
      },
      {
        sender: 'assistant',
        message:
          'Peru has significant potential for renewable energy development, particularly in solar and wind power. The country benefits from abundant sunshine in coastal regions and strong wind patterns in mountainous areas.',
        messageType: 'research_result',
        timestamp: new Date().toISOString(),
      },
    ];

    const response = await fetch('/api/gemini/generate-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation: testConversation,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ Gemini Test API Error:', response.status, errorData);
      return { success: false, error: errorData.error || 'Server error' };
    }

    const data = await response.json();
    console.log('🧪 Gemini Test Response:', data);

    if (data.success && data.report && data.report.content) {
      const content = data.report.content;
      console.log('✅ Gemini API Test Successful:', content.substring(0, 100) + '...');
      return { success: true, content };
    } else {
      console.error('❌ Gemini Test Invalid Response:', data);
      return { success: false, error: 'Invalid response format' };
    }
  } catch (error) {
    console.error('❌ Gemini Test Error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Generate a polished report from conversation data via server-side API (GPT-4o)
 * @param {Array} conversation - Array of conversation messages
 * @returns {Promise<Object>} - Generated report data
 */
export const generatePolishedReport = async (conversation) => {
  try {
    console.log('🤖 Report: Starting report generation from conversation...');

    if (!conversation || conversation.length === 0) {
      throw new Error('No conversation data provided');
    }

    console.log('🤖 Report: Calling server-side API route...');

    // Sanitize conversation before sending:
    //  - Strip inline base64 dataUrls from map snapshots (they're 50-300 KB each)
    //  - Keep Firebase Storage URLs intact (short strings, needed for <img> in report)
    //  - Trim individual messages to 8000 chars to avoid OpenAI token limits
    //  - Only keep fields the API uses
    const MAX_MSG_CHARS = 8000;
    let sanitized = conversation.map((msg) => {
      const base = {
        sender: normalizeSenderForReport(msg),
        messageType: msg.messageType,
        message:
          typeof msg.message === 'string' && msg.message.length > MAX_MSG_CHARS
            ? msg.message.slice(0, MAX_MSG_CHARS) + '\n[…truncated]'
            : msg.message || '',
        timestamp: msg.timestamp,
      };
      if (msg.messageType === 'map_snapshot' && msg.mapSnapshot) {
        const url = msg.mapSnapshot.url;
        // Only include the url if it's a real remote URL (not base64)
        const safeUrl = url && !url.startsWith('data:') ? url : null;
        base.mapSnapshot = { ...msg.mapSnapshot, url: safeUrl, dataUrl: null };
      }
      // Pass analysis_panel data through so the report can embed Plotly charts as iframes.
      // The html field is intentionally kept intact (no truncation) — it is injected verbatim
      // into the report and is not sent to the LLM.
      if (msg.messageType === 'analysis_panel' && msg.analysisPanel?.html) {
        base.analysisPanel = {
          index: msg.analysisPanel.index,
          total: msg.analysisPanel.total,
          title: msg.analysisPanel.title,
          html: msg.analysisPanel.html,
        };
      }
      return base;
    });

    const initialPayload = { conversation: sanitized };
    const initialPayloadBytes = measureJsonBytes(initialPayload);
    let droppedAnalysisPanelHtml = 0;

    if (initialPayloadBytes > MAX_REPORT_REQUEST_BYTES) {
      sanitized = sanitized.map((msg) => {
        if (msg.messageType === 'analysis_panel' && msg.analysisPanel?.html) {
          droppedAnalysisPanelHtml += 1;
          return {
            ...msg,
            analysisPanel: {
              ...msg.analysisPanel,
              html: '',
            },
          };
        }
        return msg;
      });

      console.warn(
        '⚠️ Report: request payload too large, dropping analysis panel HTML before API call.',
        {
          initialPayloadBytes,
          adjustedPayloadBytes: measureJsonBytes({ conversation: sanitized }),
          droppedAnalysisPanelHtml,
        },
      );
    }

    // Call our server-side API route instead of Gemini directly
    const response = await fetch('/api/gemini/generate-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversation: sanitized,
      }),
    });

    if (!response.ok) {
      const rawError = await response.text();
      let errorData = {};

      try {
        errorData = rawError ? JSON.parse(rawError) : {};
      } catch (_) {
        errorData = { error: rawError || 'Unknown error' };
      }

      console.error('❌ Gemini API Error:', response.status, errorData);

      throw new Error(
        `Server API error: ${response.status} - ${
          errorData.error || errorData.message || 'Unknown error'
        }`,
      );
    }

    const data = await response.json();
    console.log('🤖 Gemini: Server response received:', data);

    if (!data.success || !data.report) {
      console.error('❌ Gemini: Invalid server response:', data);
      throw new Error('Invalid response from server API');
    }

    const generatedContent = data.report.content;
    const isExecutiveHtml =
      typeof generatedContent === 'string' &&
      /<h1[^>]*>\s*Executive Summary\s*<\/h1>/i.test(generatedContent) &&
      /<h2/i.test(generatedContent);

    if (!isExecutiveHtml) {
      console.error('❌ Report: polished endpoint returned non-executive or non-HTML content');
      throw new Error('Polished report did not return the expected executive HTML structure');
    }

    console.log('🤖 Report: Generated content length:', generatedContent.length);
    console.log(
      '🤖 Report: Generated content preview:',
      generatedContent.substring(0, 200) + '...',
    );

    console.log('✅ Report: Report generated successfully');

    return {
      type: 'success',
      report: {
        title: data.report.title,
        content: generatedContent,
        generatedAt: data.report.generatedAt,
        source: data.report.source,
        conversationLength: data.report.conversationLength,
      },
    };
  } catch (error) {
    console.error('❌ Gemini report generation failed:', error);
    return {
      type: 'error',
      message: error.message,
      fallback: true,
    };
  }
};

/**
 * Fallback function to generate a simple report if Gemini fails
 * @param {Array} conversation - Array of conversation messages
 * @returns {Object} - Simple report data
 */
export const generateFallbackReport = (conversation) => {
  console.log('🔄 Using fallback report generation...');

  const assistantMessages = conversation
    .filter((msg) => msg.sender === 'assistant' && msg.messageType === 'research_result')
    .map((msg) => msg.message);

  const combinedContent = assistantMessages.join('\n\n---\n\n');

  return {
    type: 'success',
    report: {
      title: 'POLISENSE.AI REPORT',
      content: combinedContent,
      generatedAt: new Date().toISOString(),
      source: 'Fallback Generator',
      conversationLength: conversation.length,
    },
  };
};
