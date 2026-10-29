/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#0b1220', 900: '#111a2e', 800: '#18233b', 700: '#22304d', 600: '#2e3e60' },
        parchment: { 50: '#faf4e6', 100: '#f1e6cc', 200: '#e3d2a8', 300: '#cdb680' },
        gold: { 300: '#ecc979', 400: '#d9b25f', 500: '#c19a45', 600: '#9c7a31' },
        burgundy: { 400: '#b0475a', 500: '#8e2f42', 600: '#6e2233' },
      },
      fontFamily: {
        display: ['"Cinzel"', 'Georgia', 'serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
