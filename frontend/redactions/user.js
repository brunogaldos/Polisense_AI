import {
  HYDRATE,
} from 'next-redux-wrapper';

/**
 * CONSTANTS
*/
const SET_USER = 'user/setUser';
/**
 * REDUCER
*/
const initialState = {
};

export default function User(state = initialState, action) {
  switch (action.type) {
    case HYDRATE: {
      return ({
        ...state,
        ...action.payload.user,
      });
    }
    case SET_USER: {
      return { ...state, ...action.payload };
    }

    default:
      return state;
  }
}

/**
 * ACTIONS
 * - setUser
*/
export function setUser(user) {
  return (dispatch) => {
    if (!user) return;

    const userObj = { ...user };

    if (userObj.token) {
      userObj.token = userObj.token.includes('Bearer') ? userObj.token : `Bearer ${userObj.token}`;
    }

    dispatch({ type: SET_USER, payload: userObj });
  };
}
