/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // dark TikTok/CapCut-ish editor palette
        ink: {
          900: "#0b0b0d",
          800: "#13141a",
          700: "#1c1d24",
          600: "#272832",
          500: "#393a48",
        },
        accent: {
          400: "#7dd3fc",
          500: "#38bdf8",
          600: "#0ea5e9",
        },
      },
    },
  },
  plugins: [],
};
