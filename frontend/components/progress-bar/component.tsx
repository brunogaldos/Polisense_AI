import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

const ProgressBar = () => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const showProgressBar = () => {
      setIsLoading(true);
    };

    const hideProgressBar = () => {
      setIsLoading(false);
    };

    router.events.on('routeChangeStart', showProgressBar);
    router.events.on('routeChangeComplete', hideProgressBar);
    router.events.on('routeChangeError', hideProgressBar);

    return () => {
      router.events.off('routeChangeStart', showProgressBar);
      router.events.off('routeChangeComplete', hideProgressBar);
      router.events.off('routeChangeError', hideProgressBar);
    };
  }, [router]);

  if (!isLoading) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '3px',
        backgroundColor: '#f0f0f0',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#007cba',
          animation: 'progress-animation 1s ease-in-out infinite',
        }}
      />
      <style jsx>{`
        @keyframes progress-animation {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
};

export default ProgressBar;
