import { connect } from 'react-redux';

// actions
import { setMobileOpened } from '../actions';

// component
import HeaderMenuMobile from './component';

export default connect(
  (state) => ({
    header: state.header,
    // user prop removed - now using Firebase Auth via useAuth hook in component
  }),
  { setMobileOpened },
)(HeaderMenuMobile);
