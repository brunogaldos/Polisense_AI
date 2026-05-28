// components
import Layout from 'layout/layout/layout-app';
import LoginModal from 'components/modal/login-modal';

export default function SignIn() {
  return (
    <Layout
      className="l-log-in"
      title="Polisense Sign-in/Register"
      description="Polisense Sign-in/Register"
      isFullScreen
    >
      <div className="l-container">
        <div className="content">
          <LoginModal />
        </div>
      </div>
    </Layout>
  );
}
