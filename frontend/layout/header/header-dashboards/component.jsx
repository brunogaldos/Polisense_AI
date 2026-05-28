import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import PropTypes from 'prop-types';
import { useDebouncedCallback } from 'use-debounce';
import Tether from 'react-tether';

// hooks
import { useDashboard } from 'contexts/DashboardContext';

// utils
import { generatePolishedReport, generateFallbackReport } from 'services/geminiService';
import { getChatLog } from 'services/research-api';

const HeaderDashboards = ({ children, href, label, testMode }) => {
  const router = useRouter();
  const [isVisible, setVisibility] = useState(false);
  const [isCreatingDashboard, setIsCreatingDashboard] = useState(false);
  const [creationProgress, setCreationProgress] = useState(0);

  const toggleDropdown = useDebouncedCallback((_isVisible) => {
    setVisibility(_isVisible);
  }, 50);

  const { lastAssistantMessage, fullConversation, memoryId, handleDashboardCreate } =
    useDashboard();

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

  const normalizeReportMessage = (msg = {}) => {
    const messageText = typeof msg.message === 'string' ? msg.message : '';
    const normalized = { ...msg, message: messageText };
    const sender = msg.sender;
    const isAssistantLike =
      msg.messageType === 'research_result' ||
      msg.messageType === 'intermediate' ||
      msg.messageType === 'completed' ||
      looksLikeAssistantMessage(messageText);

    if (sender === 'assistant') {
      return { ...normalized, sender: 'assistant' };
    }

    if (sender === 'bot') {
      return { ...normalized, sender: 'assistant' };
    }

    // Some valid assistant replies are restored with incorrect sender metadata.
    // Match the chatbot's current inference so report generation sees the same conversation.
    if (isAssistantLike) {
      return { ...normalized, sender: 'assistant' };
    }

    if (msg.messageType === 'user_query') {
      return { ...normalized, sender: 'user' };
    }

    if (sender === 'user' || sender === 'system') {
      return normalized;
    }

    return { ...normalized, sender: sender || 'user' };
  };

  const getNormalizedTimestamp = (timestamp) => {
    if (!timestamp) return '';

    try {
      if (timestamp instanceof Date) return timestamp.toISOString();
      if (typeof timestamp === 'string') return timestamp;
      if (timestamp?.toDate && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toISOString();
      }
      if (timestamp?.seconds) {
        return new Date(timestamp.seconds * 1000).toISOString();
      }
      return new Date(timestamp).toISOString();
    } catch (_) {
      return '';
    }
  };

  const getReportMessageKey = (msg = {}) =>
    [
      msg.sender || '',
      msg.messageType || '',
      (msg.message || '').trim(),
      getNormalizedTimestamp(msg.timestamp),
      msg.analysisPanel?.title || '',
      msg.mapSnapshot?.url || msg.mapSnapshot?.dataUrl || '',
    ].join('|');

  const mergeReportMessages = (...groups) => {
    const seen = new Set();

    return groups
      .flat()
      .map((msg) => normalizeReportMessage(msg))
      .filter((msg) => {
        const key = getReportMessageKey(msg);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const hasRenderableAssistantContent = (conversation = []) =>
    conversation.some((entry) => {
      const msg = normalizeReportMessage(entry);
      if (msg?.sender !== 'assistant') return false;
      if (typeof msg?.message !== 'string' || msg.message.trim().length === 0) return false;

      return [
        undefined,
        null,
        '',
        'text',
        'research_result',
        'geojson',
        'geojson_rag',
        'completed',
      ].includes(msg.messageType);
    });

  /**
   * Build the richest possible conversation array for report generation:
   *  1. Fetch the full chatLog from the backend (all stored messages).
   *  2. Merge in any local-only messages (map_snapshot) from fullConversation
   *     that don't exist in the backend log (they are never persisted to Firestore).
   */
  const buildReportConversation = async () => {
    let baseMessages = (fullConversation || []).map(normalizeReportMessage);

    // Attempt to fetch the full history from the backend
    if (memoryId) {
      baseMessages = [];

      try {
        const chatLogData = await getChatLog(memoryId);
        if (chatLogData?.chatLog?.length > 0) {
          // Convert Firestore chatLog to the same shape the report API expects
          const backendMessages = chatLogData.chatLog.map((msg) =>
            normalizeReportMessage({
              sender: msg.sender,
              message: msg.message || '',
              messageType: msg.messageType,
              timestamp: msg.timestamp,
            }),
          );

          // When memoryId exists, the backend chat log is the source of truth for
          // the conversation text. Only supplement it with local-only message
          // types that are never persisted to Firestore, scoped to this memoryId.
          const localConversationArtifacts = (fullConversation || []).filter(
            (msg) =>
              msg.memoryId === memoryId &&
              (msg.messageType === 'map_snapshot' || msg.messageType === 'analysis_panel'),
          );

          baseMessages = mergeReportMessages(backendMessages, localConversationArtifacts);
        }
      } catch (err) {
        console.warn(
          '⚠️ Could not fetch full chat log for the active memoryId; refusing to fall back to unscoped cached text:',
          err.message,
        );
      }
    }

    return baseMessages;
  };

  // Function to create a dummy test dashboard with loading state
  const createDummyDashboard = async (e) => {
    e.preventDefault();

    // Show loading state
    setIsCreatingDashboard(true);
    setCreationProgress(0);
    let progressInterval = null;

    // Create sample conversation data with raw content
    const dummyConversation = [
      {
        sender: 'user',
        message:
          'Analyze the opportunities and challenges for solar energy development in Arequipa, Peru',
        messageType: 'user_query',
        timestamp: new Date().toISOString(),
      },
      {
        sender: 'assistant',
        message: `Based on the dataset provided, there are several key opportunities and challenges for a just and sustainable energy transition based on solar energy in Arequipa city and its districts. Here's a detailed overview:

Opportunities
    1. High Solar Radiation Potential: The dataset indicates that La Joya, a district in southern Peru, has significant solar radiation, making it an ideal candidate for solar energy development. This district is noted for its high solar radiation and is attracting interest from foreign entrepreneurs to develop photovoltaic plants. This potential can be leveraged to create a clean energy hub.
    2. Existing Infrastructure: There are already several operational solar power plants in La Joya, with more under construction. This existing infrastructure provides a foundation for further expansion and investment in solar energy projects.
    3. Green Hydrogen Projects: Proposals for green hydrogen projects in the region highlight additional avenues for sustainable energy development. This diversification can enhance energy security and create a more resilient energy system.

Challenges
    1. Community Engagement: The dataset points out a significant barrier related to the lack of community engagement and information dissemination by companies and the government. This can lead to resistance from local populations and hinder project implementation.
    2. Land Use Conflicts: Potential conflicts between urban growth, agriculture, industrial zones, and renewable energy development pose a challenge to the implementation of solar projects. Addressing these conflicts will be critical to ensure sustainable development.
    3. Regulatory Hurdles: There are regulatory and policy challenges that need to be overcome for the successful implementation of renewable energy projects. The current regulatory framework may not be fully supportive of large-scale solar and hydrogen projects.
    4. Financial Risks: The dataset highlights financial and investment risks associated with large-scale renewable energy projects, which can deter potential investors and slow down project timelines.

Specific Data Points
    • Population Density: While specific population density figures for Arequipa city and its districts are not provided in the dataset, understanding the demographics will be crucial in targeting community engagement efforts.
    • Annual Average Nighttime Lights Intensity: This measure can serve as an indirect indicator of economic activity and energy consumption patterns in different districts, although specific figures are not available in the dataset.
    • Average Daily Solar Energy Potential: The dataset emphasizes La Joya's high solar radiation, which supports the feasibility of solar energy projects.

Policy Recommendations
    1. Enhance Community Engagement: Develop programs that foster community engagement and transparency in solar energy projects. This could involve local leaders and organizations to ensure that the community is informed and involved in decision-making processes.
    2. Address Land Use Conflicts: Implement land use planning strategies that consider the needs of agriculture, urban development, and renewable energy. This could involve zoning laws that protect agricultural land while allowing for solar development in suitable areas.
    3. Strengthen Regulatory Framework: Advocate for a supportive regulatory environment that facilitates the development of solar and hydrogen projects. This may include streamlining permitting processes and providing incentives for renewable energy investments.
    4. Mitigate Financial Risks: Explore innovative financing models, such as public-private partnerships or green bonds, to reduce the financial burden on investors and encourage investment in solar energy projects.

District Rankings and Scores
While specific district rankings and scores are not detailed in the dataset, it is essential to conduct a comprehensive analysis of each district's readiness for solar energy projects based on factors such as solar potential, existing infrastructure, community support, and regulatory environment.

Conclusion
Based on the dataset provided, Arequipa city, particularly the La Joya district, presents significant opportunities for a sustainable energy transition through solar energy. However, challenges such as community engagement, land use conflicts, regulatory hurdles, and financial risks must be addressed to ensure the success of these initiatives. The recommendations outlined can guide policy and investment priorities to facilitate a just energy transition.

For further reading, you can refer to the original source here. (@https://dialogue.earth/en/energy/is-this-desert-in-southern-peru-latin-americas-next-clean-energy-hub/ )`,
        messageType: 'research_result',
        timestamp: new Date().toISOString(),
      },
    ];

    try {
      // Simulate progress updates
      progressInterval = setInterval(() => {
        setCreationProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + Math.random() * 10;
        });
      }, 200);

      // Generate polished report using Gemini
      const geminiResult = await generatePolishedReport(dummyConversation);

      // Complete progress
      setCreationProgress(100);
      clearInterval(progressInterval);
      await new Promise((resolve) => setTimeout(resolve, 150));

      if (geminiResult.type === 'error') {
        // Check if it's a free tier not enabled error
        if (geminiResult.message && geminiResult.message.includes('Free tier not enabled')) {
          alert(
            `⚠️ Free Tier Not Enabled\n\nYour Google Cloud project doesn't have the free tier quota enabled.\n\nTo fix this:\n\n1. Go to Google Cloud Console: https://console.cloud.google.com/\n2. Select your project\n3. Go to "Billing" and link a billing account (required even for free tier)\n4. Go to "APIs & Services" > "Library" and enable "Generative Language API"\n5. Wait 15-60 minutes for the free tier quota to activate\n\nAlternatively, get a free API key from Google AI Studio:\nhttps://aistudio.google.com/app/apikey`,
          );

          // Use fallback report generation
          const fallbackResult = generateFallbackReport(dummyConversation);

          const dashboardData = {
            type: 'dashboard',
            title: fallbackResult.report.title,
            template: 'policy_research_report',
            sections: [
              {
                id: 'text_content_1',
                title: 'Report Content',
                type: 'text_content',
                data: {
                  content: fallbackResult.report.content,
                },
              },
            ],
            metadata: {
              source: fallbackResult.report.source,
              generatedAt: fallbackResult.report.generatedAt,
              conversationLength: fallbackResult.report.conversationLength,
            },
          };

          handleDashboardCreate(dashboardData);
        } else {
          // Other errors - use fallback silently
          console.warn('⚠️ Gemini report generation failed, using fallback:', geminiResult.message);
          const fallbackResult = generateFallbackReport(dummyConversation);

          const dashboardData = {
            type: 'dashboard',
            title: fallbackResult.report.title,
            template: 'policy_research_report',
            sections: [
              {
                id: 'text_content_1',
                title: 'Report Content',
                type: 'text_content',
                data: {
                  content: fallbackResult.report.content,
                },
              },
            ],
            metadata: {
              source: fallbackResult.report.source,
              generatedAt: fallbackResult.report.generatedAt,
              conversationLength: fallbackResult.report.conversationLength,
            },
          };

          handleDashboardCreate(dashboardData);
        }
      } else {
        // Create dashboard data structure for Gemini report
        const dashboardData = {
          type: 'dashboard',
          title: geminiResult.report.title,
          template: 'policy_research_report',
          sections: [
            {
              id: 'gemini_report_1',
              title: 'AI Enhanced Report',
              type: 'gemini_report',
              data: {
                content: geminiResult.report.content,
                source: geminiResult.report.source,
                generatedAt: geminiResult.report.generatedAt,
              },
            },
          ],
          metadata: {
            source: geminiResult.report.source,
            generatedAt: geminiResult.report.generatedAt,
            conversationLength: geminiResult.report.conversationLength,
          },
        };

        handleDashboardCreate(dashboardData);
      }

      await router.push('/dashboard');
    } catch (error) {
      console.error('Error creating dashboard:', error);
      alert(`Error creating dashboard: ${error.message}`);
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      // Reset loading state
      setIsCreatingDashboard(false);
      setCreationProgress(0);
    }
  };

  // Function to create dashboard from full conversation using Gemini
  const createDashboard = async (e) => {
    e.preventDefault();

    if (!fullConversation?.length && !memoryId) {
      alert('Please chat with the AI first to generate a response for dashboard creation.');
      return;
    }

    // Show loading state
    setIsCreatingDashboard(true);
    setCreationProgress(0);
    let progressInterval = null;

    try {
      // Fetch the full conversation (backend history + local snapshots)
      const reportConversation = await buildReportConversation();

      if (!reportConversation || reportConversation.length === 0) {
        alert('No conversation content found. Please chat with the AI first.');
        setIsCreatingDashboard(false);
        return;
      }

      if (!hasRenderableAssistantContent(reportConversation)) {
        throw new Error(
          'No assistant report content is available yet. Wait for the AI response to finish, then try again.',
        );
      }

      // Simulate progress updates
      progressInterval = setInterval(() => {
        setCreationProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + Math.random() * 10;
        });
      }, 200);

      // Generate polished report using GPT-4o
      const geminiResult = await generatePolishedReport(reportConversation);

      // Complete progress
      setCreationProgress(100);
      clearInterval(progressInterval);
      await new Promise((resolve) => setTimeout(resolve, 150));

      if (geminiResult.type === 'error') {
        throw new Error(geminiResult.message || 'Polished executive report generation failed');
      } else {
        // Create dashboard data structure for Gemini report
        const dashboardData = {
          type: 'dashboard',
          title: geminiResult.report.title,
          template: 'policy_research_report',
          sections: [
            {
              id: 'gemini_report_1',
              title: 'AI Enhanced Report',
              type: 'gemini_report',
              data: {
                content: geminiResult.report.content,
                source: geminiResult.report.source,
                generatedAt: geminiResult.report.generatedAt,
              },
            },
          ],
          metadata: {
            source: geminiResult.report.source,
            generatedAt: geminiResult.report.generatedAt,
            conversationLength: geminiResult.report.conversationLength,
          },
        };

        handleDashboardCreate(dashboardData);
      }

      // Client-side navigation preserves DashboardContext even if localStorage
      // persistence fails for a large report payload.
      await router.push('/dashboard');
    } catch (error) {
      console.error('Error creating dashboard:', error);
      alert(`Error creating dashboard: ${error.message}`);
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      // Reset loading state
      setIsCreatingDashboard(false);
      setCreationProgress(0);
    }
  };

  return (
    <>
      <Tether
        attachment="top center"
        constraints={[
          {
            to: 'window',
          },
        ]}
        classes={{ element: 'c-header-dropdown dashboard-dropdown' }}
        renderTarget={(ref) => (
          <Link href={href}>
            <a
              ref={ref}
              onMouseEnter={() => toggleDropdown(true)}
              onMouseLeave={() => toggleDropdown(false)}
            >
              {label}
            </a>
          </Link>
        )}
        renderElement={(ref) => {
          if (!isVisible) return null;

          return (
            <ul
              ref={ref}
              className="header-dropdown-list"
              onMouseEnter={() => toggleDropdown(true)}
              onMouseLeave={() => toggleDropdown(false)}
            >
              {/* Render children (passed from header constants) */}
              {children &&
                children.map((c) => {
                  // Skip empty items (used for spacing)
                  if (!c.label) return null;

                  return (
                    <li
                      key={c.label}
                      className="header-dropdown-list-item"
                      role="button"
                      tabIndex={-1}
                    >
                      {c.label === 'Create New Report' ? (
                        <a
                          onClick={createDashboard}
                          className="header-dropdown-create-option"
                          title={
                            !lastAssistantMessage
                              ? 'Chat with AI first to create a dashboard'
                              : 'Create dashboard from AI response'
                          }
                        >
                          Create New Report
                        </a>
                      ) : (
                        <Link href={c.href}>
                          <a>{c.label}</a>
                        </Link>
                      )}
                    </li>
                  );
                })}
            </ul>
          );
        }}
      />

      {/* Creating Dashboard Loading Modal */}
      {isCreatingDashboard && (
        <div
          style={{
            position: 'fixed',
            top: 'calc(50% + 600px)',
            left: 'calc(50% - 980px)',
            transform: 'translate(-50%, -50%)',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              backgroundColor: '#44546a',
              padding: '20px',
              borderRadius: '8px',
              textAlign: 'center',
              minWidth: '200px',
              boxShadow: '0 5px 15px rgba(0, 0, 0, 0.3)',
              color: 'white',
              fontFamily: 'Arial, sans-serif',
            }}
          >
            <h3 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>Creating Report</h3>
            <div
              style={{
                width: '100%',
                height: '12px',
                backgroundColor: '#34495e',
                borderRadius: '6px',
                overflow: 'hidden',
                marginBottom: '15px',
              }}
            >
              <div
                style={{
                  width: `${creationProgress}%`,
                  height: '100%',
                  backgroundColor: '#3498db',
                  borderRadius: '6px',
                  transition: 'width 0.3s ease',
                  background: 'linear-gradient(90deg, #3498db, #2ecc71)',
                }}
              />
            </div>
            <p style={{ margin: '0', fontSize: '12px', color: '#bdc3c7' }}>
              {Math.round(creationProgress)}% Complete
            </p>
          </div>
        </div>
      )}
    </>
  );
};

HeaderDashboards.propTypes = {
  children: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      href: PropTypes.string.isRequired,
    }),
  ),
  href: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
};

export default HeaderDashboards;
