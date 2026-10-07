import { defineConfig } from "tsdown";

export default defineConfig({
  plugins: [],
  dts: true,
  format: ["esm", "cjs"],
  entry: [
    "src/index.ts",
    "src/providers/s3.ts",
    "src/providers/local.ts",
    "src/providers/local-signed.ts",
    "src/providers/azure-blob.ts",
    "src/providers/ftp.ts",
    "src/providers/vercel-blob.ts",
    "src/core.ts",
    "src/routes/hono.ts",
    "src/routes/next.ts",
    "src/routes/trpc.ts",
    "src/utils/validation.ts",
    "src/react.tsx",
  ],
  outDir: "dist",
  clean: true,
});
