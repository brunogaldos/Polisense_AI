import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { toastr } from 'react-redux-toastr';
import debounce from 'lodash/debounce';
import isEmpty from 'lodash/isEmpty';
import { useDebouncedCallback } from 'use-debounce';
import {
  Legend,
  LegendListItem,
  LegendItemToolbar,
  LegendItemButtonLayers,
  LegendItemButtonOpacity,
  LegendItemButtonVisibility,
  LegendItemButtonInfo,
  LegendItemTypes,
  LegendItemTimeStep,
} from 'vizzuality-components';
import { LegendItemTimeline } from 'old-vizzuality-components';

// components
import Modal from 'components/modal/modal-component';
import LayerInfoModal from 'components/modal/layer-info-modal';
import Spinner from 'components/ui/Spinner';
import Map from 'components/map';
import LayerManager from 'components/map/layer-manager';
import MapControls from 'components/map/controls';
import ZoomControls from 'components/map/controls/zoom';
import ShareControls from 'components/map/controls/share';
import BasemapControls from 'components/map/controls/basemap';
import SearchControls from 'components/map/controls/search';
import ResetViewControls from 'components/map/controls/reset-view';
import Drawer from 'components/map/plugins/drawer';
import LayerPopup from 'components/map/popup';

import { getUserAreaLayer } from 'components/map/utils';

// utils
import { WRIAPI } from 'utils/axios';
import WRISerializer from 'wri-json-api-serializer';

// constants
import {
  MAPSTYLES,
  USER_AREA_LAYER_TEMPLATES,
  BASEMAP_LABEL_DICTIONARY,
} from 'components/map/constants';

// constants
import { LEGEND_TIMELINE_PROPERTIES, TIMELINE_THRESHOLD } from './constants';

