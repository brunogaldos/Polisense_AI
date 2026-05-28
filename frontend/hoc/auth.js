import { QueryClient } from 'react-query';
import { dehydrate } from 'react-query/hydration';

// hooks
import {
  useMe,
} from 'hooks/user';

// contexts
import { useAuth } from 'contexts/AuthContext';

// lib
import wrapper from 'lib/store';

const queryClient = new QueryClient();

// Note: Server-side authentication is now handled client-side via AuthContext
// This HOC is kept for backward compatibility but authentication checks happen client-side
export function withAuthentication(getServerSidePropsFunc) {
  return async (context) => {
    const { resolvedUrl } = context;

    // Client-side auth check will redirect if needed
    if (getServerSidePropsFunc) {
      const SSPF = await getServerSidePropsFunc(context, null);

      return {
        props: {
          dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
          ...SSPF.props,
        },
      };
    }

    return {
      props: {
        dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
      },
    };
  };
}

// hoc to attach the store to any getServerSideProps function.
// todo: this function should disappear when components stop fetching user data via store
export const withRedux = (getServerSidePropsFunc) => wrapper.getServerSideProps(
  (store) => async (context) => {
    if (getServerSidePropsFunc) {
      const SSPF = await getServerSidePropsFunc({ ...context, store });

      return ({
        ...SSPF,
      });
    }

    return ({
      props: ({}),
    });
  },
);

// hoc to attach to user data to store as soon as possible.
// Note: User data is now loaded client-side via AuthContext
// This HOC is kept for backward compatibility
export function withUserServerSide(getServerSidePropsFunc) {
  return async (contextWithStore) => {
    if (getServerSidePropsFunc) {
      const SSPF = await getServerSidePropsFunc(contextWithStore, contextWithStore.store);

      const {
        props: SSPFProps,
        ...SSPFRest
      } = SSPF;

      return {
        props: {
          ...SSPFProps,
          user: null,
          dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
        },
        ...SSPFRest,
      };
    }

    return {
      props: {
        user: null,
        dehydratedState: JSON.parse(JSON.stringify(dehydrate(queryClient))),
      },
    };
  };
}

// todo: this function should disappear when components stop fetching user data via store
export const withUser = (Component) => (props) => {
  const {
    data: user,
    isLoading: loading,
  } = useMe();
  const { currentUser, session, loading: authLoading } = useAuth();

  if (loading || authLoading) return null;

  if (Component.prototype.render) {
    return (
      <Component
        session={session}
        loading={loading || authLoading}
        user={user}
        token={currentUser ? `Bearer ${currentUser.uid}` : null}
        {...props}
      />
    );
  }

  // if the passed component is a function component, there is no need for this wrapper
  throw new Error([
    'You passed a function component, `withUser` is not needed.',
    'You can use `useAuth` or `useMe` directly in your component.',
  ].join('\n'));
};
