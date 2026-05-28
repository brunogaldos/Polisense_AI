import React from 'react';

// Make JSX namespace available globally for React 17
// This ensures JSX.Element is available throughout the codebase
declare global {
  namespace JSX {
    interface Element extends React.ReactElement<any, any> {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}

export {};
