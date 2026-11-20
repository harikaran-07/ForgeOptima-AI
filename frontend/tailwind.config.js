/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          950: "#040D0B", // Deepest dark emerald-black
          900: "#071411", // Dark Background as specified
          850: "#10231D", // Card Background as specified
          800: "#142B23", // Secondary Background as specified
          750: "#1A352C", // Elevated sub-card background
          700: "#24513F", // Border as specified
          600: "#2E644E", // Border hover / secondary
          500: "#3D7A62", // Muted highlight
        },
        ink: {
          50: "#F0FDF4",
          100: "#ECFDF5", // Primary Text as specified
          200: "#D1FAE5",
          300: "#A7F3D0",
          400: "#9CB8AA", // Secondary Text as specified
          500: "#6B9280",
          600: "#4D7362",
        },
        emerald: {
          deep: "#064E3B",    // Deep Emerald as specified
          DEFAULT: "#10B981", // Emerald Green as specified
          bright: "#34D399",  // Bright Mint as specified
          mint: "#34D399",
        },
        // Semantic aliases mapped to Emerald Tech palette
        electric: "#10B981", // Emerald Green
        cyan: "#34D399",     // Bright Mint
        violet: "#059669",   // Medium Forest Emerald (zero purple/blue)
        good: "#10B981",     // Emerald Green
        warn: "#FBBF24",     // Warning Amber as specified
        crit: "#F87171",     // Error Red as specified
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(52, 211, 153, 0.05) inset, 0 12px 32px -18px rgba(0,0,0,0.85)",
        emeraldGlow: "0 0 25px -5px rgba(16, 185, 129, 0.25)",
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
