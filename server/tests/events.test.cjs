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
const pool = {
  async query(sql, params) {
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
    headers.Authorization = `Bearer ${jwt.sign({ userId: 1, email: 'user@example.com', isAdmin }, secret)}`;
  }
  return fetch(`http://127.0.0.1:${server.address().port}/api/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
};

const validEvent = { ev_date: '2026-02-28', ev_venue: 7, ev_comment: '  Monthly event  ' };

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
