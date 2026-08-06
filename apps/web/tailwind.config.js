/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#05050a",
          elev: "#0c0b12",
          elev2: "#12111a",
          rail: "#171521",
        },
        line: {
          DEFAULT: "#29253a",
          strong: "#4a435f",
        },
        dim: "#d8d4e2",
        faint: "#9993a8",
        accent: {
          DEFAULT: "#836ef9",
          ink: "#08070d",
          bright: "#9d8cff",
        },
        // Monad brand violet, used by the wallet demo. Kept separate from
        // `accent` so wallet chrome tracks the brand swatch exactly even if the
        // landing accent is retuned.
        monad: {
          DEFAULT: "#6E56F8",
          ink: "#ffffff",
          bright: "#8B75FF",
          dim: "#A996FF",
        },
        risk: {
          low: "#75e6b1",
          moderate: "#f4bd63",
          elevated: "#91b8ff",
          high: "#ff7d8a",
          info: "#aaa3b8",
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
        "flow-nudge": {
          "0%, 100%": { transform: "translateY(-2px)", opacity: "0.55" },
          "50%": { transform: "translateY(3px)", opacity: "1" },
        },
      },
      animation: {
        "flow-reveal": "flow-reveal .5s ease both",
        "flow-pulse": "flow-pulse 1.5s ease-in-out infinite",
        "flow-nudge": "flow-nudge 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
