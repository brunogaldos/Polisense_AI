import type { GetServerSideProps } from 'next';

export default function HomePage() {
  // This page redirects to /data/explore
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/data/explore',
      permanent: true,
    },
  };
};
