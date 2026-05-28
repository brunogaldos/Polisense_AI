import Link from 'next/link';

import { GDPRBannerProps } from './types';

const GDPRBanner = ({ handleGDPR }: GDPRBannerProps): JSX.Element => (
  <div className="absolute top-0 left-0 z-50 flex items-center w-full py-2 text-white bg-gray-darkest">
    <div className="l-container">
      <div className="row">
        <div className="column small-9 medium-10">
          This website uses cookies to provide you with an improved user experience. By continuing
          to browse this site, you consent to the use of cookies and similar technologies. Please
          visit our{' '}
          <Link href="/privacy-policy">
            <a target="_blank" rel="noopener noreferrer" className="text-white underline">
              privacy policy
            </a>
          </Link>{' '}
          for further details.
        </div>
        <div className="column small-3 medium-2">
          <div
            className="flex items-center justify-end h-full"
            style={{ transform: 'translate(60px, -45px)' }}
          >
            <button
              type="button"
              className="c-button -primary -alt -compressed -fs-medium"
              style={{ backgroundColor: '#44546a', border: '1px solid #4effd0', color: '#ffffff' }}
              onClick={handleGDPR}
            >
              I agree
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default GDPRBanner;
