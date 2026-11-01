/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#FBF2F4", 100: "#F6E3E8", 200: "#ECC6D0", 300: "#DE9DAE", 400: "#C96B85",
          500: "#AE4463", 600: "#922D4C", 700: "#7A1E3A", 800: "#651A31", 900: "#55182B", 950: "#300914",
        },
        paper: "#FBF8F7",
        ink: { DEFAULT: "#21151A", soft: "#4A3D42", muted: "#7A6D72", faint: "#A89DA1" },
        line: { DEFAULT: "#ECE3E1", strong: "#DCD0CD" },
        sure: { DEFAULT: "#2F6F4F", bg: "#EAF4EE" },
        maybe: { DEFAULT: "#A86B12", bg: "#FBF1DF" },
      },
      fontFamily: {
        display: ['"Newsreader Variable"', "Georgia", "serif"],
        sans: ['"Geist Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(48, 9, 20, 0.04), 0 1px 1px rgba(48, 9, 20, 0.02)",
        lift: "0 12px 32px -12px rgba(48, 9, 20, 0.18), 0 2px 6px rgba(48, 9, 20, 0.05)",
        ring: "0 0 0 4px rgba(122, 30, 58, 0.12)",
      },
      borderRadius: { xl: "12px", "2xl": "16px" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        pulsering: { "0%": { transform: "scale(1)", opacity: ".45" }, "100%": { transform: "scale(1.7)", opacity: "0" } },
      },
      animation: { shimmer: "shimmer 1.4s infinite", pulsering: "pulsering 1.6s ease-out infinite" },
    },
  },
  plugins: [],
};
