# Main Header Menu Configuration

## Overview
This document provides comprehensive information about the main header menu system in the Resource Watch application, including colors, styling, components, integration, and customization options.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [File Structure](#file-structure)
3. [Color Configuration](#color-configuration)
4. [Component Structure](#component-structure)
5. [Styling Details](#styling-details)
6. [Menu Items Configuration](#menu-items-configuration)
7. [Responsive Behavior](#responsive-behavior)
8. [Dropdown Menus](#dropdown-menus)
9. [Customization Guide](#customization-guide)
10. [Code Snippets](#code-snippets)

## Architecture Overview

The header menu system consists of multiple components working together:

- **Main Header Container**: `layout/header/component.jsx`
- **Desktop Menu**: `layout/header/header-menu/component.jsx`
- **Mobile Menu**: `layout/header/header-menu-mobile/component.jsx`
- **Dropdown Components**: Various dropdown components for each menu item
- **Styling**: `layout/header/_styles.scss` and related SCSS files
- **Configuration**: `layout/header/constants.js`

## File Structure

```
resource-watch/layout/header/
├── component.jsx                    # Main header container
├── _styles.scss                     # Main header styling
├── constants.js                     # Menu items configuration
├── header-menu/
│   └── component.jsx               # Desktop menu component
├── header-menu-mobile/
│   ├── component.jsx               # Mobile menu component
│   └── _styles.scss               # Mobile menu styling
├── header-data/
│   └── component.jsx               # Data dropdown component
├── header-dashboards/
│   └── component.jsx               # Dashboards dropdown component
├── header-about/
│   └── component.jsx               # About dropdown component
├── header-get-involved/
│   └── component.jsx               # Get Involved dropdown component
└── header-user/
    └── component.jsx               # User dropdown component
```

## Color Configuration

### Primary Colors
- **Background**: `#44546a` (Blue-gray)
- **Text Color**: `#FFFFFF` (Pure white)
- **Hover Color**: `#4effd0` (Bright turquoise)
- **Active State**: `#4effd0` (Bright turquoise)

### Color Variables (from `css/_settings.scss`)
```scss
$dark-pink: #4effd0;           // Primary accent color
$yellow: #4effd0;              // Hover/active color
$charcoal-grey: #393f44;       // Secondary text
$white: #ffffff;               // Primary text
$dove-grey: #717171;          // Muted text
```

### Header Background Configuration
```scss
.l-header {
  background-color: #44546a;     // Main background
  backdrop-filter: blur(10px);   // Glass effect
  background-image: none;        // No gradient overlay
  z-index: 10000;               // High z-index for overlay
}
```

## Component Structure

### Main Header Component
```jsx
// layout/header/component.jsx
export default function Header({
  className,
  header,
  pageHeader,
}) {
  const { admin } = header;
  
  return (
    <header className={headerClass}>
      <div className={containerClass}>
        <div className="row">
          <div className="column">
            <div className="header-main">
              <div className="header-logo">
                <Link href="/">
                  <a>
                    <h1 className="brand-title">POLISENSE AI</h1>
                  </a>
                </Link>
              </div>
              <Media at="sm">
                <HeaderMenuMobile />
              </Media>
              <Media greaterThanOrEqual="md">
                <HeaderMenu />
              </Media>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
```

### Desktop Menu Component
```jsx
// layout/header/header-menu/component.jsx
const HeaderMenu = () => {
  const { pathname } = useRouter();
  const [session] = useSession();

  return (
    <nav className="header-menu">
      <ul>
        {APP_HEADER_ITEMS.map((item) => {
          const isUserLogged = !!session?.accessToken;
          
          if (typeof item.user !== 'undefined' && item.user !== isUserLogged) return null;

          let DropdownMenu;
          if (header[item.id]) {
            DropdownMenu = dynamic(() => header[item.id]);
          }

          return (
            <li
              key={item.label}
              className={classnames({
                '-active': pathname.startsWith(item.root),
              })}
            >
              {!DropdownMenu && item.href && !item.external && (
                <Link href={item.href}>
                  <a>{item.label}</a>
                </Link>
              )}
              {DropdownMenu && createElement(DropdownMenu, item)}
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
```

## Styling Details

### Main Header Styling
```scss
// layout/header/_styles.scss
.l-header {
  background-color: #44546a;
  backdrop-filter: blur(10px);
  background-image: none;
  background-repeat: no-repeat;
  background-position: center;
  background-size: cover;
  z-index: 10000;

  &.-transparent {
    background-image: none;
    background-color: transparent;
  }

  .header-main {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: $header-main-height-mobile; // 50px mobile
    position: relative;

    @media screen and (min-width: map-get($breakpoints, medium)) {
      height: $header-main-height; // 55px desktop
    }
  }
}
```

### Logo Styling
```scss
.header-logo {
  position: relative;
  margin-left: -630px; // Positioned to the left

  .brand-title {
    display: block;
    color: #FFFFFF;
    font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
    font-size: 16px;
    font-weight: 500;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    line-height: 1.2;
  }
}
```

### Menu Items Styling
```scss
.header-menu {
  transform: translateX(650px); // Positioned to the right
  
  ul {
    display: flex;
    align-items: center;

    > li {
      &:not(:first-child) {
        margin-left: $margin-size-extra-small; // 15px spacing
      }

      > a,
      > span,
      > button {
        display: inline-flex;
        align-items: center;
        padding: 7px 10px;
        color: #FFFFFF;
        fill: #FFFFFF;
        cursor: pointer;
        font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
        font-size: 14px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        line-height: 1.2;

        &:hover {
          color: $yellow; // #4effd0
          fill: $yellow;
          text-decoration: none;
        }
      }

      &.-active > a {
        position: relative;
        color: $yellow; // #4effd0
        fill: $yellow;
        font-weight: 500;
        text-decoration: none;

        &:after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translate(-50%, 0);
          width: calc(100% - 20px);
          height: 2px;
          background: $yellow; // #4effd0 underline
        }
      }
    }
  }
}
```

## Menu Items Configuration

### Current Menu Structure (from `constants.js`)
```javascript
export const APP_HEADER_ITEMS = [
  {
    id: 'map',
    label: 'Explorer',
    href: '/data/explore',
    root: '/data',
  },
  {
    id: 'dashboard',
    label: 'Report',
    href: '/dashboard',
    root: '/dashboard',
    children: [
      {
        label: 'Create Dashboard',
        href: '/dashboard',
      },
      {
        label: 'Test Report',
        href: '/dashboard',
        testMode: true,
      },
    ],
  },
  {
    user: false,
    id: 'user',
    label: 'Log in',
  },
  {
    user: true,
    id: 'user',
    href: '/myrw',
    label: 'My Resource Watch',
    children: [
      {
        label: 'Profile',
        href: '/myrw/profile',
      },
      {
        label: 'Admin',
        href: '/admin',
        admin: true,
      },
      {
        label: 'Logout',
        id: 'logout',
      },
    ],
  },
];
```

### Menu Item Properties
- **id**: Unique identifier for the menu item
- **label**: Display text for the menu item
- **href**: URL for navigation (if no dropdown)
- **root**: Base path for active state detection
- **user**: Boolean indicating if item should show for logged-in users only
- **children**: Array of dropdown menu items
- **external**: Boolean for external links
- **admin**: Boolean for admin-only items

## Responsive Behavior

### Desktop (md and above)
- Full horizontal menu with all items visible
- Dropdown menus on hover
- Logo positioned to the left with negative margin
- Menu positioned to the right with transform

### Mobile (sm and below)
- Hamburger menu icon
- Slide-out menu from the right
- Full-screen overlay with backdrop
- Vertical menu layout

### Mobile Menu Styling
```scss
// layout/header/header-menu-mobile/_styles.scss
.c-header-menu-mobile {
  .header-menu-mobile-content {
    z-index: 4;
    visibility: hidden;
    position: fixed;
    top: 0;
    right: 0;
    display: flex;
    align-items: flex-end;
    flex-direction: column;
    width: 100%;
    height: 100%;
    transition: all $animation-time-2;

    &.-opened {
      visibility: visible;
    }

    .header-menu-mobile-nav {
      overflow-x: hidden;
      overflow-y: auto;
      width: calc(100% - #{$header-main-height-mobile});
      max-width: 400px;
      height: 100%;
      padding: 60px $margin-size-small $margin-size-small;
      transform: translate(100%, 0);
      background: $white;
      transition: transform $animation-time-2 $ease-in-out-cubic;

      &.-opened {
        transform: translate(0, 0);
      }
    }
  }
}
```

## Dropdown Menus

### Dropdown Styling
```scss
// css/components/ui/header-dropdown.scss
.c-header-dropdown {
  position: fixed;
  background-color: $white;
  border-radius: 4px;
  border: 1px solid $border-color-1;
  box-shadow: 0 20px 30px 0 rgba(0, 0, 0, 0.1);
  z-index: 10001;

  &:after {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    pointer-events: none;
    border-top: 8px solid transparent;
    border-bottom: 8px solid $white;
    border-right: 8px solid transparent;
    border-left: 8px solid transparent;
    transform: translate(-50%, -100%);
  }

  .header-dropdown-list {
    list-style: none;
    margin: 0;
    padding: $margin-size-small;

    .header-dropdown-list-item {
      white-space: nowrap;
      margin: math.div($margin-size-extra-small, 2) 0;
      cursor: pointer;

      > a,
      > button {
        text-decoration: none;
        color: $charcoal-grey;

        &:hover {
          color: $black;
        }
      }
    }
  }
}
```

### Data Dropdown Example
```jsx
// layout/header/header-data/component.jsx
const HeaderData = ({ children }) => {
  const [isVisible, setVisibility] = useState(false);
  const toggleDropdown = useDebouncedCallback((_isVisible) => {
    setVisibility(_isVisible);
  }, 50);

  return (
    <Tether
      attachment="top center"
      constraints={[{ to: 'window' }]}
      classes={{ element: 'c-header-dropdown' }}
      renderTarget={(ref) => (
        <Link href="/data/explore">
          <a
            ref={ref}
            onMouseEnter={() => toggleDropdown(true)}
            onMouseLeave={() => toggleDropdown(false)}
          >
            Data
          </a>
        </Link>
      )}
      renderElement={(ref) => {
        if (!isVisible) return null;

        return (
          <ul
            ref={ref}
            className="header-dropdown-list"
            onMouseEnter={() => toggleDropdown(true)}
            onMouseLeave={() => toggleDropdown(false)}
          >
            {children.map((c) => (
              <li key={c.label} className="header-dropdown-list-item">
                <Link href={c.href}>
                  <a>{c.label}</a>
                </Link>
              </li>
            ))}
          </ul>
        );
      }}
    />
  );
};
```

## Customization Guide

### Changing Header Background Color
```scss
// In layout/header/_styles.scss
.l-header {
  background-color: #YOUR_COLOR; // Change this
  backdrop-filter: blur(10px);   // Optional glass effect
}
```

### Changing Text Colors
```scss
// In layout/header/_styles.scss
.header-logo .brand-title {
  color: #YOUR_COLOR; // Logo color
}

.header-menu ul > li > a {
  color: #YOUR_COLOR; // Menu text color
  
  &:hover {
    color: #HOVER_COLOR; // Hover color
  }
}
```

### Adding New Menu Items
1. **Update constants.js**:
```javascript
export const APP_HEADER_ITEMS = [
  // ... existing items
  {
    id: 'new-item',
    label: 'New Item',
    href: '/new-page',
    root: '/new-page',
  },
];
```

2. **Create dropdown component** (if needed):
```jsx
// layout/header/header-new-item/component.jsx
const HeaderNewItem = ({ children }) => {
  // Dropdown implementation
};
```

3. **Register in header-menu/component.jsx**:
```javascript
const header = {
  // ... existing components
  'new-item': import('../header-new-item'),
};
```

### Modifying Typography
```scss
// In layout/header/_styles.scss
.header-logo .brand-title {
  font-family: 'Your-Font', sans-serif;
  font-size: 18px; // Adjust size
  font-weight: 600; // Adjust weight
  letter-spacing: 0.05em; // Adjust spacing
}

.header-menu ul > li > a {
  font-family: 'Your-Font', sans-serif;
  font-size: 16px; // Adjust size
  font-weight: 500; // Adjust weight
  letter-spacing: 0.05em; // Adjust spacing
}
```

### Adjusting Layout Positioning
```scss
// In layout/header/_styles.scss
.header-logo {
  margin-left: -500px; // Adjust logo position
}

.header-menu {
  transform: translateX(500px); // Adjust menu position
}
```

## Code Snippets

### Complete Header Styling
```scss
@import 'css/settings';

.l-header {
  background-color: #44546a;
  backdrop-filter: blur(10px);
  background-image: none;
  background-repeat: no-repeat;
  background-position: center;
  background-size: cover;
  z-index: 10000;

  &.-transparent {
    background-image: none;
    background-color: transparent;
  }

  .header-main {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: $header-main-height-mobile;
    position: relative;

    @media screen and (min-width: map-get($breakpoints, medium)) {
      height: $header-main-height;
    }
  }

  .header-logo {
    position: relative;
    margin-left: -630px;

    .brand-title {
      display: block;
      color: #FFFFFF;
      font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
      font-size: 16px;
      font-weight: 500;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      line-height: 1.2;
    }
  }

  .header-menu {
    transform: translateX(650px);
    
    ul {
      display: flex;
      align-items: center;

      > li {
        &:not(:first-child) {
          margin-left: $margin-size-extra-small;
        }

        > a,
        > span,
        > button {
          display: inline-flex;
          align-items: center;
          padding: 7px 10px;
          color: #FFFFFF;
          fill: #FFFFFF;
          cursor: pointer;
          font-family: 'Inter', 'Roboto', 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
          font-size: 14px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          line-height: 1.2;

          &:hover {
            color: $yellow;
            fill: $yellow;
            text-decoration: none;
          }
        }

        &.-active > a {
          position: relative;
          color: $yellow;
          fill: $yellow;
          font-weight: 500;
          text-decoration: none;

          &:after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 50%;
            transform: translate(-50%, 0);
            width: calc(100% - 20px);
            height: 2px;
            background: $yellow;
          }
        }
      }
    }
  }
}
```

### Complete Menu Configuration
```javascript
// layout/header/constants.js
export const APP_HEADER_ITEMS = [
  {
    id: 'map',
    label: 'Explorer',
    href: '/data/explore',
    root: '/data',
  },
  {
    id: 'dashboard',
    label: 'Report',
    href: '/dashboard',
    root: '/dashboard',
    children: [
      {
        label: 'Create Dashboard',
        href: '/dashboard',
      },
      {
        label: 'Test Report',
        href: '/dashboard',
        testMode: true,
      },
    ],
  },
  {
    user: false,
    id: 'user',
    label: 'Log in',
  },
  {
    user: true,
    id: 'user',
    href: '/myrw',
    label: 'My Resource Watch',
    children: [
      {
        label: 'Profile',
        href: '/myrw/profile',
      },
      {
        label: 'Admin',
        href: '/admin',
        admin: true,
      },
      {
        label: 'Logout',
        id: 'logout',
      },
    ],
  },
];

export default { APP_HEADER_ITEMS };
```

## Integration Points

### Authentication Integration
The header menu integrates with NextAuth for user authentication:
- Shows "Log in" for unauthenticated users
- Shows "My Resource Watch" dropdown for authenticated users
- Conditionally renders menu items based on user state

### Routing Integration
- Uses Next.js `useRouter` for active state detection
- Integrates with Next.js `Link` component for navigation
- Supports both internal and external links

### Responsive Integration
- Uses custom `Media` component for responsive behavior
- Automatically switches between desktop and mobile menus
- Maintains consistent functionality across devices

## Troubleshooting

### Common Issues
1. **Menu items not showing**: Check user authentication state and `user` property in constants
2. **Styling not applying**: Verify SCSS import order and specificity
3. **Dropdown not working**: Ensure Tether component is properly configured
4. **Mobile menu not opening**: Check JavaScript console for errors

### Debug Tips
- Use browser dev tools to inspect header structure
- Check SCSS compilation for styling issues
- Verify component imports and exports
- Test responsive behavior at different breakpoints

---

This documentation provides a complete guide to understanding and customizing the main header menu system. All color references have been updated to use the new `#4effd0` turquoise color scheme.
