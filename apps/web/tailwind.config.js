/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#fafafa",
          elev: "#ffffff",
          elev2: "#f4f4f5",
          rail: "#f0f0f2",
        },
        line: {
          DEFAULT: "#c8c8cf",
          strong: "#a8a8b0",
        },
        dim: "#3f3f46",
        faint: "#6b6b75",
        accent: {
          DEFAULT: "#5840ff",
          ink: "#ffffff",
          bright: "#6e54ff",
        },
        risk: {
          low: "#15803d",
          moderate: "#b45309",
          elevated: "#0e7490",
          high: "#dc2626",
          info: "#6b6b75",
        },
      },
      fontFamily: {
        sans: ["Archivo", "PingFang SC", "Microsoft YaHei", "sans-serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "Consolas", "monospace"],
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
