// Runs repository SQL against SQLite with the real migrations; no D1/production access.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = new URL('../../migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(x => x.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  function execute(statement, method) {
    const prepared = sqlite.prepare(statement.sql);
    const numbered = new Set(statement.sql.match(/\?\d+/g) ?? []);
    const args = numbered.size
      ? [Object.fromEntries(statement.args.map((value, index) => ['?' + (index + 1), value])
        .filter(([name]) => numbered.has(name)))]
      : statement.args;
    return prepared[method](...args);
  }
  const DB = {
    sqlite,
    prepare(sql) {
      return {
        sql, args: [],
        bind(...args) { return { ...this, args }; },
        async first() { return execute(this, 'get') ?? null; },
        async all() { return { success: true, results: execute(this, 'all') }; },
        async run() {
          const result = execute(this, 'run');
          return { success: true, meta: { changes: Number(result.changes) } };
        }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) {
          // No other statements may run between SQL mutations (changes() semantics).
          const result = execute(statement, 'run');
          results.push({ success: true, meta: { changes: Number(result.changes) } });
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  return DB;
}
