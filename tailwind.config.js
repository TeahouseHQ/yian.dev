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
      // Semantic colours resolve from CSS custom properties declared in
      // `styles/index.css` `:root`, so the palette can be swapped at runtime
      // (groundwork for the blog reader light theme, ADR-0005). Each value is
      // the variable's RGB channels wrapped in `rgb(... / <alpha-value>)`:
      // the `<alpha-value>` placeholder is what lets Tailwind still emit the
      // opacity-modified utilities the site relies on (e.g. `bg-foreground/10`,
      // `text-foreground/30`, `border-foreground/30`). A bare `var(--x)` here
      // would silently drop those classes. The channel triplets equal the
      // previous dark hexes, so rendering is unchanged.
      foreground: "rgb(var(--color-foreground) / <alpha-value>)",
      background: "rgb(var(--color-background) / <alpha-value>)",
      selection: "rgb(var(--color-selection) / <alpha-value>)",
      line: "rgb(var(--color-line) / <alpha-value>)",
      comment: "rgb(var(--color-comment) / <alpha-value>)",
      red: "rgb(var(--color-red) / <alpha-value>)",
      orange: "rgb(var(--color-orange) / <alpha-value>)",
      yellow: "rgb(var(--color-yellow) / <alpha-value>)",
      green: "rgb(var(--color-green) / <alpha-value>)",
      aqua: "rgb(var(--color-aqua) / <alpha-value>)",
      blue: "rgb(var(--color-blue) / <alpha-value>)",
      purple: "rgb(var(--color-purple) / <alpha-value>)",
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
