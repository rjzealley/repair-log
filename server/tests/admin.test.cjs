const assert = require('node:assert/strict');
const Module = require('node:module');
const { after, test } = require('node:test');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

if (!Module.builtinModules.includes('node:sqlite')) {
  test('administrator API tests', { skip: 'node:sqlite is unavailable' }, () => {});
} else {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE logusers (loguser_id INTEGER PRIMARY KEY, lu_name TEXT, lu_email TEXT UNIQUE, lu_admin INTEGER, lu_password TEXT);
    CREATE TABLE password_reset_tokens (user_id INTEGER, token_hash TEXT);
    CREATE TABLE lookup (lookup_id INTEGER PRIMARY KEY, lk_group TEXT, lk_name TEXT, lk_seq INTEGER, lk_header INTEGER);
    CREATE TABLE event (event_id INTEGER PRIMARY KEY, ev_date TEXT, ev_venue INTEGER, ev_comment TEXT);
    CREATE TABLE repair (
      repair_id INTEGER PRIMARY KEY, rp_uid INTEGER, rp_event INTEGER, rp_item TEXT, rp_problem TEXT,
      rp_section INTEGER, rp_source INTEGER, rp_repairer INTEGER, rp_tryfix INTEGER, rp_fixed INTEGER, rp_comments TEXT
    );
    INSERT INTO logusers VALUES
      (1, 'Admin', 'admin@example.com', 1, 'secret-hash'),
      (2, 'User', 'user@example.com', 0, 'secret-hash'),
      (3, 'Other Admin', 'other@example.com', 1, 'secret-hash');
    INSERT INTO password_reset_tokens VALUES (2, 'reset-hash');
    INSERT INTO lookup VALUES
      (1, 'venue', 'Hall', 1, 0), (2, 'section', 'Electrical', 1, 0),
      (3, 'source', 'Visitor', 1, 0), (4, 'repairer', 'Volunteer', 1, 0),
      (5, 'section', 'Unused', 2, 0), (6, 'section', 'Heading', 3, 1);
    INSERT INTO event VALUES (1, '2026-01-01', 1, 'Initial');
    INSERT INTO repair VALUES (1, 10, 1, 'Lamp', 'Broken', 2, 3, 4, 1, 1, '');
  `);

  const query = async (sql, params = []) => {
    if (sql.includes('CREATE TABLE IF NOT EXISTS password_reset_tokens')) return [[], []];
    return [db.prepare(sql).all(...params)];
  };
  const execute = async (sql, params = []) => {
    try {
      const result = db.prepare(sql.replaceAll('BINARY ', '')).run(...params);
      return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }];
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE constraint failed')) error.code = 'ER_DUP_ENTRY';
      throw error;
    }
  };
  const pool = {
    query,
    execute,
    async getConnection() {
      return {
        execute,
        async beginTransaction() { db.exec('BEGIN'); },
        async rollback() { db.exec('ROLLBACK'); },
        async commit() { db.exec('COMMIT'); },
        release() {},
      };
    },
  };
  const secret = 'admin-test-secret';
  Object.assign(process.env, { JWT_SECRET: secret, DB_HOST: 'test', DB_USER: 'test', DB_PASSWORD: 'test', DB_NAME: 'test' });
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
  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  });

  const send = async (path, { userId, token, claimedAdmin = true, method = 'GET', body } = {}) => {
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (userId) headers.Authorization = `Bearer ${jwt.sign({ userId, email: 'test@example.com', isAdmin: claimedAdmin }, secret)}`;
    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

  test('admin endpoints require a current administrator, not just a JWT claim', async () => {
    for (const [path, method] of [
      ['/api/admin/users', 'GET'], ['/api/admin/users/2', 'PUT'], ['/api/admin/users/2', 'DELETE'],
      ['/api/admin/users', 'POST'], ['/api/admin/lookups', 'POST'],
      ['/api/admin/events/1', 'PUT'], ['/api/admin/events/1', 'DELETE'],
      ['/api/admin/lookups', 'GET'], ['/api/admin/lookup-groups', 'GET'],
      ['/api/admin/lookups/5', 'PUT'], ['/api/admin/lookups/5', 'DELETE'],
      ['/api/repairs/1', 'PUT'], ['/api/repairs/1', 'DELETE'], ['/api/import/repairs-csv', 'POST'],
    ]) {
      assert.equal((await send(path, { method })).status, 401);
      assert.equal((await send(path, { userId: 2, method })).status, 403);
    }
    assert.equal((await send('/api/admin/users', { userId: 999 })).status, 401);
  });

  test('signed-in users can add events and repairs, but anonymous, expired and deleted accounts cannot', async () => {
    const event = { ev_date: '2027-01-14', ev_venue: 1, ev_comment: 'New event' };
    const repair = { rp_event: 1, rp_item: 'Radio', rp_problem: 'Broken', rp_section: 2, rp_source: 3, rp_repairer: 4, rp_tryfix: 0, rp_fixed: 0, rp_comments: '' };
    const expired = jwt.sign({ userId: 2, email: 'user@example.com', isAdmin: false }, secret, { expiresIn: -1 });
    for (const [path, body] of [['/api/events', event], ['/api/repairs', repair]]) {
      assert.equal((await send(path, { method: 'POST', body })).status, 401);
      assert.equal((await send(path, { token: expired, method: 'POST', body })).status, 401);
      assert.equal((await send(path, { userId: 999, method: 'POST', body })).status, 401);
      assert.equal((await send(path, { userId: 2, claimedAdmin: false, method: 'POST', body })).status, 201);
      assert.equal((await send(path, { userId: 1, method: 'POST', body })).status, 201);
    }
  });

  test('lists users without password hashes and lists all lookup groups and records', async () => {
    const users = await (await send('/api/admin/users', { userId: 1 })).json();
    assert.equal(users.length, 3);
    assert.ok(users.every((user) => !('lu_password' in user)));
    assert.deepEqual(await (await send('/api/admin/lookup-groups', { userId: 1 })).json(), ['repairer', 'section', 'source', 'venue']);
    const lookups = await (await send('/api/admin/lookups', { userId: 1 })).json();
    assert.equal(lookups.length, 6);
    assert.ok(lookups.some((lookup) => lookup.lk_header === 1));
    const sections = await (await send('/api/admin/lookups?group=section', { userId: 1 })).json();
    assert.equal(sections.length, 3);
  });

  test('edits users, rejects invalid or duplicate data, and prevents self-demotion', async () => {
    const body = { lu_name: 'Updated User', lu_email: 'USER2@example.com', lu_admin: false };
    assert.equal((await send('/api/admin/users/2', { userId: 1, method: 'PUT', body })).status, 200);
    assert.equal(db.prepare('SELECT lu_email FROM logusers WHERE loguser_id = 2').get().lu_email, 'user2@example.com');
    assert.equal((await send('/api/admin/users/2', { userId: 1, method: 'PUT', body: { ...body, lu_email: 'bad' } })).status, 400);
    assert.equal((await send('/api/admin/users/2', { userId: 1, method: 'PUT', body: { ...body, lu_email: 'admin@example.com' } })).status, 409);
    assert.equal((await send('/api/admin/users/1', { userId: 1, method: 'PUT', body })).status, 409);
    assert.equal((await send('/api/admin/users/1', { userId: 1, method: 'DELETE' })).status, 409);
    assert.equal((await send('/api/admin/users/12x', { userId: 1, method: 'DELETE' })).status, 400);
  });

  test('demoted and deleted administrators immediately lose protected access', async () => {
    const body = { lu_name: 'Other Admin', lu_email: 'other@example.com', lu_admin: false };
    assert.equal((await send('/api/admin/users/3', { userId: 1, method: 'PUT', body })).status, 200);
    assert.equal((await send('/api/admin/users', { userId: 3 })).status, 403);
    assert.equal((await send('/api/admin/events/1', { userId: 3, method: 'PUT', body: {} })).status, 403);
    assert.equal((await send('/api/admin/users/2', { userId: 1, method: 'DELETE' })).status, 204);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM password_reset_tokens WHERE user_id = 2').get().count, 0);
    assert.equal((await send('/api/admin/users', { userId: 2 })).status, 401);
    assert.equal((await send('/api/admin/users/2', { userId: 1, method: 'DELETE' })).status, 404);
  });

  test('protects referenced lookups while allowing name and sequence edits', async () => {
    for (const [id, group, name] of [[1, 'venue', 'Hall'], [2, 'section', 'Electrical'], [3, 'source', 'Visitor'], [4, 'repairer', 'Volunteer']]) {
      const body = { lk_group: group, lk_name: name, lk_seq: 2, lk_header: false };
      assert.equal((await send(`/api/admin/lookups/${id}`, { userId: 1, method: 'PUT', body })).status, 200);
      assert.equal((await send(`/api/admin/lookups/${id}`, { userId: 1, method: 'PUT', body: { ...body, lk_group: 'other' } })).status, 409);
      assert.equal((await send(`/api/admin/lookups/${id}`, { userId: 1, method: 'PUT', body: { ...body, lk_group: group.toUpperCase() } })).status, 409);
      assert.equal((await send(`/api/admin/lookups/${id}`, { userId: 1, method: 'PUT', body: { ...body, lk_header: true } })).status, 409);
      assert.equal((await send(`/api/admin/lookups/${id}`, { userId: 1, method: 'DELETE' })).status, 409);
    }
    const body = { lk_group: 'other', lk_name: 'Renamed', lk_seq: 3, lk_header: true };
    assert.equal((await send('/api/admin/lookups/5', { userId: 1, method: 'PUT', body })).status, 200);
    assert.equal((await send('/api/admin/lookups/5', { userId: 1, method: 'DELETE' })).status, 204);
    assert.equal((await send('/api/admin/lookups/5', { userId: 1, method: 'DELETE' })).status, 404);
    assert.equal((await send('/api/admin/lookups/6', { userId: 1, method: 'PUT', body: { ...body, lk_seq: 'invalid' } })).status, 400);
  });

  test('creates users with validated and hashed initial passwords', async () => {
    const body = { lu_name: 'New User', lu_email: 'NEW@example.com', lu_admin: false, password: 'a-secure-password' };
    for (const password of ['short', 'x'.repeat(73)]) {
      assert.equal((await send('/api/admin/users', { userId: 1, method: 'POST', body: { ...body, password } })).status, 400);
    }
    const response = await send('/api/admin/users', { userId: 1, method: 'POST', body });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.lu_email, 'new@example.com');
    assert.ok(!('lu_password' in created) && !('password' in created));
    const saved = db.prepare('SELECT lu_password FROM logusers WHERE loguser_id = ?').get(created.loguser_id);
    assert.notEqual(saved.lu_password, body.password);
    assert.equal(await bcrypt.compare(body.password, saved.lu_password), true);
    assert.equal((await send('/api/auth/login', { method: 'POST', body: { email: created.lu_email, password: body.password } })).status, 200);
    assert.equal((await send('/api/admin/users', { userId: 1, method: 'POST', body })).status, 409);
  });

  test('creates lookup records with the next id and supplied group and header', async () => {
    const body = { lk_group: 'new-group', lk_name: 'New heading', lk_seq: 4, lk_header: true };
    assert.equal((await send('/api/admin/lookups', { userId: 1, method: 'POST', body: { ...body, lk_seq: '4' } })).status, 400);
    const response = await send('/api/admin/lookups', { userId: 1, method: 'POST', body });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.lookup_id, 7);
    assert.equal(created.lk_header, 1);
    assert.ok((await (await send('/api/admin/lookup-groups', { userId: 1 })).json()).includes('new-group'));
  });

  test('creates and edits events and blocks deletion when repairs exist', async () => {
    const body = { ev_date: '2028-02-29', ev_venue: 1, ev_comment: ' New event ' };
    assert.equal((await send('/api/events', { userId: 1, method: 'POST', body: { ...body, ev_date: '2026-02-29' } })).status, 400);
    assert.equal((await send('/api/events', { userId: 1, method: 'POST', body: { ...body, ev_venue: 999 } })).status, 400);
    const response = await send('/api/events', { userId: 1, method: 'POST', body });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.ev_comment, 'New event');
    assert.equal((await send(`/api/admin/events/${created.event_id}`, { userId: 1, method: 'PUT', body: { ...body, ev_comment: 'Changed' } })).status, 200);
    assert.equal(db.prepare('SELECT ev_comment FROM event WHERE event_id = ?').get(created.event_id).ev_comment, 'Changed');
    assert.equal((await send('/api/admin/events/1', { userId: 1, method: 'DELETE' })).status, 409);
    assert.equal((await send(`/api/admin/events/${created.event_id}`, { userId: 1, method: 'DELETE' })).status, 204);
    assert.equal((await send(`/api/admin/events/${created.event_id}`, { userId: 1, method: 'DELETE' })).status, 404);
  });
}
