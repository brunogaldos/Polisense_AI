import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import Geosuggest from 'react-geosuggest';

// components
import Icon from 'components/ui/icon';

// react-geosuggest instantiates `new window.google.maps.places.AutocompleteService()`
// on mount, so we must not render it before the Google Maps Places script has
// finished loading. _app.tsx fires `google-maps-ready` / `google-maps-error`
// events and sets window flags — this hook surfaces that state.
const useGoogleMapsReady = () => {
  const [status, setStatus] = useState(() => {
    if (typeof window === 'undefined') return 'loading';
    if (window.__googleMapsError) return 'error';
    if (window.google?.maps?.places || window.__googleMapsReady) return 'ready';
    return 'loading';
  });

  useEffect(() => {
    if (status !== 'loading') return undefined;

    const onReady = () => setStatus('ready');
    const onError = () => setStatus('error');
    window.addEventListener('google-maps-ready', onReady);
    window.addEventListener('google-maps-error', onError);

    // Fallback poll — handles the race where the script loaded before our
    // listener attached (no event was fired then).
    const pollId = window.setInterval(() => {
      if (window.google?.maps?.places) {
        setStatus('ready');
        window.clearInterval(pollId);
      } else if (window.__googleMapsError) {
        setStatus('error');
        window.clearInterval(pollId);
      }
    }, 200);

    // Give up after ~12s — long enough for slow networks, short enough that
    // the user gets a real error instead of an infinite spinner.
    const timeoutId = window.setTimeout(() => {
      if (!window.google?.maps?.places) setStatus('error');
    }, 12000);

    return () => {
      window.removeEventListener('google-maps-ready', onReady);
      window.removeEventListener('google-maps-error', onError);
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
    };
  }, [status]);

  return status;
};

const SearchControls = ({ onSelectLocation }) => {
  const [showSearchInput, setShowSearchInput] = useState(false);
  const geosuggestRef = useRef(null);
  const status = useGoogleMapsReady();

  const onSuggestSelect = useCallback(
    (e) => {
      if (!e) return;
      const { gmaps, location } = e;
      const viewport = gmaps?.geometry?.viewport;

      if (viewport) {
        const { south, west, north, east } = viewport.toJSON();
        onSelectLocation({ bbox: [east, south, west, north] });
      } else if (location) {
        onSelectLocation({ ...location, zoom: 7 });
      }

      setShowSearchInput(false);
    },
    [onSelectLocation],
  );

  const onKeyDown = useCallback((e) => {
    if (e.keyCode === 27) setShowSearchInput(false);
  }, []);

  const handleSearchClick = useCallback(() => {
    setShowSearchInput((prev) => !prev);
  }, []);

  // Focus the input once it mounts (next tick — the ref is set during render)
  useEffect(() => {
    if (showSearchInput && status === 'ready' && geosuggestRef.current) {
      geosuggestRef.current.focus();
    }
  }, [showSearchInput, status]);

  return (
    <div className="c-search-control">
      {showSearchInput && status === 'ready' && (
        <Geosuggest
          ref={geosuggestRef}
          onSuggestSelect={onSuggestSelect}
          onKeyDown={onKeyDown}
        />
      )}
      {showSearchInput && status === 'loading' && (
        <div className="search-control--status">Loading search…</div>
      )}
      {showSearchInput && status === 'error' && (
        <div
          className="search-control--status search-control--status-error"
          title="Open browser console for details"
        >
          Search unavailable — check API key
        </div>
      )}
      <button
        type="button"
        className="search-control--btn"
        onClick={handleSearchClick}
        title={
          status === 'error'
            ? 'Search unavailable — Google Places API failed to load'
            : 'Search location'
        }
      >
        <Icon name="icon-search" className="-small" />
      </button>
    </div>
  );
};

SearchControls.propTypes = {
  onSelectLocation: PropTypes.func.isRequired,
};

export default SearchControls;
