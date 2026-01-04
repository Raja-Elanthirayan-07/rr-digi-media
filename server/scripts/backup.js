import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..', '..');

function resolveDbPath() {
  const configuredPath = (process.env.DB_PATH || '').trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
  }
  return path.join(projectRoot, 'server', 'data.db');
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

async function backup() {
  const dbPath = resolveDbPath();
  const backupsDir = path.join(projectRoot, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `data-${timestamp}.db`);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB file not found at: ${dbPath}`);
  }

  // Prefer a consistent SQLite backup when possible.
  // If VACUUM INTO isn't supported, fall back to a file copy.
  await new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath);
    const sql = `VACUUM INTO '${escapeSqlString(backupPath)}'`;
    db.run(sql, (err) => {
      db.close(() => {
        if (err) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }).then((didVacuum) => {
    if (!didVacuum) {
      fs.copyFileSync(dbPath, backupPath);
    }
  });

  console.log(`Backup created: ${backupPath}`);
}

backup().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
