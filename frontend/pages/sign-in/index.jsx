// components
import SignIn from 'layout/sign-in';

export default function SignInPage() {
  return (<SignIn />);
}

// Note: Client-side auth check is now handled by AuthContext
// Server-side redirects are handled client-side after auth state loads
export async function getServerSideProps(context) {
  return {
    props: ({}),
  };
}
