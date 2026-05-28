import { createReducer } from '@reduxjs/toolkit';
import {
  setSearchList,
  setSearchSelected,
  setSearchTerm,
  setSearchPage,
  setSearchTotal,
  setSearchLoading,
  setSearchError,
} from './actions';

const initialState = {
  list: [],
  selected: null,
  term: '',
  page: 1,
  limit: 10,
  total: 0,
  loading: false,
  error: null,
};

export default createReducer(initialState, (builder) => {
  builder
    .addCase(setSearchList, (state, { payload }) => ({
      ...state,
      list: payload,
    }))
    .addCase(setSearchSelected, (state, { payload }) => ({
      ...state,
      selected: payload,
    }))
    .addCase(setSearchTerm, (state, { payload }) => ({
      ...state,
      term: payload,
    }))
    .addCase(setSearchPage, (state, { payload }) => ({
      ...state,
      page: payload,
    }))
    .addCase(setSearchTotal, (state, { payload }) => ({
      ...state,
      total: payload,
    }))
    .addCase(setSearchLoading, (state, { payload }) => ({
      ...state,
      loading: payload,
    }))
    .addCase(setSearchError, (state, { payload }) => ({
      ...state,
      error: payload,
    }));
});
