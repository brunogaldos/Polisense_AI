import React, { useState, useCallback, useEffect } from 'react';

// component
import GDPRBanner from './component';

// utils
import { getGDPRAccepted, setGDPRAccepted } from './helpers';

const GDPRBannerContainer = (): JSX.Element => {
  const [gdprAcceptance, setGDPRAcceptance] = useState(false);
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
    setGDPRAcceptance(getGDPRAccepted());
  }, []);

  const memoizedCallback = useCallback(() => {
    setGDPRAccepted();
  }, []);

  const handleGDPR = () => {
    setGDPRAcceptance(true);
    memoizedCallback();
  };

  // Only render on client side to prevent hydration mismatch
  if (!isClient) {
    return null;
  }

  return !gdprAcceptance ? <GDPRBanner handleGDPR={handleGDPR} /> : null;
};

export default GDPRBannerContainer;
