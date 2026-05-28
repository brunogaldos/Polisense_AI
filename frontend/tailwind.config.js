const typography = require('@tailwindcss/typography');
const lineClamp = require('@tailwindcss/line-clamp');

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './layout/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      typography: (theme) => ({
        DEFAULT: {
          css: {
            color: theme('colors.gray.100'),
            lineHeight: 1.625,
            fontFamily: theme('fontFamily.sans'),
          },
        },
      }),
      colors: {
        'ui-dark': '#1e1e1e',
        'ui-panel': 'rgba(30, 30, 30, 0.85)',
        'accent-orange': '#ff7849',
        'accent-blue': '#4da6ff',
        'accent-purple': '#a78bfa',
        'accent-green': '#34d399',
      },
    },
    fontFamily: {
      sans: ['Inter', 'Lato', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
    },
  },
  plugins: [typography, lineClamp],
};
