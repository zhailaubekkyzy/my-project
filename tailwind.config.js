// tailwind.config.js - Same theme the app used with the Tailwind Play CDN,
// now compiled ahead of time into css/tailwind.css (npm run build:css).
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  // Built from template strings at runtime (e.g. `mt-${isDeviceMode ? '6' : '0'}`)
  safelist: ['mt-0', 'mt-6'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        handwritten: ['Caveat', 'cursive']
      },
      colors: {
        tiffany: {
          300: '#a3eae3',
          400: '#81D8D0',
          500: '#50c8b6',
          600: '#14b8a6',
          700: '#0d9488'
        },
        crimson: {
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c'
        }
      }
    }
  }
};
