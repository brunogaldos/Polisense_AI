import Document, { Html, Main, NextScript, Head } from 'next/document';

// lib
import { mediaStyles } from 'lib/media';

export default class MyDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <meta httpEquiv="x-ua-compatible" content="ie=edge" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="author" content="Vizzuality" />
          {/* Disable robots crawling for MVP */}
              <meta name="robots" content="noindex, nofollow" />
          <link rel="icon" href="/favicon.ico" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          {/* Inter is the primary UI font referenced by $body-font-family and inline
              `font-family: 'Inter', ...` declarations across components. Lato is kept
              as a secondary fallback for legacy pages. */}
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Lato:wght@300;400;700&display=swap"
            rel="stylesheet"
          />

          {/* Mobile address background */}
          {/* Chrome, Firefox OS and Opera */}
          <meta name="theme-color" content="#4effd0" />
          {/* Windows Phone */}
          <meta name="msapplication-navbutton-color" content="#4effd0" />
          {/* iOS Safari */}
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

          {/* Social metadata */}
          <meta property="og:type" content="website" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:site" content="@polisense" />
          <meta property="fb:app_id" content="Polisense" />

          <style type="text/css" dangerouslySetInnerHTML={{ __html: mediaStyles }} />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
