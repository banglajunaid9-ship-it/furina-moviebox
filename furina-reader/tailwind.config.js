/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        raised: token('raised'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        accent: token('accent'),
        accent2: token('accent-2'),
        'on-accent': token('on-accent'),
        danger: token('danger'),
        success: token('success'),
        warn: token('warn'),
      },
      fontFamily: {
        sans: ['"Manrope Variable"', 'system-ui', 'sans-serif'],
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
      },
      borderRadius: { xl: '14px', '2xl': '20px' },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 8px 32px -8px rgb(var(--accent) / 0.45)',
        card: '0 1px 0 0 rgb(255 255 255 / 0.04) inset, 0 12px 32px -16px rgb(0 0 0 / 0.6)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        rise: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        ripple: { '0%': { transform: 'scale(.6)', opacity: 0.9 }, '100%': { transform: 'scale(1.6)', opacity: 0 } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        rise: 'rise .35s cubic-bezier(.2,.7,.2,1) both',
        ripple: 'ripple 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};
