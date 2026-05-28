import { createSelector } from 'reselect';
import { getYear, getMonth, getDayOfYear } from 'date-fns';

// utils
import { reduceParams, reduceSqlParams, getTimelineParams } from 'utils/layers/params-parser';
import { getInteractiveLayers } from 'components/map/utils';

// The next selectors are factories: provide them the needed data before using them.
// Otherwise, they won't work. You can check some examples in:
// - layout/explore/explore-map/selectors

export const getUpdatedLayerGroups = (statePointer) =>
  createSelector([statePointer], (_layerGroups) =>
    _layerGroups.map((_layerGroup) => ({
      ..._layerGroup,
      layers: _layerGroup.layers.map((_layer) => {

        
        const timelineParams = getTimelineParams({
          ..._layer.layerConfig.timeline_config,
          ...(_layer.layerConfig.decode_config &&
            _layer.layerConfig.decode_config.reduce(
              (acc, curr) => ({
                ...acc,
                [curr.key]: curr.default,
              }),
              {},
            )),
        });

        return {
          ..._layer,
          ...(_layer.layerConfig.timeline_config && {
            // all params should go under timeline_config attribute
            timelineParams,
          }),
          ...(_layer.layerConfig.layerType && { layerType: _layer.layerConfig.layerType }),
        };
      }),
    })),
  );

export const getActiveLayers = (statePointer) =>
  createSelector([statePointer], (_layerGroups = []) => {
    const activeLayers = _layerGroups
      .filter((lg) => lg.layers.length > 0)
      .map((lg) => ({
        ...lg.layers.find((l) => l.active),
        opacity: typeof lg.opacity !== 'undefined' ? lg.opacity : 1,
        visibility: typeof lg.visibility !== 'undefined' ? lg.visibility : true,
      }));

    return activeLayers;
  });

export const getActiveInteractiveLayers = (statePointer) =>
  createSelector([statePointer], (_activeLayers) => getInteractiveLayers(_activeLayers));

export const getUpdatedLayers = (activeLayersPointer, parametrizationPointer) =>
  createSelector(
    [activeLayersPointer, parametrizationPointer],
    (_activeLayers = [], _parametrization) => {
      if (!Object.keys(_parametrization).length) {
        return _activeLayers.map((_activeLayer) => {
          // User Area of Interest (Currently being used in the GEDC Energy dashboard)
          if (_activeLayer.id === 'user_area') {
            return _activeLayer;
          }
          

          
          const reducedDecodeParams = reduceParams(_activeLayer.layerConfig.decode_config);
          const { startDate, endDate } = reducedDecodeParams || {};

          return {
            ..._activeLayer,
            ...(_activeLayer.layerConfig.layerType && {
              layerType: _activeLayer.layerConfig.layerType,
            }),
            ...(_activeLayer.layerConfig.params_config && {
              params: {
                ...reduceParams(_activeLayer.layerConfig.params_config),
                ...(!!_activeLayer.layerConfig.body.url && {
                  url: _activeLayer.layerConfig.body.url,
                }),
              },
            }),
            ...(_activeLayer.layerConfig.sql_config && {
              sqlParams: reduceSqlParams(_activeLayer.layerConfig.sql_config),
            }),
            ...(_activeLayer.layerConfig.decode_config && {
              decodeParams: {
                ...reducedDecodeParams,
                ...(startDate && {
                  startYear: getYear(new Date(startDate)),
                  startMonth: getMonth(new Date(startDate)),
                  startDay: getDayOfYear(new Date(startDate)),
                }),
                ...(endDate && {
                  endYear: getYear(new Date(endDate)),
                  endMonth: getMonth(new Date(endDate)),
                  endDay: getDayOfYear(new Date(endDate)),
                }),
              },
            }),
          };
        });
      }

      Object.keys(_parametrization).forEach((layerId) => {
        const indexLayer = _activeLayers.findIndex((_layer) => _layer.id === layerId);

        if (indexLayer === -1) return;
        let currentLayer = _activeLayers[indexLayer];

        // Handle case where layerConfig is nested in attributes
        let layerConfig = currentLayer.layerConfig;
        if (!layerConfig && currentLayer.attributes?.layerConfig) {
          layerConfig = currentLayer.attributes.layerConfig;
        }
        
        const { layerConfig: currentLayerConfig } = { layerConfig };
        
        // Check if layerConfig exists before destructuring
        if (!currentLayerConfig) {
          console.warn(`Layer ${currentLayer.id} has no layerConfig, skipping parametrization...`);
          return;
        }
        
        const {
          params_config: paramsConfig,
          decode_config: decodeConfig,
          sql_config: sqlConfig,
          timeline_config: timelineConfig,
        } = currentLayerConfig;
        const {
          params: newParams,
          decodeParams: newDecodeParams,
          sqlParams: newSQLParams,
          timeline_config: newTimelineConfig,
        } = _parametrization[layerId];
        const { startDate, endDate } = newDecodeParams || {};

        currentLayer = {
          ...currentLayer,
          ...(paramsConfig && {
                          params: {
                ...reduceParams(paramsConfig),
                ...(!!currentLayer.layerConfig?.body?.url && {
                  url: currentLayer.layerConfig?.body?.url,
                }),
                ...newParams,
              },
          }),
          ...(sqlConfig && {
            sqlParams: {
              ...reduceSqlParams(sqlConfig),
              ...newSQLParams,
            },
          }),
          ...(decodeConfig && {
            decodeParams: {
              ...reduceParams(decodeConfig),
              ...newDecodeParams,
              ...(startDate && {
                startYear: getYear(new Date(startDate)),
                startMonth: getMonth(new Date(startDate)),
                startDay: getDayOfYear(new Date(startDate)),
              }),
              ...(endDate && {
                endYear: getYear(new Date(endDate)),
                endMonth: getMonth(new Date(endDate)),
                endDay: getDayOfYear(new Date(endDate)),
              }),
            },
          }),
          ...(timelineConfig && { timelineParams: { ...newTimelineConfig } }),
        };

        _activeLayers[indexLayer] = currentLayer;
      });

      return [..._activeLayers];
    },
  );

export default {
  getUpdatedLayerGroups,
  getActiveLayers,
  getUpdatedLayers,
  getActiveInteractiveLayers,
};
