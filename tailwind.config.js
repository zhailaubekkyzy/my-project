// tailwind.config.js - Compiled ahead of time into css/tailwind.css (npm run build:css).
//
// Colors come from CSS variables in css/app.css, so one class works in both themes:
// light by default, dark when Telegram is in dark mode (<html data-theme="dark">).
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        handwritten: ['Caveat', 'cursive']
      },
      colors: {
        // Surfaces and text
        page: v('page'),
        card: v('card'),
        sunken: v('sunken'),
        raised: v('raised'),
        ink: v('ink'),
        'ink-2': v('ink-2'),
        muted: v('muted'),
        faint: v('faint'),
        line: v('line'),
        'line-2': v('line-2'),
        // People = Tiffany, SI = soft red (logo: SI in the center connects people)
        brand: v('brand'),
        si: v('si'),
        tiffany: {
          300: '#a3eae3',
          400: '#81D8D0',
          500: '#50c8b6',
          600: '#14b8a6',
          700: '#0d9488'
        },
        // Accent shades used as text/tints: darker in the light theme for contrast
        emerald: { 300: v('emerald-300'), 400: v('emerald-400'), 800: v('emerald-800'), 900: v('emerald-900'), 950: v('emerald-950') },
        rose: { 300: v('rose-300'), 400: v('rose-400'), 900: v('rose-900') },
        amber: { 300: v('amber-300'), 400: v('amber-400') },
        violet: { 200: v('violet-200'), 300: v('violet-300'), 400: v('violet-400'), 900: v('violet-900') },
        sky: { 300: v('sky-300'), 400: v('sky-400') }
      }
    }
  }
};
