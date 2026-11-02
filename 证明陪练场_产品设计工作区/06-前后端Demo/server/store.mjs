/**
 * store.mjs —— JSON 持久化（server/data/db.json，首次启动自动 seed）
 * 所有写入同步落盘，单进程 Demo 够用；测试用临时 dbPath。
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildSeed } from './seed.mjs';

const MAX_EVENTS = 4000;

export function createStore(dbPath) {
  if (!dbPath) throw new Error('createStore: dbPath required');
  const file = path.resolve(dbPath);
  let db = null;

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  }

  function load() {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.students) || !Array.isArray(parsed.problems)) throw new Error('bad db shape');
        // v1 → v2 迁移：schema 版本不一致时重新 seed（演示数据可重置；避免 health.version / state 字段错位）
        const EXPECTED_SCHEMA = '2.0.0';
        if (!parsed.meta || parsed.meta.version !== EXPECTED_SCHEMA) {
          console.log('[store] schema ' + (parsed.meta && parsed.meta.version) + ' -> ' + EXPECTED_SCHEMA + ', reseeding');
          db = buildSeed();
          persist();
          return;
        }
        db = parsed;
      } else {
        db = buildSeed();
        persist();
      }
    } catch {
      db = buildSeed();
      persist();
    }
  }

  function reset() {
    db = buildSeed();
    persist();
    return db.meta.seededAt;
  }

  function addEvent(evt) {
    db.events.push(evt);
    if (db.events.length > MAX_EVENTS) db.events = db.events.slice(-MAX_EVENTS);
  }

  load();

  return {
    get db() { return db; },
    get dbPath() { return file; },
    persist,
    reset,
    addEvent,
    counts() {
      return { students: db.students.length, problems: db.problems.length, attempts: db.attempts.length, events: db.events.length };
    },
  };
}