const ExploreMap = (props) => {
  const {
    token,
    userId,
    embed,
    viewport,
    basemap,
    bounds,
    labels,
    boundaries,
    activeLayers,
    activeInteractiveLayers,
    layerGroups,
    layerGroupsInteraction,
    layerGroupsInteractionSelected,
    layerGroupsInteractionLatLng,
    drawer: { isDrawing },
    stopDrawing,
    exploreBehavior,
    onLayerInfoButtonClick,
    setSelectedDataset,
    setSidebarAnchor,
    setMapLayerGroupVisibility,
    setMapLayerGroupsInteractionLatLng,
    setMapLayerGroupsInteraction,
    setMapLayerGroupActive,
    setMapLayerGroupsInteractionSelected,
    resetMapLayerGroupsInteraction,
    resetLayerParametrization,
    toggleMapLayerGroup,
    removeLayerParametrization,
    setMapLayerGroupsOrder,
    setMapLayerParametrization,
    setBoundaries,
    setViewport,
    setBounds,
    setBasemap,
    setLabels,
    setDataDrawing,
    aoi,
    previewAoi,
    geojsonLayers,
  } = props;
  const [mapState, setMapState] = useState({
    layer: null,
    loading: {},
  });
  const [displayedLayers, setDisplayedLayers] = useState([...activeLayers]);
  const [geocatminTooltip, setGeocatminTooltip] = useState(null);
  const mapInstanceRef = useRef(null);


  const onChangeInfo = useCallback(
    (layer) => {
      setMapState({
        ...mapState,
        layer,
      });

      if (layer) {
        if (exploreBehavior && onLayerInfoButtonClick) {
          onLayerInfoButtonClick(layer);
        } else {
          setSelectedDataset(layer.dataset);
          setSidebarAnchor('layers');
        }
      }
    },
    [mapState, exploreBehavior, onLayerInfoButtonClick, setSelectedDataset, setSidebarAnchor],
  );

  const onChangeOpacity = debounce((l, opacity) => {
    const { setMapLayerGroupOpacity } = props;
    setMapLayerGroupOpacity({ dataset: { id: l.dataset }, opacity });
  }, 250);

  const onChangeVisibility = useCallback(
    (l, visibility) => {
      setMapLayerGroupVisibility({
        dataset: { id: l.dataset },
        visibility,
      });
    },
    [setMapLayerGroupVisibility],
  );

  const onChangeLayer = useCallback(
    (l) => {
      resetLayerParametrization();

      setMapLayerGroupActive({
        dataset: { id: l.dataset },
        active: l.id,
      });
    },
    [resetLayerParametrization, setMapLayerGroupActive],
  );

  const onRemoveLayer = useCallback(
    (l) => {
      toggleMapLayerGroup({
        dataset: { id: l.dataset },
        toggle: false,
      });

      removeLayerParametrization(l.id);
    },
    [toggleMapLayerGroup, removeLayerParametrization],
  );

  const onChangeOrder = useCallback(
    (datasetIds) => {
      setMapLayerGroupsOrder({ datasetIds });
    },
    [setMapLayerGroupsOrder],
  );

  const onChangeLayerDate = useCallback(
    (dates, layer) => {
      const {
        id,
        layerConfig: { decode_config: decodeConfig },
      } = layer;

      setMapLayerParametrization({
        id,
        nextConfig: {
          ...(decodeConfig && {
            decodeParams: {
              startDate: dates[0],
              endDate: dates[1],
            },
          }),
          ...(!decodeConfig && {
            params: {
              startDate: dates[0],
              endDate: dates[1],
            },
          }),
        },
      });
    },
    [setMapLayerParametrization],
  );

  const onChangeLayerTimeLine = useCallback(
    (l) => {
      setMapLayerGroupActive({ dataset: { id: l.dataset }, active: l.id });
    },
    [setMapLayerGroupActive],
  );

  const onClickLayer = useCallback(
    ({ features, lngLat }) => {
      let interactions = {};

      // if the user clicks on a zone where there is no data in any current layer
      // we will reset the current interaction of those layers to display "no data available" message
      if (!features.length) {
        interactions = Object.keys(layerGroupsInteraction).reduce(
          (accumulator, currentValue) => ({
            ...accumulator,
            [currentValue]: {},
          }),
          {},
        );
      } else {
        interactions = features.reduce(
          (accumulator, currentValue) => ({
            ...accumulator,
            [currentValue.layer.source]: { data: currentValue.properties },
          }),
          {},
        );
      }

      setMapLayerGroupsInteractionLatLng({
        longitude: lngLat[0],
        latitude: lngLat[1],
      });
      setMapLayerGroupsInteraction(interactions);

      return true;
    },
    [layerGroupsInteraction, setMapLayerGroupsInteractionLatLng, setMapLayerGroupsInteraction],
  );

  // Compute interactive layer IDs for MCP-rendered layers (concessions + pins)
  // so react-map-gl fires hover events on them.
  const mcpInteractiveLayerIds = useMemo(() => {
    return (geojsonLayers || [])
      .filter((l) => l.id?.startsWith('geocatmin-concessions-') || l.id?.startsWith('geo-pins-'))
      .flatMap((l) =>
        (l.layerConfig?.render?.layers || []).map(
          (sl, i) => sl.id || `${l.id}-${sl.type}-${i}`
        )
      );
  }, [geojsonLayers]);

  const allInteractiveLayerIds = useMemo(
    () => [...activeInteractiveLayers, ...mcpInteractiveLayerIds],
    [activeInteractiveLayers, mcpInteractiveLayerIds]
  );

  const onHoverLayer = useCallback(
    ({ features, point, lngLat }) => {
      if (!features || !features.length) {
        setGeocatminTooltip(null);
        return;
      }

      // Pin hit — show name + coordinates from feature geometry
      const pinHit = features.find((f) =>
        f.layer?.source?.startsWith('geo-pins-')
      );
      if (pinHit) {
        const coords = pinHit.geometry?.coordinates ?? lngLat ?? [0, 0];
        setGeocatminTooltip({
          x: point[0],
          y: point[1],
          type: 'pin',
          properties: pinHit.properties,
          coords: [coords[0], coords[1]],
        });
        return;
      }

      // Polygon hit — show concession fields + cursor coordinates
      const polyHit = features.find((f) =>
        f.layer?.source?.startsWith('geocatmin-concessions-')
      );
      if (polyHit) {
        setGeocatminTooltip({
          x: point[0],
          y: point[1],
          type: 'polygon',
          properties: polyHit.properties,
          coords: lngLat ? [lngLat[0], lngLat[1]] : null,
        });
      } else {
        setGeocatminTooltip(null);
      }
    },
    []
  );

  const onChangeInteractiveLayer = useCallback(
    (selected) => {
      setMapLayerGroupsInteractionSelected(selected);
    },
    [setMapLayerGroupsInteractionSelected],
  );

  const handleClosePopup = useCallback(() => {
    resetMapLayerGroupsInteraction();
  }, [resetMapLayerGroupsInteraction]);

  const handleSearch = useCallback(
    (locationParams) => {
      setBounds({
        ...locationParams,
        options: { zoom: 2 },
      });
    },
    [setBounds],
  );

  const handleViewport = useDebouncedCallback((_viewport) => {
    setViewport(_viewport);
  }, 250);

  const handleBoundaries = useCallback(
    (_boundaries) => {
      setBoundaries(_boundaries);
    },
    [setBoundaries],
  );

  const handleZoom = useCallback(
    (zoom) => {
      setViewport({
        zoom,
        // transitionDuration is always set to avoid mixing
        // durations of other actions (like flying)
        transitionDuration: 250,
      });
    },
    [setViewport],
  );

  const handleBasemap = useCallback(
    (_basemap) => {
      const { id } = _basemap;
      setBasemap(id);
      if (labels.value !== 'none') setLabels(BASEMAP_LABEL_DICTIONARY[id]);
    },
    [setBasemap, setLabels, labels],
  );

  const handleResetView = useCallback(() => {
    setViewport({
      bearing: 0,
      pitch: 0,
      // transitionDuration is always set to avoid mixing
      // durations of other actions (like flying)
      transitionDuration: 250,
    });
  }, [setViewport]);

  const handleLabels = useCallback(
    ({ value }) => {
      setLabels(value);
    },
    [setLabels],
  );

  const handleMapCursor = useCallback(
    ({ isHovering, isDragging }) => {
      if (isDrawing && isDragging) return 'grabbing';
      if (isDrawing) return 'crosshair';
      if (isHovering) return 'pointer';

      return 'grab';
    },
    [isDrawing],
  );

  const handleDrawComplete = useCallback(
    (geojson) => {
      setDataDrawing(geojson);
    },
    [setDataDrawing],
  );

  const handleDrawEscapeKey = useCallback(() => {
    stopDrawing();
  }, [stopDrawing]);

  const { loading, layer } = mapState;
  const { pitch, bearing } = viewport;
  const resetViewBtnClass = classnames({
    '-with-transition': true,
    '-visible': pitch !== 0 || bearing !== 0,
  });

  useEffect(() => {
    setDisplayedLayers((prevLayers) => [
      ...prevLayers.filter(({ isAreaOfInterest }) => isAreaOfInterest),
      ...activeLayers,
      ...(geojsonLayers || []),
    ]);
  }, [activeLayers, aoi, geojsonLayers]);

  // ── Map snapshot via CustomEvent ──────────────────────────────────────────
  // The research chatbot fires 'polisense:capture_map' after adding a GeoJSON layer.
  // We wait for the map to finish rendering (idle), then capture the WebGL canvas
  // and broadcast the result as 'polisense:map_captured'.
  useEffect(() => {
    const handleCapture = () => {
      const map = mapInstanceRef.current;
      if (!map) return;

      const doCapture = () => {
        try {
          const dataUrl = map.getCanvas().toDataURL('image/jpeg', 0.82);
          window.dispatchEvent(
            new CustomEvent('polisense:map_captured', { detail: { dataUrl } })
          );
        } catch (err) {
          console.warn('⚠️ Map snapshot capture failed:', err);
        }
      };

      // If the map is already settled, capture immediately; otherwise wait for idle.
      if (!map.isMoving() && !map.isZooming() && !map.isRotating()) {
        doCapture();
      } else {
        map.once('idle', doCapture);
      }
    };

    window.addEventListener('polisense:capture_map', handleCapture);
    return () => window.removeEventListener('polisense:capture_map', handleCapture);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fetchAreaOfInterest = async () => {
      try {
        const {
          geostore: geostoreId,
          public: isPublicArea,
          userId: areaUserId,
        } = await WRIAPI.get(`/v2/area/${aoi}`, {
          headers: { Authorization: token, 'Upgrade-Insecure-Requests': 1 },
          params: { env: process.env.NEXT_PUBLIC_API_ENV },
        }).then((response) => WRISerializer(response.data));

        if (!isPublicArea && areaUserId !== userId) throw new Error('This area is private.');

        const { id, geojson, bbox } = await WRIAPI.get(`/v1/geostore/${geostoreId}`).then((res) => WRISerializer(res.data));

        const aoiLayer = getUserAreaLayer(
          {
            id,
            geojson,
          },
          USER_AREA_LAYER_TEMPLATES.explore,
        );

        setDisplayedLayers((prevLayers) => [
          aoiLayer,
          ...prevLayers.filter(({ isAreaOfInterest }) => !isAreaOfInterest),
        ]);

        setBounds({
          bbox,
          options: {
            padding: 50,
          },
        });
      } catch (e) {
        toastr.error(e.message);
      }
    };

    const fetchPreviewAoI = async () => {
      const { id, geojson, bbox } = await WRIAPI.get(`/v1/geostore/${previewAoi}`).then((res) => WRISerializer(res.data));
      const aoiLayer = getUserAreaLayer(
        {
          id,
          geojson,
        },
        USER_AREA_LAYER_TEMPLATES.explore,
      );

      setDisplayedLayers((prevLayers) => [
        aoiLayer,
        ...prevLayers.filter(({ isAreaOfInterest }) => !isAreaOfInterest),
      ]);

      setBounds({
        bbox,
        options: {
          padding: 50,
        },
      });
    };

    if (aoi) fetchAreaOfInterest();
    else if (previewAoi) fetchPreviewAoI();
    else {
      // if the user removes the AoI, filter it to avoid display it in the map
      setDisplayedLayers((prevLayers) => [
        ...prevLayers.filter(({ isAreaOfInterest }) => !isAreaOfInterest),
      ]);
    }
  }, [aoi, token, userId, setBounds, previewAoi]);

  return (
    <div className="l-explore-map -relative">
      {/* Brand logo */}
      {embed && (
        <div className="embedded-rw-logo">
          <img
            srcSet="/static/images/embed/embed-map-logo@2x.png 2x,
                    /static/images/embed/embed-map-logo.png 1x"
            alt="Polisense"
            src=" /static/images/embed/embed-map-logo.png 1x"
          />
        </div>
      )}

      {Object.keys(loading)
        .map((k) => loading[k])
        .some((l) => !!l) && <Spinner isLoading />}

      <Map
        {...(!isDrawing && { onClick: onClickLayer })}
        onHover={onHoverLayer}
        interactiveLayerIds={allInteractiveLayerIds}
        mapStyle={MAPSTYLES}
        viewport={viewport}
        bounds={bounds}
        basemap={basemap.value}
        labels={labels.value}
        boundaries={boundaries}
        getCursor={handleMapCursor}
        className={classnames({ 'map-overlays-no-pointer-events': isDrawing })}
        onMapViewportChange={handleViewport}
      >
        {(_map) => {
          // Store map instance in ref for useEffect
          mapInstanceRef.current = _map;

          return (
            <>
              <LayerManager map={_map} layers={displayedLayers} />

              <Drawer
                map={_map}
                drawing={isDrawing}
                onEscapeKey={handleDrawEscapeKey}
                onDrawComplete={handleDrawComplete}
              />

              {!isEmpty(layerGroupsInteractionLatLng) && activeLayers.length && !isDrawing && (
                <Popup
                  {...layerGroupsInteractionLatLng}
                  closeButton
                  closeOnClick={false}
                  onClose={handleClosePopup}
                  className="rw-popup-layer"
                  maxWidth="250px"
                  captureScroll
                  capturePointerMove
                >
                  <LayerPopup
                    data={{
                      // data available in certain point
                      layersInteraction: layerGroupsInteraction,
                      // ID of the layer will display data (defaults into the first layer)
                      layersInteractionSelected: layerGroupsInteractionSelected,
                      // current active layers to get their layerConfig attributes
                      layers: activeLayers,
                    }}
                    latlng={{
                      lat: layerGroupsInteractionLatLng.latitude,
                      lng: layerGroupsInteractionLatLng.longitude,
                    }}
                    onChangeInteractiveLayer={onChangeInteractiveLayer}
                  />
                </Popup>
              )}
            </>
          );
        }}
      </Map>

      {geocatminTooltip && (() => {
        const { x, y, type, properties: p, coords } = geocatminTooltip;
        const coordLine = coords
          ? `${coords[1].toFixed(5)}°, ${coords[0].toFixed(5)}°`
          : null;

        return (
          <div
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: 'translate(-50%, calc(-100% - 16px))',
              background: 'rgba(10, 17, 30, 0.96)',
              color: '#f1f5f9',
              padding: '12px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              lineHeight: '1.65',
              pointerEvents: 'none',
              zIndex: 9999,
              maxWidth: '300px',
              minWidth: '180px',
              boxShadow: '0 6px 24px rgba(0,0,0,0.7)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {type === 'pin' ? (
              <>
                {/* Pin tooltip */}
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px', color: '#e2e8f0' }}>
                  📍 {p.name || p.label || '—'}
                </div>
                {/* Extra properties (skip internal keys) */}
                {Object.entries(p)
                  .filter(([k]) => !['name', 'label', '_geocoded'].includes(k))
                  .map(([k, v]) => (
                    <div key={k} style={{ color: '#94a3b8', marginBottom: '2px' }}>
                      <span style={{ color: '#64748b', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.04em' }}>{k}</span>
                      {' '}{String(v)}
                    </div>
                  ))
                }
                {/* Coordinates */}
                {coordLine && (
                  <div style={{ marginTop: '6px', color: '#38bdf8', fontSize: '12px', fontFamily: 'monospace' }}>
                    🌐 {coordLine}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Polygon / concession tooltip */}
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px', color: '#e2e8f0' }}>
                  {p.name || p.CONCESION || p.label || '—'}
                </div>
                {(p.LEYENDA || p.D_ESTADO) && (
                  <div style={{ color: '#7dd3fc', fontWeight: 600, marginBottom: '4px' }}>
                    {p.LEYENDA || p.D_ESTADO}
                  </div>
                )}
                {p.TIT_CONCES && (
                  <div style={{ color: '#cbd5e1', marginBottom: '3px' }}>
                    👤 {p.TIT_CONCES}
                  </div>
                )}
                {p.HASDATUM && (
                  <div style={{ color: '#94a3b8', marginBottom: '3px' }}>
                    📐 {parseFloat(p.HASDATUM).toFixed(1)} ha
                    {p.DEPA ? ` · ${p.DEPA}` : ''}
                  </div>
                )}
                {/* Cursor coordinates */}
                {coordLine && (
                  <div style={{ marginTop: '6px', color: '#38bdf8', fontSize: '12px', fontFamily: 'monospace' }}>
                    🌐 {coordLine}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      <MapControls>
        <ZoomControls viewport={viewport} onClick={handleZoom} />
        <ShareControls />
        <BasemapControls
          basemap={basemap}
          labels={labels}
          boundaries={boundaries}
          onChangeBasemap={handleBasemap}
          onChangeLabels={handleLabels}
          onChangeBoundaries={handleBoundaries}
        />
        <SearchControls onSelectLocation={handleSearch} />
        <ResetViewControls className={resetViewBtnClass} onResetView={handleResetView} />
      </MapControls>

      <div className="c-legend-map">
        <Legend maxHeight={embed ? 100 : 300} onChangeOrder={onChangeOrder}>
          {layerGroups.map((lg, i) => (
            <LegendListItem
              index={i}
              key={lg.dataset}
              layerGroup={lg}
              toolbar={
                embed ? (
                  <LegendItemToolbar>
                    <LegendItemButtonLayers />
                    <LegendItemButtonOpacity />
                    <LegendItemButtonVisibility />
                    <LegendItemButtonInfo />
                  </LegendItemToolbar>
                ) : (
                  <LegendItemToolbar />
                )
              }
              onChangeInfo={onChangeInfo}
              onChangeOpacity={onChangeOpacity}
              onChangeVisibility={onChangeVisibility}
              onChangeLayer={onChangeLayer}
              onRemoveLayer={onRemoveLayer}
            >
              <LegendItemTypes />
              <LegendItemTimeStep
                handleChange={onChangeLayerDate}
                customClass="rw-legend-timeline"
                defaultStyles={LEGEND_TIMELINE_PROPERTIES}
                dots={false}
                {...(lg.layers.length > TIMELINE_THRESHOLD && { dotStyle: { opacity: 0 } })}
              />
              {/* Temporary: only show old timeline approach if there's no occurrence of
                new timelineParams config
              */}
              {!lg.layers.find((l) => !!l.timelineParams) && (
                <LegendItemTimeline
                  onChangeLayer={onChangeLayerTimeLine}
                  customClass="rw-legend-timeline"
                  {...LEGEND_TIMELINE_PROPERTIES}
                  {...(lg.layers.length > TIMELINE_THRESHOLD && { dotStyle: { opacity: 0 } })}
                />
              )}
            </LegendListItem>
          ))}
        </Legend>
      </div>
      {!!layer && embed && (
        <Modal isOpen={!!layer} className="-medium" onRequestClose={() => onChangeInfo(null)}>
          <LayerInfoModal layer={layer} />
        </Modal>
      )}
    </div>
  );
};

ExploreMap.defaultProps = {
  token: null,
  userId: null,
  embed: false,
  layerGroupsInteractionSelected: null,
  layerGroupsInteractionLatLng: null,
  exploreBehavior: true,
  aoi: null,
  previewAoi: null,
  onLayerInfoButtonClick: null,
};

ExploreMap.propTypes = {
  token: PropTypes.string,
  userId: PropTypes.string,
  embed: PropTypes.bool,
  open: PropTypes.bool.isRequired,
  viewport: PropTypes.shape({
    pitch: PropTypes.number,
    bearing: PropTypes.number,
  }).isRequired,
  bounds: PropTypes.shape({}).isRequired,
  basemap: PropTypes.shape({
    value: PropTypes.string.isRequired,
  }).isRequired,
  labels: PropTypes.shape({
    value: PropTypes.string.isRequired,
  }).isRequired,
  boundaries: PropTypes.bool.isRequired,
  activeLayers: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
  layerGroups: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
  layerGroupsInteraction: PropTypes.shape({}).isRequired,
  layerGroupsInteractionSelected: PropTypes.string,
  layerGroupsInteractionLatLng: PropTypes.shape({
    latitude: PropTypes.number,
    longitude: PropTypes.number,
  }),
  activeInteractiveLayers: PropTypes.arrayOf(PropTypes.string).isRequired,
  setViewport: PropTypes.func.isRequired,
  setBounds: PropTypes.func.isRequired,
  setBasemap: PropTypes.func.isRequired,
  setLabels: PropTypes.func.isRequired,
  setBoundaries: PropTypes.func.isRequired,
  toggleMapLayerGroup: PropTypes.func.isRequired,
  setMapLayerGroupVisibility: PropTypes.func.isRequired,
  setMapLayerGroupOpacity: PropTypes.func.isRequired,
  setMapLayerGroupActive: PropTypes.func.isRequired,
  setMapLayerGroupsOrder: PropTypes.func.isRequired,
  setMapLayerParametrization: PropTypes.func.isRequired,
  removeLayerParametrization: PropTypes.func.isRequired,
  resetLayerParametrization: PropTypes.func.isRequired,
  setMapLayerGroupsInteraction: PropTypes.func.isRequired,
  setMapLayerGroupsInteractionLatLng: PropTypes.func.isRequired,
  setMapLayerGroupsInteractionSelected: PropTypes.func.isRequired,
  resetMapLayerGroupsInteraction: PropTypes.func.isRequired,
  setSelectedDataset: PropTypes.func.isRequired,
  setSidebarAnchor: PropTypes.func.isRequired,
  exploreBehavior: PropTypes.bool,
  onLayerInfoButtonClick: PropTypes.func,
  aoi: PropTypes.string,
  previewAoi: PropTypes.string,
  drawer: PropTypes.shape({
    isDrawing: PropTypes.bool.isRequired,
  }).isRequired,
  setDataDrawing: PropTypes.func.isRequired,
  stopDrawing: PropTypes.func.isRequired,
};

export default ExploreMap;
