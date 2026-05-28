import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Tether from 'react-tether';
import { useDebouncedCallback } from 'use-debounce';

// contexts
import { useAuth } from 'contexts/AuthContext';

// hooks
import { useMe } from 'hooks/user';

// components
import Icon from 'components/ui/icon';

const HeaderUser = () => {
  const [isVisible, setVisibility] = useState(false);
  const { data: user, isLoading } = useMe();
  const { logout, currentUser } = useAuth();
  const { asPath } = useRouter();

  const handleLogout = async (e) => {
    if (e) e.preventDefault();
    await logout();
  };

  const toggleDropdown = useDebouncedCallback((_isVisible) => {
    setVisibility(_isVisible);
  }, 50);

  const { photo, role, email, name } = user || {};

  // Show login link if not logged in (and not loading)
  if (!isLoading && !user && !currentUser) {
    return (
      <Link href={`/sign-in?callbackUrl=${asPath}`}>
        <a className="header-menu-link">
          <Icon name="icon-user" className="-medium user-icon" />
        </a>
      </Link>
    );
  }

  // Show user avatar if logged in
  if (user || currentUser) {
    const userAvatar = photo ? `url(${photo})` : 'none';
    const displayEmail = email || currentUser?.email || '';
    const displayName = name || currentUser?.displayName || displayEmail;
    const avatarLetter = displayEmail ? displayEmail.charAt(0).toUpperCase() : 'U';

    return (
      <div className="c-avatar" style={{ backgroundImage: userAvatar }}>
        <Tether
          attachment="top center"
          constraints={[
            {
              to: 'window',
            },
          ]}
          classes={{ element: 'c-header-dropdown' }}
          renderTarget={(ref) => (
            <span
              ref={ref}
              onMouseEnter={() => toggleDropdown(true)}
              onMouseLeave={() => toggleDropdown(false)}
              style={{ cursor: 'pointer' }}
            >
              {!photo && displayEmail && <span className="avatar-letter">{avatarLetter}</span>}
            </span>
          )}
          renderElement={(ref) => {
            if (!isVisible) return null;

            return (
              <div
                ref={ref}
                onMouseEnter={() => toggleDropdown(true)}
                onMouseLeave={() => toggleDropdown(false)}
              >
                <ul className="header-dropdown-list user-list">
                  {displayName && (
                    <li className="header-dropdown-list-item -header">
                      <span>{displayName}</span>
                    </li>
                  )}
                  <li className="header-dropdown-list-item">
                    <a onClick={handleLogout} href="#">
                      Logout
                    </a>
                  </li>
                </ul>
              </div>
            );
          }}
        />
      </div>
    );
  }

  // Show loading state (optional - can show login link instead)
  return (
    <Link href={`/sign-in?callbackUrl=${asPath}`}>
      <a className="header-menu-link">
        <Icon name="icon-user" className="-medium user-icon" />
      </a>
    </Link>
  );
};

export default HeaderUser;
