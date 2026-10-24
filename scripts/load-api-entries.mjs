import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
if (!root) {
  process.stderr.write("usage: node scripts/load-api-entries.mjs <api-dir>\n");
  process.exit(1);
}

async function jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await jsFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

let files;
try {
  files = (await jsFiles(root)).sort();
} catch (error) {
  const message = error instanceof Error ? error.message : "cannot read api directory";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (files.length === 0) {
  process.stderr.write(`no api entries found in ${root}\n`);
  process.exit(1);
}

for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${code}\n${message}\n`);
    process.exit(1);
  }
  process.stdout.write(`${relative(root, file).split("\\").join("/")}\n`);
}

process.stdout.write(`loaded ${files.length}\n`);
