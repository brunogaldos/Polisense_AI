import { createElement } from 'react';
import classnames from 'classnames';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import Link from 'next/link';

// contexts
import { useAuth } from 'contexts/AuthContext';

// components
import { APP_HEADER_ITEMS } from 'layout/header/constants';

const header = {
  dashboard: import('../header-dashboards'),
  documents: import('../header-documents'),
  data: import('../header-data'),
  menu: import('../header-menu'),
  'menu-mobile': import('../header-menu-mobile'),
  search: import('../header-search'),
  user: import('../header-user'),
};

const HeaderMenu = () => {
  const { pathname } = useRouter();
  const { currentUser } = useAuth();

  return (
    <nav className="header-menu">
      <ul>
        {APP_HEADER_ITEMS.map((item) => {
          const isUserLogged = !!currentUser;

          // if user is defined but it is not equal to the current token
          if (typeof item.user !== 'undefined' && item.user !== isUserLogged) return null;

          let DropdownMenu;
          // Only create a dynamic dropdown if a component is registered for this id
          if (header[item.id]) {
            DropdownMenu = dynamic(() => header[item.id]);
          }

          // Determine active state
          const isActive = pathname.startsWith(item.root);

          return (
            <li
              key={item.label}
              className={classnames({
                '-active': isActive,
              })}
            >
              {!DropdownMenu && item.href && !item.external && (
                <Link href={item.href}>
                  <a>{item.label}</a>
                </Link>
              )}

              {!DropdownMenu && item.external && <a href={item.href}>{item.label}</a>}

              {DropdownMenu && createElement(DropdownMenu, item)}
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default HeaderMenu;
