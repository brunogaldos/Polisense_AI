import {
  useEffect,
} from 'react';
import PropTypes from 'prop-types';
import { useRouter } from 'next/router';

// components
import Layout from 'layout/layout/layout-app';
import Spinner from 'components/ui/Spinner';

// contexts
import { useAuth } from 'contexts/AuthContext';

export default function AuthCallback({
  callbackUrl,
}) {
  const router = useRouter();
  const { currentUser, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    
    // Validate callbackUrl to prevent redirecting to malformed URLs
    const validCallbackUrl = callbackUrl && 
      callbackUrl !== '/data/explore/[[...dataset]]' &&
      !callbackUrl.includes('[[...dataset]]') &&
      !callbackUrl.includes('myrw') &&
      !callbackUrl.includes('myrw-detail')
      ? callbackUrl 
      : '/data/explore';
    
    if (currentUser) {
      // User is authenticated, redirect
      router.push(validCallbackUrl);
    } else {
      // No user, redirect to sign in
      router.push(`/sign-in?callbackUrl=${encodeURIComponent(validCallbackUrl)}`);
    }
  }, [currentUser, loading, callbackUrl, router]);

  return (
    <Layout
      title="Polisense"
      description="Trusted and timely data for a sustainable future."
      className="l-home"
    >
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 500,
        position: 'relative',
      }}
      >
        <Spinner
          className="-transparent"
          isLoading
        />
        <span
          style={{
            display: 'inline-block',
            marginTop: 150,
            color: '#4effd0',
            fontSize: 26,
            fontWeight: 300,
          }}
        >
          Signin in. You will be redirected automatically.
        </span>
      </div>
    </Layout>
  );
}

AuthCallback.defaultProps = {
  callbackUrl: null,
};

AuthCallback.propTypes = {
  callbackUrl: PropTypes.string,
};

export async function getServerSideProps(context) {
  const {
    query: {
      callbackUrl,
    },
  } = context;

  return {
    props: ({
      callbackUrl: callbackUrl || '/data/explore',
    }),
  };
}
