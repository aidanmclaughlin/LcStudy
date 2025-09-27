/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: '#0f172a',
        surface: '#111827',
        accent: '#8b5cf6',
        accentMuted: '#a855f7'
      },
      boxShadow: {
        panel: '0 20px 45px -30px rgba(15, 23, 42, 0.7)'
      }
    }
  },
  plugins: []
};
