import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

// components
import Layout from 'layout/layout/layout-app';
import TabbedDashboard from 'components/dashboards/tabbed-dashboard';
import DynamicDashboard from 'components/dashboards/dynamic-dashboard';
import { ResearchChatbot } from 'components/research';
import { useDashboard } from 'contexts/DashboardContext';

function DashboardPageContent() {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const { dynamicDashboardData, showDynamicDashboard, handleBackToDefault, setAssistantMessage, handleDashboardCreate } = useDashboard();


  return (
    <>
      {/* AI Assistant Button - Hidden when chat is open */}
      {!isChatOpen && (
        <button
          className="research-btn"
          onClick={() => setIsChatOpen(!isChatOpen)}
        >
          <img src="/favicon.ico" alt="AI Icon" className="ai-button-icon" />
          <span>AI</span>
        </button>
      )}

      <Layout
        title="Dashboard"
        description="Environmental policy analysis and stakeholder management dashboard"
        className={`-fullscreen -dashboard-page ${isChatOpen ? '-chat-open' : ''}`}
        isFullScreen
      >
        <div className={`c-dashboard-page ${isChatOpen ? '-chat-open' : ''}`}>
          <div className="c-dashboard-page__container">
            {/* Dashboard Content */}
            {showDynamicDashboard && dynamicDashboardData ? (
              <DynamicDashboard dashboardData={dynamicDashboardData} />
            ) : (
              <TabbedDashboard />
            )}
          </div>
        </div>

        <ResearchChatbot
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          onAssistantMessage={setAssistantMessage}
        />
      </Layout>

    </>
  );
}

DashboardPageContent.propTypes = {};

export default DashboardPageContent;
