import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run(){
  const dbPath = path.join(__dirname, '..', 'data.db');
  console.log('Using DB:', dbPath);
  const db = new sqlite3.Database(dbPath);
  db.runAsync = promisify(db.run.bind(db));
  db.getAsync = promisify(db.get.bind(db));

  // Ensure table exists
  await new Promise((resolve) => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      phone TEXT,
      address TEXT
    );`, () => resolve());
  });

  const before = await db.getAsync('SELECT COUNT(*) as c FROM users');
  await db.runAsync('DELETE FROM users');
  const after = await db.getAsync('SELECT COUNT(*) as c FROM users');

  console.log(`Users removed: ${before.c - after.c}`);
  db.close();
}

run().catch(err => { console.error(err); process.exit(1); });
