import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const MIGRATION_NAME = /^\d+_[a-z0-9_]+\.sql$/;
const WRAPPER = /^(?:\s|--[^\r\n]*(?:\r?\n|$))*BEGIN\s*;([\s\S]*?)COMMIT\s*;\s*$/i;

/**
 * Runs each migration and its history marker in the same transaction.
 * Holds the same session-level advisory lock for the entire sequence.
 */
export async function runMigrations(db, directory) {
  const entries = (await readdir(directory)).filter(name => MIGRATION_NAME.test(name)).sort();
  const client = await db.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [871204]);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of entries) {
      const existing = await client.query("SELECT filename FROM schema_migrations WHERE filename=$1", [name]);
      if (existing.rows.length) continue;
      const text = await readFile(join(directory, name), "utf8");
      const match = text.match(WRAPPER);
      if (!match) throw new Error("Invalid migration wrapper: " + name);
      await client.query("BEGIN");
      try {
        // Migration SQL comes from trusted, versioned files only.
        await client.query(match[1]);
        await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [871204]);
    } finally {
      client.release();
    }
  }
}
