import { readdir, readFile } from "node:fs/promises";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

register(new URL("./resolve-typescript.mjs", import.meta.url));
const { statementsFromSql } = await import("../src/admin/sql.js");

function redact(message, secret) {
  const withoutUrls = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
  if (!secret) return withoutUrls;
  return withoutUrls.split(secret).join("[redacted]");
}

async function applyMigrations(databaseUrl) {
  const directory = new URL("../migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const sql = neon(databaseUrl);
  const applied = [];
  for (const name of names) {
    const text = await readFile(new URL(name, directory), "utf8");
    for (const statement of statementsFromSql(text)) {
      await sql.query(statement);
    }
    applied.push(name);
  }
  return applied;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL_UNPOOLED is not set\n");
    process.exit(1);
  }
  try {
    const applied = await applyMigrations(databaseUrl);
    for (const name of applied) process.stdout.write(`applied ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "migration failed";
    process.stderr.write(`${redact(message, databaseUrl)}\n`);
    process.exit(1);
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) await main();
