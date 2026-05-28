import React from 'react';
import { createMedia } from '@artsy/fresnel';
//Responsive design utility using @artsy/fresnel for conditional rendering based on screen size
// medium: 780,
// large: 1024,
// xlarge: 1260,
// xxlarge: 1560,

const {
  MediaContextProvider: BaseMediaContextProvider,
  createMediaStyle,
  Media,
} = createMedia({
  breakpoints: {
    sm: 0,
    md: 780,
    lg: 1024,
    xl: 1260,
  },
});

// Make styles for injection into the header of the page
const mediaStyles = createMediaStyle();

// Wrapper component that includes children prop for TypeScript compatibility
// The base MediaContextProvider accepts children at runtime but TypeScript
// types don't include it, so we wrap it to add proper typing
const MediaContextProvider = ({ children, ...props }) => {
  return (
    <BaseMediaContextProvider {...props}>
      {children}
    </BaseMediaContextProvider>
  );
};

export {
  mediaStyles,
  Media,
};

export default MediaContextProvider;
