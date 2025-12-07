import { defineConfig } from "tsdown";

export default defineConfig({
  plugins: [],
  dts: true,
  entry: "src/index.ts",
  outDir: "dist",
  clean: true,
});
