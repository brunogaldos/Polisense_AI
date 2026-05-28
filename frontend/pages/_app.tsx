import { FC, useEffect } from 'react';
import type { AppProps } from 'next/app';
import Script from 'next/script';

import { QueryClient, QueryClientProvider } from 'react-query';
import { Hydrate } from 'react-query/hydration';

// lib
import wrapper from 'lib/store';
import MediaContextProvider from 'lib/media';

// contexts
import { DashboardProvider } from 'contexts/DashboardContext';
import { AuthProvider } from 'contexts/AuthContext';

// global styles
import 'css/index.scss';

const queryClient = new QueryClient();

const ResourceWatchApp: FC<AppProps> = ({ Component, pageProps }: AppProps) => {
  // Global error handler to suppress external API errors
  useEffect(() => {
    const hasMapboxToken = !!process.env.NEXT_PUBLIC_RW_MAPBOX_API_TOKEN;
    const hasGoogleToken = !!process.env.NEXT_PUBLIC_RW_GOGGLE_API_TOKEN_SHORTENER;

    // Development-only warning about missing API tokens
    if (process.env.NODE_ENV === 'development') {
      if (!hasMapboxToken) {
        console.warn('⚠️  NEXT_PUBLIC_RW_MAPBOX_API_TOKEN is not set. Map functionality will be limited.');
      }
      if (!hasGoogleToken) {
        console.warn('⚠️  NEXT_PUBLIC_RW_GOGGLE_API_TOKEN_SHORTENER is not set. Google Maps functionality will be limited.');
      }
    }

    if (!hasMapboxToken || !hasGoogleToken) {
      const originalError = console.error;
      const originalWarn = console.warn;

      console.error = (...args) => {
        const message = args[0]?.toString() || '';
        // Suppress Mapbox and Google Maps related errors when tokens are missing
        if (
          (!hasMapboxToken && (message.includes('mapbox') || message.includes('Mapbox'))) ||
          (!hasGoogleToken && (message.includes('googleapis') || message.includes('maps.googleapis')))
        ) {
          return;
        }
        originalError.apply(console, args);
      };

      console.warn = (...args) => {
        const message = args[0]?.toString() || '';
        // Suppress CORS warnings for external APIs when tokens are missing
        if (
          (!hasMapboxToken && (message.includes('mapbox') || message.includes('Mapbox'))) ||
          (!hasGoogleToken && (message.includes('googleapis') || message.includes('maps.googleapis')))
        ) {
          return;
        }
        originalWarn.apply(console, args);
      };

      return () => {
        console.error = originalError;
        console.warn = originalWarn;
      };
    }
  }, []);

  return (
    <>
      {process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_CONTAINER_ID && (
        <noscript>
          {/* Google Tag Manager (noscript) */}
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_CONTAINER_ID}`}
            height={0}
            width={0}
            style={{
              display: 'none',
              visibility: 'hidden',
            }}
          />
          {/* End Google Tag Manager (noscript) */}
        </noscript>
      )}

      {/* Google places API */}
      {process.env.NEXT_PUBLIC_RW_GOGGLE_API_TOKEN_SHORTENER && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?v=weekly&key=${process.env.NEXT_PUBLIC_RW_GOGGLE_API_TOKEN_SHORTENER}&libraries=places`}
          strategy="afterInteractive"
          onLoad={() => {
            // Mark ready so the search control can stop polling and render
            // its autocomplete. Use a custom event in addition to the flag
            // so already-mounted components can react without polling forever.
            (window as any).__googleMapsReady = true;
            window.dispatchEvent(new Event('google-maps-ready'));
          }}
          onError={() => {
            console.warn('Google Maps API failed to load — check that the key is valid and Places API is enabled in Google Cloud Console.');
            (window as any).__googleMapsError = true;
            window.dispatchEvent(new Event('google-maps-error'));
          }}
        />
      )}


      <QueryClientProvider client={queryClient}>
        <MediaContextProvider>
          <Hydrate state={pageProps.dehydratedState}>
            <AuthProvider>
              <DashboardProvider>
                <Component {...pageProps} />
              </DashboardProvider>
            </AuthProvider>
          </Hydrate>
        </MediaContextProvider>
      </QueryClientProvider>
    </>
  );
};

export default wrapper.withRedux(ResourceWatchApp);
