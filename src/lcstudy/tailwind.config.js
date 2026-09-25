/** @type {import('tailwindcss').Config} */
// Tailwind only supplies the preflight reset; all styling lives in app/styles.
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
