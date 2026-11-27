const assert = require('node:assert/strict');
const Module = require('node:module');
const { after, test } = require('node:test');
const jwt = require('jsonwebtoken');

const secret = 'event-test-secret';
process.env.JWT_SECRET = secret;
process.env.DB_HOST = 'test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'test';

const inserts = [];
const summaryQueries = [];
const repairQueries = [];
const pool = {
  async query(sql, params) {
    if (sql.includes('SELECT loguser_id, lu_admin FROM logusers')) {
      return [[{ loguser_id: params[0], lu_admin: params[0] === 1 ? 1 : 0 }]];
    }
    if (sql.includes('COUNT(r.repair_id) AS total_repairs')) {
      summaryQueries.push({ sql, params });
      return [[
        { event_id: 3, ev_date: '2026-02-28', venue_name: 'Town Hall', total_repairs: 350, fixed_repairs: 200 },
        { event_id: 2, ev_date: '2026-02-27', venue_name: null, total_repairs: 0, fixed_repairs: 0 },
      ]];
    }
    if (sql.includes('INNER JOIN event e')) {
      repairQueries.push({ sql, params });
      return [[]];
    }
    if (sql.includes("lk_group = 'venue'")) {
      return [params[0] === 7 ? [{ lookup_id: 7, lk_name: 'Town Hall' }] : []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  async execute(sql, params) {
    assert.match(sql, /^INSERT INTO event/);
    inserts.push(params);
    return [{ insertId: 42 }];
  },
};

const realLoad = Module._load;
let server;
Module._load = function (request, parent, isMain) {
  if (request === 'mysql2/promise') return { createPool: () => pool };
  if (request === 'dotenv') return { config: () => ({}) };
  if (request === 'express') {
    const express = realLoad.call(this, request, parent, isMain);
    const mockExpress = () => {
      const app = express();
      app.listen = (_port, callback) => {
        server = require('node:http').createServer(app).listen(0, '127.0.0.1', callback);
        return server;
      };
      return app;
    };
    return Object.assign(mockExpress, express);
  }
  return realLoad.call(this, request, parent, isMain);
};

try {
  require('../dist/index.js');
} finally {
  Module._load = realLoad;
}

after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

const send = async (body, isAdmin) => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const headers = { 'Content-Type': 'application/json' };
  if (isAdmin !== undefined) {
    headers.Authorization = `Bearer ${jwt.sign({ userId: isAdmin ? 1 : 2, email: 'user@example.com', isAdmin }, secret)}`;
  }
  return fetch(`http://127.0.0.1:${server.address().port}/api/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
};

const validEvent = { ev_date: '2026-02-28', ev_venue: 7, ev_comment: '  Monthly event  ' };

test('requires a valid cutoff date for event summaries', async () => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  for (const query of ['', '?toDate=2026-02-29', '?toDate=invalid']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/summary${query}`);
    assert.equal(response.status, 400);
  }
  assert.equal(summaryQueries.length, 0);
});

test('returns event totals without the repair list limit', async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/summary?toDate=2026-02-28`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    { event_id: 3, ev_date: '2026-02-28', venue_name: 'Town Hall', total_repairs: 350, fixed_repairs: 200 },
    { event_id: 2, ev_date: '2026-02-27', venue_name: null, total_repairs: 0, fixed_repairs: 0 },
  ]);
  assert.deepEqual(summaryQueries[0].params, ['2026-02-28']);
  assert.match(summaryQueries[0].sql, /WHERE ev_date <= \?[\s\S]*ORDER BY ev_date DESC, event_id DESC/);
  assert.doesNotMatch(summaryQueries[0].sql, /LIMIT\s+\d+/);
  assert.match(summaryQueries[0].sql, /LEFT JOIN repair/);
});

test('summary query includes all repairs and all events up to the cutoff', {
  skip: !Module.builtinModules.includes('node:sqlite') && 'node:sqlite is unavailable',
}, () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE event (event_id INTEGER, ev_date TEXT, ev_venue INTEGER);
      CREATE TABLE lookup (lookup_id INTEGER, lk_name TEXT, lk_group TEXT);
      CREATE TABLE repair (repair_id INTEGER, rp_event INTEGER, rp_fixed INTEGER);
    `);
    db.prepare('INSERT INTO lookup VALUES (?, ?, ?)').run(1, 'Town Hall', 'venue');
    const addEvent = db.prepare('INSERT INTO event VALUES (?, ?, 1)');
    for (let i = 1; i <= 14; i++) addEvent.run(i, `2026-01-${String(i).padStart(2, '0')}`);
    addEvent.run(15, '2026-01-14');
    addEvent.run(16, '2027-01-01');
    const addRepair = db.prepare('INSERT INTO repair VALUES (?, 14, ?)');
    for (let i = 1; i <= 350; i++) addRepair.run(i, i <= 275 ? 1 : 0);

    const rows = db.prepare(summaryQueries[0].sql).all('2026-01-14');
    assert.deepEqual(rows.map((row) => row.event_id), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    assert.deepEqual([rows[0].total_repairs, rows[0].fixed_repairs], [0, 0]);
    assert.deepEqual([rows[1].total_repairs, rows[1].fixed_repairs], [350, 275]);
    assert.equal(db.prepare(summaryQueries[0].sql).all('9999-12-31')[0].event_id, 16);
  } finally {
    db.close();
  }
});

