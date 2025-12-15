import { defineConfig } from "tsdown";

export default defineConfig({
  plugins: [],
  dts: true,
  format: ["esm", "cjs"],
  entry: ["src/index.ts", "src/routes/hono.ts", "src/routes/next.ts"],
  outDir: "dist",
  clean: true,
});
