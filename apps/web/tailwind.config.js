/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#000000",
          elev: "#111111",
          elev2: "#141414",
          rail: "#0a0a0a",
        },
        line: {
          DEFAULT: "#1e1e1e",
          strong: "#2a2a2a",
        },
        dim: "#a2a2a2",
        faint: "#777777",
        accent: {
          DEFAULT: "#ccff00",
          ink: "#080a00",
          bright: "#e0ff4d",
        },
        risk: {
          low: "#22c55e",
          moderate: "#eab308",
          elevated: "#f97316",
          high: "#ef4444",
          info: "#888888",
        },
      },
      fontFamily: {
        sans: ["Inter", "PingFang TC", "Microsoft JhengHei", "sans-serif"],
        mono: ["SFMono-Regular", "Consolas", "monospace"],
      },
      keyframes: {
        "flow-reveal": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "flow-pulse": {
          "50%": { transform: "translateY(5px)", opacity: "0.45" },
        },
      },
      animation: {
        "flow-reveal": "flow-reveal .5s ease both",
        "flow-pulse": "flow-pulse 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
