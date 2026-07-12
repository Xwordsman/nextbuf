import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "worker/index": "src/worker/index.ts",
    "cli/index": "src/cli/index.ts",
  },
  clean: true,
  dts: false,
  format: ["esm"],
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node24",
});
