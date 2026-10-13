import { defineConfig } from "tsdown";

export default defineConfig({
  plugins: [],
  dts: true,
  format: ["esm", "cjs"],
  entry: {
    index: "src/index.ts",
    "providers/s3": "src/providers/s3.ts",
    "providers/local": "src/providers/local.ts",
    "providers/local-signed": "src/providers/local-signed.ts",
    "providers/azure-blob": "src/providers/azure-blob.ts",
    "providers/ftp": "src/providers/ftp.ts",
    "providers/vercel-blob": "src/providers/vercel-blob.ts",
    core: "src/core.ts",
    "routes/hono": "src/routes/hono.ts",
    "routes/next": "src/routes/next.ts",
    "routes/trpc": "src/routes/trpc.ts",
    "utils/validation": "src/utils/validation.ts",
    react: "src/react.tsx",
  },
  outDir: "dist",
  clean: true,
});