test('repair list orders by UID before applying its limit', async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/repairs?limit=3`);
  assert.equal(response.status, 200);
  assert.match(repairQueries[0].sql, /ORDER BY r\.rp_uid DESC, r\.repair_id DESC\s+LIMIT \?/);
});

test('repair ordering uses UID across events and breaks ties by primary key', {
  skip: !Module.builtinModules.includes('node:sqlite') && 'node:sqlite is unavailable',
}, () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE event (event_id INTEGER, ev_date TEXT, ev_comment TEXT, ev_venue INTEGER);
      CREATE TABLE lookup (lookup_id INTEGER, lk_name TEXT, lk_group TEXT);
      CREATE TABLE repair (
        repair_id INTEGER, rp_uid INTEGER, rp_event INTEGER, rp_item TEXT, rp_problem TEXT,
        rp_section INTEGER, rp_source INTEGER, rp_repairer INTEGER, rp_tryfix INTEGER,
        rp_fixed INTEGER, rp_comments TEXT
      );
      INSERT INTO event VALUES (1, '2025-01-01', '', 0), (2, '2026-01-01', '', 0);
      INSERT INTO repair VALUES
        (1, 90, 1, 'older event', '', 0, 0, 0, 0, 0, ''),
        (2, 10, 2, 'newer event', '', 0, 0, 0, 0, 0, ''),
        (3, 90, 2, 'same UID', '', 0, 0, 0, 0, 0, ''),
        (4, 2, 2, 'low UID', '', 0, 0, 0, 0, 0, '');
    `);
    const rows = db.prepare(repairQueries[0].sql).all(...repairQueries[0].params);
    assert.deepEqual(rows.map((row) => [row.rp_uid, row.repair_id]), [[90, 3], [90, 1], [10, 2]]);
  } finally {
    db.close();
  }
});

test('only administrators can add events', async () => {
  assert.equal((await send(validEvent)).status, 401);
  assert.equal((await send(validEvent, false)).status, 403);
  assert.equal(inserts.length, 0);
});

test('rejects invalid dates, venues and comments', async () => {
  for (const body of [
    { ...validEvent, ev_date: '2026-02-29' },
    { ...validEvent, ev_date: 'invalid' },
    { ...validEvent, ev_venue: '7' },
    { ...validEvent, ev_venue: 8 },
    { ...validEvent, ev_comment: 'x'.repeat(256) },
  ]) {
    assert.equal((await send(body, true)).status, 400);
  }
  assert.equal(inserts.length, 0);
});

test('creates an event with an existing venue and returns it', async () => {
  const response = await send(validEvent, true);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    event_id: 42,
    ev_date: '2026-02-28',
    ev_venue: 7,
    ev_comment: 'Monthly event',
    venue_name: 'Town Hall',
  });
  assert.deepEqual(inserts, [['2026-02-28', 7, 'Monthly event']]);
});

test('allows an optional comment and a leap-day date', async () => {
  const response = await send({ ev_date: '2028-02-29', ev_venue: 7 }, true);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).ev_comment, '');
  assert.deepEqual(inserts[1], ['2028-02-29', 7, '']);
});
