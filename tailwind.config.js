/** @type {import('tailwindcss').Config} */
const colors = require("tailwindcss/colors");

module.exports = {
  content: ["./components/**/*.tsx", "./pages/**/*.tsx", "./app/**/*.tsx"],
  theme: {
    colors: {
      transparent: "transparent",
      currentColor: "currentColor",
      black: colors.black,
      white: colors.white,
      gray: colors.gray,
      foreground: "#c5c8c6",
      background: "#1d1f21",
      selection: "#373b41",
      line: "#282a2e",
      comment: "#969896",
      red: "#cc6666",
      orange: "#de935f",
      yellow: "#f0c674",
      green: "#b5bd68",
      aqua: "#8abeb7",
      blue: "#81a2be",
      purple: "#b294bb",
    },
    extend: {
      letterSpacing: {
        tighter: "-.04em",
      },
      fontSize: {
        "5xl": "2.5rem",
        "6xl": "2.75rem",
        "7xl": "4.5rem",
        "8xl": "6.25rem",
      },
      boxShadow: {
        sm: "0 5px 10px rgba(0, 0, 0, 0.12)",
        md: "0 8px 30px rgba(0, 0, 0, 0.12)",
      },
      keyframes: {
        tick: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        blink: {
          "0%, 15%, 100%": {
            rx: 10,
            ry: 10,
            transform: "scaleY(1)",
          },
          "5%": {
            rx: 0,
            ry: 0,
            transform: "scaleY(0.1)",
          },
        },
        "reveal-tile": {
          "0%": {
            opacity: "0",
            transform: "scale(0.95)",
          },
          "100%": {
            opacity: "1",
            transform: "scale(1)",
          },
        },
        explode: {
          "0%": {
            transform: "scale(0.5) rotate(0deg)",
            opacity: "0",
          },
          "50%": {
            transform: "scale(2.5) rotate(180deg)",
            opacity: "1",
          },
          "100%": {
            transform: "scale(1) rotate(360deg)",
            opacity: "1",
          },
        },
      },
      animation: {
        tick: "tick 180s steps(60) infinite",
        blink: "blink 5s ease-out infinite",
        "reveal-tile": "reveal-tile 0.3s ease-out forwards",
        explode: "explode 0.5s ease-out forwards",
      },
    },
  },
  plugins: [],
};
