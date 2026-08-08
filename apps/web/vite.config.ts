import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoDayPptSource = path.resolve(
  __dirname,
  "../../docs/demo/parallax-demo-day/parallax-demo-day.html",
);

const copyDemoDayPpt = () => {
  let outputDir = path.resolve(__dirname, "dist");

  return {
    name: "copy-demo-day-ppt",
    configResolved(config: { build: { outDir: string } }) {
      outputDir = config.build.outDir;
    },
    closeBundle() {
      mkdirSync(outputDir, { recursive: true });
      copyFileSync(
        demoDayPptSource,
        path.join(outputDir, "parallax-demo-day.html"),
      );
    },
  };
};

export default defineConfig({
  plugins: [react(), copyDemoDayPpt()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
