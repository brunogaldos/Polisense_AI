import { HYDRATE } from 'next-redux-wrapper';

const SET_LOCALE = 'common/SET_LOCALE';

const initialState = {
  locale: 'en',
};

export default function commonReducer(state = initialState, action) {
  switch (action.type) {
    case HYDRATE:
      return {
        ...state,
        ...action.payload.common,
      };
    case SET_LOCALE:
      return { ...state, locale: action.payload };
    default:
      return state;
  }
}

/**
 * ACTIONS
 */

/**
 * Set the locale of the app (used by the API)
 * NOTE: doesn't not change the language of the app, only
 * Transifex can do so
 * @param {string} locale Two-letter locale
 */
export function setLocale(locale) {
  return {
    type: SET_LOCALE,
    payload: locale,
  };
}
