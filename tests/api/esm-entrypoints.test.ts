import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tsc = join("node_modules", "typescript", "bin", "tsc");

describe("compiled api entries", () => {
  it("loads each api entry with plain Node", () => {
    const outDir = mkdtempSync(join(process.cwd(), ".esm-check-"));
    try {
      const compiled = spawnSync(
        process.execPath,
        [tsc, "-p", "tsconfig.esm.json", "--outDir", outDir],
        { encoding: "utf8" },
      );
      expect({ status: compiled.status, stdout: compiled.stdout, stderr: compiled.stderr }).toMatchObject({
        status: 0,
      });
      const loaded = spawnSync(process.execPath, ["scripts/load-api-entries.mjs", join(outDir, "api")], {
        encoding: "utf8",
      });
      expect({ status: loaded.status, stdout: loaded.stdout, stderr: loaded.stderr }).toMatchObject({
        status: 0,
      });
      expect(loaded.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
      const count = Number(loaded.stdout.trim().replace(/^loaded /, ""));
      expect(count).toBeGreaterThanOrEqual(3);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("fails with ERR_MODULE_NOT_FOUND when a relative import has no extension", () => {
    const dir = mkdtempSync(join(process.cwd(), ".esm-check-"));
    try {
      writeFileSync(join(dir, "other.js"), "export const ok = 1;\n");
      writeFileSync(join(dir, "entry.js"), 'import "./other";\nexport const entry = 1;\n');
      const loaded = spawnSync(process.execPath, ["scripts/load-api-entries.mjs", dir], {
        encoding: "utf8",
      });
      expect(loaded.status).not.toBe(0);
      expect(`${loaded.stderr}`).toContain("ERR_MODULE_NOT_FOUND");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
