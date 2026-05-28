export const APP_HEADER_ITEMS = [
  {
    id: 'map',
    label: 'Explorer',
    href: '/data/explore',
    // used to determine if the menu should be highlighted based on the current page
    root: '/data',
  },
  {
    id: 'dashboard',
    label: 'Report',
    href: '/dashboard',
    // used to determine if the menu should be highlighted based on the current page
    root: '/dashboard',
    children: [
      {
        label: 'Create New Report',
        href: '/dashboard',
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
    label: 'User',
    children: [
      {
        label: 'Logout',
        id: 'logout',
      },
    ],
  },
];

export default { APP_HEADER_ITEMS };
