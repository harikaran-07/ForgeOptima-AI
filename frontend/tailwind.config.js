/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#05080F",
          900: "#070C16",
          850: "#0A1120",
          800: "#0D1524",
          750: "#111A2C",
          700: "#162134",
          600: "#1D2A40",
          500: "#28374F",
        },
        ink: {
          50: "#F3F6FB",
          100: "#E4EAF4",
          200: "#C6D1E2",
          300: "#9DACC3",
          400: "#7688A3",
          500: "#5A6B85",
          600: "#41506A",
        },
        electric: "#3B7DFF",
        cyan: "#22D3EE",
        violet: "#8B7CF6",
        good: "#34D399",
        warn: "#FBBF24",
        crit: "#F87171",
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 32px -18px rgba(0,0,0,0.9)",
      },
      keyframes: {
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseSoft: "pulseSoft 2.4s ease-in-out infinite",
        slideUp: "slideUp 0.28s ease-out both",
      },
    },
  },
  plugins: [],
};
