import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), "circulo-upload-package-"));
try {
  const installed = join(temporary, "node_modules", "@circulo-ai", "upload");
  await mkdir(installed, { recursive: true });
  const packed = spawnSync(
    "bun",
    ["pm", "pack", "--ignore-scripts", "--quiet", "--destination", temporary],
    { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const archive = resolve(
    temporary,
    packed.stdout.trim().split(/\r?\n/).at(-1),
  );
  const extracted = spawnSync(
    "tar",
    ["-xf", archive, "-C", installed, "--strip-components=1"],
    { encoding: "utf8", timeout: 30_000, windowsHide: true },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
  // This fixture intentionally installs NO SDK, framework, or React dependencies.
  const code = `
    const assert = require("node:assert/strict");
    const { mkdtemp, rm } = require("node:fs/promises");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    (async () => {
      const load = MODE === "esm" ? (name) => import(name) : async (name) => require(name);
      for (const name of ["", "/core", "/local", "/local-signed", "/s3", "/azure-blob", "/ftp", "/vercel-blob"]) {
        assert.ok(await load("@circulo-ai/upload" + name));
      }
      const { LocalStorageProvider } = await load("@circulo-ai/upload/local");
      const { S3StorageProvider } = await load("@circulo-ai/upload/s3");
      assert.throws(() => new S3StorageProvider({ bucket: "test", region: "test" }), (error) => error.code === "DEPENDENCY_MISSING" && Boolean(error.cause));
      const path = await mkdtemp(join(tmpdir(), "upload-consumer-"));
      try {
        const storage = new LocalStorageProvider({ basePath: path });
        const object = await storage.upload({ file: Buffer.from("ok"), fileName: "file", contentType: "text/plain", writeMode: "create-only" });
        assert.equal((await storage.download({ key: object.key })).toString(), "ok");
      } finally { await rm(path, { recursive: true, force: true }); }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  for (const runtime of ["node", "bun"]) {
    for (const mode of ["esm", "cjs"]) {
      const fixture = join(temporary, `consumer-${runtime}-${mode}.cjs`);
      await writeFile(
        fixture,
        `const MODE = ${JSON.stringify(mode)};\n${code}`,
      );
      const result = spawnSync(runtime, [fixture], {
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
      });
      assert.equal(
        result.status,
        0,
        `${runtime} ${mode}: ${result.error ?? result.stderr}`,
      );
      console.log(
        `Package consumer passed: ${runtime} ${mode}, no optional dependencies`,
      );
    }
  }
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  // Check the published declarations, including NodeNext CommonJS consumers.
  const declarationFixture = `
    import { StorageManager, type StorageProvider } from "@circulo-ai/upload/core";
    import { S3StorageProvider } from "@circulo-ai/upload/s3";
    declare const provider: StorageProvider;
    const manager = new StorageManager({ providers: { images: provider, docs: provider }, defaultContext: "images" });
    manager.supportsPresignedUrls("docs");
    // @ts-expect-error Invalid context must fail in published declarations too.
    manager.supportsPresignedUrls("unknown");
    new S3StorageProvider({ bucket: "media", region: "us-east-1", credentials: async () => ({ accessKeyId: "test", secretAccessKey: "test" }) });
  `;
  for (const extension of ["mts", "cts"]) {
    const fixture = join(temporary, `consumer.${extension}`);
    await writeFile(fixture, declarationFixture);
    const checked = spawnSync(
      "node",
      [
        require.resolve("typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--module",
        "NodeNext",
        "--target",
        "ES2022",
        "--types",
        "node",
        "--typeRoots",
        dirname(dirname(require.resolve("@types/node/package.json"))),
        fixture,
      ],
      { encoding: "utf8", timeout: 30_000, windowsHide: true },
    );
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    console.log(
      `Published declarations passed: NodeNext ${extension}, no SDK types`,
    );
  }
  // Only the tRPC subpath requires these peers. Test its actual packed ESM/CJS exports.
  for (const peer of ["@trpc/server", "zod"]) {
    await cp(
      dirname(require.resolve(`${peer}/package.json`)),
      join(temporary, "node_modules", peer),
      { recursive: true },
    );
  }
  const rpcFixture = join(temporary, "trpc-consumer.cjs");
  await writeFile(
    rpcFixture,
    `
    (async () => {
      const assert = require("node:assert/strict");
      for (const load of [(name) => import(name), async (name) => require(name)]) {
        const { createTRPCFileHandlers, trpcFileSchemas } = await load("@circulo-ai/upload/trpc");
        assert.equal(typeof createTRPCFileHandlers, "function");
        assert.ok(trpcFileSchemas.delete.safeParse({ key: "valid/key" }).success);
      }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `,
  );
  for (const runtime of ["node", "bun"]) {
    const checked = spawnSync(runtime, [rpcFixture], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    assert.equal(checked.status, 0, checked.stderr);
    console.log(`Packed tRPC exports passed: ${runtime} ESM/CJS`);
  }
  for (const [name, entry] of Object.entries(manifest.exports)) {
    for (const condition of ["import", "require"]) {
      const target =
        typeof entry[condition] === "string"
          ? entry[condition]
          : entry[condition].default;
      await readFile(join(installed, target));
    }
    assert.ok(name.startsWith("."));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
