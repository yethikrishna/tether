import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function loadOrCreateKey(path) {
  if (existsSync(path)) {
    const key = readFileSync(path);
    if (key.length !== 32) throw new Error('TETHER local encryption key has an invalid length');
    chmodSync(path, 0o600);
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(path, key, { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  return key;
}

function encrypt(key, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decrypt(key, ciphertext, iv, tag) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

export class VersionConflictError extends Error {
  constructor(id) {
    super(`run version conflict: ${id}`);
    this.name = 'VersionConflictError';
  }
}

/**
 * Single-owner local demo store. All run/event/user text is AES-GCM encrypted;
 * only IDs, state labels, versions, and timestamps remain queryable in SQLite.
 * This local key-file mode is for a private demo host only, never deployment.
 */
export class SqliteRunRepository {
  constructor({ filename = resolve('.data/tether.sqlite'), keyFilename = resolve('.data/local-dev.key') } = {}) {
    this.filename = resolve(filename);
    this.keyFilename = resolve(keyFilename);
    ensureDirectory(dirname(this.filename));
    ensureDirectory(dirname(this.keyFilename));
    this.key = loadOrCreateKey(this.keyFilename);
    const previousUmask = process.umask(0o077);
    try {
      this.db = new DatabaseSync(this.filename);
    } finally {
      process.umask(previousUmask);
    }
    chmodSync(this.filename, 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        fo_status TEXT,
        conversation_id TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        iv BLOB NOT NULL,
        tag BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_updated_at ON runs(updated_at DESC);
      CREATE TABLE IF NOT EXISTS secure_kv (
        name TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, iv BLOB NOT NULL, tag BLOB NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = this.filename + suffix;
      if (existsSync(sidecar)) chmodSync(sidecar, 0o600);
    }
    this.insert = this.db.prepare(`
      INSERT INTO runs (id,status,fo_status,conversation_id,version,created_at,updated_at,ciphertext,iv,tag)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    this.update = this.db.prepare(`
      UPDATE runs SET status=?,fo_status=?,conversation_id=?,version=?,updated_at=?,ciphertext=?,iv=?,tag=?
      WHERE id=? AND version=?
    `);
    this.selectOne = this.db.prepare('SELECT id,status,fo_status,conversation_id,version,created_at,updated_at,ciphertext,iv,tag FROM runs WHERE id=?');
    this.selectAll = this.db.prepare('SELECT id,status,fo_status,conversation_id,version,created_at,updated_at,ciphertext,iv,tag FROM runs ORDER BY updated_at DESC LIMIT ?');
    this.deleteOne = this.db.prepare('DELETE FROM runs WHERE id=?');
    this.selectExists = this.db.prepare('SELECT 1 AS present FROM runs WHERE id=?');
    this.secretGet = this.db.prepare('SELECT ciphertext,iv,tag FROM secure_kv WHERE name=?');
    this.secretUpsert = this.db.prepare('INSERT INTO secure_kv(name,ciphertext,iv,tag,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag,updated_at=excluded.updated_at');
    this.secretDelete = this.db.prepare('DELETE FROM secure_kv WHERE name=?');
  }

  save(run) {
    if (!run || typeof run.id !== 'string' || !Number.isSafeInteger(run.version)) throw new TypeError('invalid run');
    const sealed = encrypt(this.key, run);
    if (!this.selectExists.get(run.id)) {
      try {
        this.insert.run(run.id, run.status, run.foStatus, run.conversationId, run.version, run.createdAt, run.updatedAt, sealed.ciphertext, sealed.iv, sealed.tag);
      } catch (error) {
        if (String(error?.message ?? '').toLowerCase().includes('unique')) throw new VersionConflictError(run.id);
        throw error;
      }
    } else {
      const result = this.update.run(run.status, run.foStatus, run.conversationId, run.version, run.updatedAt, sealed.ciphertext, sealed.iv, sealed.tag, run.id, run.version - 1);
      if (Number(result.changes) !== 1) throw new VersionConflictError(run.id);
    }
    this.lockFiles();
    return run;
  }

  get(id) {
    const row = this.selectOne.get(id);
    return row ? this.openRow(row) : null;
  }

  list(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError('limit must be 1–500');
    return this.selectAll.all(limit).map((row) => this.openRow(row));
  }

  setSecret(name, value) {
    if (typeof name !== 'string' || !name || name.length > 128) throw new TypeError('invalid secret name');
    const sealed = encrypt(this.key, value);
    this.secretUpsert.run(name, sealed.ciphertext, sealed.iv, sealed.tag, new Date().toISOString());
    this.lockFiles();
  }

  getSecret(name) {
    const row = this.secretGet.get(name);
    return row ? decrypt(this.key, row.ciphertext, row.iv, row.tag) : undefined;
  }

  deleteSecret(name) {
    const result = this.secretDelete.run(name);
    this.lockFiles();
    return Number(result.changes) === 1;
  }

  delete(id) {
    const result = this.deleteOne.run(id);
    this.lockFiles();
    return Number(result.changes) === 1;
  }

  close() {
    this.db.close();
  }

  openRow(row) {
    const payload = decrypt(this.key, row.ciphertext, row.iv, row.tag);
    // Clear metadata is deliberately checked against the encrypted record.
    if (payload.id !== row.id || payload.status !== row.status || payload.version !== row.version) {
      throw new Error('run metadata integrity mismatch');
    }
    return payload;
  }

  lockFiles() {
    chmodSync(this.filename, 0o600);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = this.filename + suffix;
      if (existsSync(sidecar)) chmodSync(sidecar, 0o600);
    }
  }
}
