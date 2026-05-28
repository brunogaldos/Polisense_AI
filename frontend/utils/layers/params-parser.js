import { formatDate } from 'utils/dates';
import { deburrUpper } from 'utils/data';
import { format, subDays, subMonths, subYears } from 'date-fns';

// constants
import { LEGEND_TIMELINE_PROPERTIES } from 'layout/explore/explore-map/constants';

export const reduceParams = (params) => {
  if (!params) return null;
  if (!Array.isArray(params)) {
    console.warn('reduceParams received non-array params:', params);
    return {};
  }
  return params.reduce((obj, param) => {
    const {
      format: dateFormat, key, interval, count,
    } = param;
    let paramValue = param.default;
    const isDate = deburrUpper(param.key).includes('DATE');
    if (isDate && !paramValue) {
      let date = new Date(formatDate(new Date()));
      if (interval && count) {
        if (interval === 'days') date = subDays(date, count);
        else if (interval === 'months') date = subMonths(date, count);
        else if (interval === 'years') date = subYears(date, count);
      }
      // Convert date-fns format tokens to moment-like format
      const formatStr = (dateFormat || 'YYYY-MM-DD')
        .replace(/YYYY/g, 'yyyy')
        .replace(/DD/g, 'dd')
        .replace(/MM/g, 'MM');
      paramValue = format(date, formatStr);
    }

    const newObj = {
      ...obj,
      [key]: paramValue,
      ...(key === 'endDate'
        && param.url && { latestUrl: param.url }),
    };
    return newObj;
  }, {});
};

export const reduceSqlParams = (params) => {
  if (!params) return null;
  if (!Array.isArray(params)) {
    console.warn('reduceSqlParams received non-array params:', params);
    return {};
  }
  return params.reduce((obj, param) => {
    const newObj = {
      ...obj,
      ...param.key_params && {
        [param.key]: param.key_params.reduce((subObj, item) => {
          const keyValues = {
            ...subObj,
            [item.key]: item.value,
          };
          return keyValues;
        }, {}),
      },
    };
    return newObj;
  }, {});
};

export const getTimelineMarks = (timelineParams = {}) => {
  const initialYear = new Date(timelineParams.startDate).getFullYear();
  const lastYear = new Date(timelineParams.endDate).getFullYear();
  const _marks = [initialYear, lastYear].reduce((accumulator, currentValue) => ({
    ...accumulator,
    [currentValue]: {
      label: currentValue,
      style: LEGEND_TIMELINE_PROPERTIES.markStyle,
    },
  }), {});

  return _marks;
};

export const getTimelineParams = (timelineParams = {}) => ({
  ...timelineParams,
  // this shouldn't be here, this is temporary
  canPlay: true,
  minDate: timelineParams.startDate,
  maxDate: timelineParams.endDate,
  trimEndDate: timelineParams.endDate,
  marks: getTimelineMarks(timelineParams),
});

export default {
  reduceParams,
  reduceSqlParams,
  getTimelineParams,
  getTimelineMarks,
};
