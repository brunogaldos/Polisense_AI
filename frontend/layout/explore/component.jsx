/* eslint-disable react/jsx-no-undef */
import { useState, useMemo, useCallback } from 'react';
import Head from 'next/head';

// components
import Layout from 'layout/layout/layout-app';
import Modal from 'components/modal/modal-component';
import Icon from 'components/ui/icon';
import ExploreSidebar from 'layout/explore/explore-sidebar';
import ExploreDatasets from 'layout/explore/explore-datasets';
import ExploreMap from 'layout/explore/explore-map';
import ExploreDetail from 'layout/explore/explore-detail';
import { ResearchChatbot } from 'components/research';

// lib
import { Media } from 'lib/media';

// constants
import { EXPLORE_SECTIONS } from './constants';

const Explore = (props) => {
  const {
    explore: {
      datasets: { selected },
      sidebar: { section, open },
      map: {
        drawer: { isDrawing },
      },
    },
    stopDrawing,
    dataset: datasetData,
    setSidebarOpen,
    setSidebarSection,
  } = props;
  const [mobileWarningOpened, setMobileWarningOpened] = useState(true);
  const [dataset, setDataset] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const handleClearPolygon = useCallback(() => {
    stopDrawing();
  }, [stopDrawing]);

  const getSidebarLayout = () => (
    <>
      {!selected && open && (
        <div className="explore-sidebar-content panel-style" id="sidebar-content-container" key={section}>
          <button 
            type="button" 
            className="panel-close-btn" 
            onClick={() => setSidebarOpen(false)}
            title="Close panel"
          >
            <Icon name="icon-cross" />
          </button>
          {section === EXPLORE_SECTIONS.ALL_DATA && <ExploreDatasets />}
        </div>
      )}
      {selected && (
        <ExploreDetail key={selected} onDatasetLoaded={(_dataset) => setDataset(_dataset)} />
      )}
    </>
  );

  const metadata = dataset?.metadata?.[0];
  const infoObj = metadata?.info;
  const titleSt = selected ? infoObj?.name : '';
  const descriptionSt = selected
    ? infoObj?.functions
    : 'Browse more than 200 global data sets on the state of our planet.';

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

      <Layout title={titleSt} description={descriptionSt} className="-fullscreen" isFullScreen>
        <Head>
          {datasetData && !datasetData?.published && <meta name="robots" content="noindex, follow" />}
        </Head>

        <div className="c-page-explore">
            <Media greaterThanOrEqual="md" className="flex flex-1">
              <>
                <ExploreSidebar key={section}>{getSidebarLayout()}</ExploreSidebar>
                {isDrawing && (
                  <div className="clear-polygon-container">
                    <button type="button" onClick={handleClearPolygon} className="c-btn -primary -alt">
                      Clear Polygon
                    </button>
                  </div>
                )}
                <ExploreMap />
              </>
            </Media>
          <Media at="sm" className="flex flex-1">
            <>
              {getSidebarLayout()}
              <Modal
                isOpen={mobileWarningOpened}
                onRequestClose={() => setMobileWarningOpened(false)}
              >
                <div>
                  <p>
                    The mobile version of Explore has limited functionality, please check the desktop
                    version to have access to the full list of features available.
                  </p>
                </div>
              </Modal>
            </>
          </Media>

          <ResearchChatbot
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
          />
        </div>
      </Layout>
    </>
  );
};

export default Explore;
