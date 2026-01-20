const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sqlite3 = require('sqlite3').verbose();

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

describe('init_db.py end-to-end schema (temp DB file)', () => {
  const backendDir = path.resolve(__dirname, '../../');
  const tmpDir = path.resolve(backendDir, 'tmp');
  const dbPath = path.resolve(tmpDir, `test-initdb-${Date.now()}.sqlite`);
  let db;

  beforeAll(async () => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const result = spawnSync('python3', ['init_db.py'], {
      cwd: backendDir,
      env: { ...process.env, WORKINPILOT_DB_PATH: dbPath },
      encoding: 'utf-8'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`init_db.py failed (code ${result.status}):\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    }

    db = new sqlite3.Database(dbPath);
  });

  afterAll(() => {
    if (db) db.close();
    try { fs.unlinkSync(dbPath); } catch (_) {}
  });

  test('applications: hidden present, cover_letter absent, applied_date nullable, status enum+default', async () => {
    const cols = await all(db, 'PRAGMA table_info(applications)');
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('hidden');
    expect(colNames).not.toContain('cover_letter');
    const appliedDate = cols.find(c => c.name === 'applied_date');
    expect(appliedDate).toBeTruthy();
    expect(appliedDate.notnull).toBe(0);

    const row = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='applications'");
    const sql = (row && row.sql) || '';
    expect(sql).toMatch(/CHECK\(status IN \('pending', 'applied', 'received', 'screening', 'interview', 'offer', 'rejected', 'cancelled', 'archived'\)\)/);
    expect(sql).toMatch(/DEFAULT 'pending'/);
    expect(sql).not.toContain("'withdrawn'");
  });

  test('application_status_type exists and seeded ranks', async () => {
    const tbl = await get(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='application_status_type'");
    expect(tbl).toBeTruthy();
    const rows = await all(db, 'SELECT name, rank FROM application_status_type ORDER BY rank');
    const names = rows.map(r => r.name);
    expect(names).toEqual(['pending','applied','received','screening','interview','offer','rejected','cancelled','archived']);
  });

  test('user_activities includes new activity types', async () => {
    const row = await get(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_activities'");
    const sql = (row && row.sql) || '';
    const required = [
      'screening_scheduled',
      'screening_completed',
      'offer_received',
      'application_archived',
      'application_reject',
      'application_cancel'
    ];
    for (const t of required) {
      expect(sql.includes(`'${t}'`)).toBe(true);
    }
  });
});


