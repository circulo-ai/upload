import { spawnSync } from "node:child_process";

if (!process.env.UPLOAD_S3_TEST_ENDPOINT) {
  console.error(
    "Set UPLOAD_S3_TEST_ENDPOINT to a disposable MinIO instance. See PRODUCTION.md.",
  );
  process.exitCode = 1;
} else {
  const result = spawnSync(
    "bun",
    [
      "./node_modules/vitest/vitest.mjs",
      "run",
      "tests/integration/s3.contract.test.ts",
    ],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.error) console.error(result.error);
  process.exitCode = result.status ?? 1;
}
