import { PureComponent } from 'react';
import PropTypes from 'prop-types';
import { toastr } from 'react-redux-toastr';
import Link from 'next/link';
import { useRouter } from 'next/router';

// components
import Field from 'components/form/Field';
import Input from 'components/form/Input';
import Spinner from 'components/ui/Spinner';

// contexts
import { useAuth } from 'contexts/AuthContext';

// constants
import { FORM_ELEMENTS } from './constants';

class LoginModal extends PureComponent {
  constructor(props) {
    super(props);

    this.state = {
      email: '',
      password: '',
      displayName: '',
      register: false,
      loading: false,
    };
  }

  onSubmit = async (e) => {
    if (e) e.preventDefault();
    FORM_ELEMENTS.validate();
    const isValid = FORM_ELEMENTS.isValid();
    const {
      callbackUrl,
    } = this.props;
    const { register, email, password, displayName } = this.state;

    if (!isValid) return;

    this.setState({ loading: true });

    try {
      const { login, signup } = this.props.authContext;

      if (register) {
        await signup(email, password, displayName);
        toastr.success('Registration successful', 'You can now log in with your credentials.');
        this.setState({
          loading: false,
          register: false,
          email: '',
          password: '',
          displayName: '',
        });
      } else {
        await login(email, password);
        // Redirect after successful login
        // Validate callbackUrl to prevent redirecting to malformed URLs
        if (callbackUrl && 
            callbackUrl !== '/data/explore/[[...dataset]]' &&
            !callbackUrl.includes('[[...dataset]]')) {
          window.location.href = callbackUrl;
        } else {
          // Default redirect to explore page if callbackUrl is invalid
          window.location.href = '/data/explore';
        }
      }
    } catch (err) {
      // Handle login-specific errors with user-friendly messages
      let message = 'Something went wrong';
      
      if (err.code === 'auth/wrong-password' || 
          err.code === 'auth/user-not-found' || 
          err.code === 'auth/invalid-credential' ||
          err.code === 'auth/invalid-email') {
        message = 'Email or password is incorrect. Please try again.';
      } else if (err.code === 'auth/user-disabled') {
        message = 'This account has been disabled. Please contact support.';
      } else if (err.code === 'auth/too-many-requests') {
        message = 'Too many failed login attempts. Please try again later.';
      } else if (err.message) {
        message = err.message;
      }

      toastr.error(message);
      this.setState({ loading: false });
    }
  }

  render() {
    const {
      email,
      password,
      displayName,
      register,
      loading,
    } = this.state;

    return (
      <div className="c-login-modal">
        <div className="content">
          <div className="log-in-container">
            {loading && <Spinner className="-light" isLoading />}
            <div className="row">
              <div className="column small-12">
                <h2 className="c-title">{register ? 'Sign up' : 'Sign in'}</h2>
              </div>
              <div className="column small-12 medium-5">
                <span>Access with your email</span>
                <form onSubmit={this.onSubmit}>
                  {register && (
                    <Field
                      ref={(c) => { if (c) FORM_ELEMENTS.elements.displayName = c; }}
                      onChange={(value) => this.setState({ displayName: value })}
                      className="-fluid"
                      validations={['required']}
                      properties={{
                        name: 'displayName',
                        label: 'Display Name',
                        required: true,
                        default: displayName,
                        placeholder: 'Your name',
                        'data-cy': 'display-name-input',
                      }}
                    >
                      {Input}
                    </Field>
                  )}
                  <Field
                    ref={(c) => { if (c) FORM_ELEMENTS.elements.email = c; }}
                    onChange={(value) => this.setState({ email: value })}
                    className="-fluid"
                    validations={['required', 'email']}
                    properties={{
                      name: 'email',
                      label: 'Email',
                      required: true,
                      default: email,
                      placeholder: 'your@email.com',
                      'data-cy': 'email-input',
                    }}
                  >
                    {Input}
                  </Field>
                  <Field
                    ref={(c) => { if (c) FORM_ELEMENTS.elements.password = c; }}
                    onChange={(value) => this.setState({ password: value })}
                    className="-fluid"
                    validations={['required']}
                    properties={{
                      name: 'password',
                      label: 'Password',
                      required: true,
                      default: password,
                      type: 'password',
                      placeholder: '*********',
                      autoComplete: register ? 'new-password' : 'current-password',
                      'data-cy': 'password-input',
                    }}
                  >
                    {Input}
                  </Field>
                  {!register && (
                    <Link href="/forgot-password">
                      <a className="c-btn -clean forgot-password-link">
                        Have you forgotten your password?
                      </a>
                    </Link>
                  )}
                  <div className="c-button-container form-buttons">
                    <ul>
                      <li>
                        <button
                          type="submit"
                          className="c-button -primary"
                          data-cy="submit-button"
                          disabled={loading}
                        >
                          {register ? 'Register' : 'Log in'}
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          data-cy="register-button"
                          className="c-button -tertirary"
                          onClick={() => { 
                          this.setState({ register: !register }); 
                        }}
                        >
                          {!register ? 'Register' : 'I have an account'}
                        </button>
                      </li>
                    </ul>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

LoginModal.defaultProps = {
  callbackUrl: null,
  authContext: null,
};

LoginModal.propTypes = {
  callbackUrl: PropTypes.string,
  authContext: PropTypes.object,
};

// Wrapper component to inject AuthContext
const LoginModalWrapper = (props) => {
  const authContext = useAuth();
  const router = useRouter();
  const callbackUrl = props.callbackUrl || router.query.callbackUrl || null;

  return <LoginModal {...props} callbackUrl={callbackUrl} authContext={authContext} />;
};

export default LoginModalWrapper;
