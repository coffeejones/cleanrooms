const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('./mobile-push.test.cjs'), 'utf8').split("test('push HTTP registration")[0];
const { fixture, install, personId, expoToken } = Function('require', '__dirname', source + '\nreturn { fixture, install, personId, expoToken };')(require, __dirname);
const minute = 60_000;

function messages(f, prefix, count) {
  return Array.from({ length: count }, (_, index) => f.message(prefix + '-' + index, personId, 'changed'));
}

function deliveries(f, events) {
  return events.map(event => f.sqlite.prepare('SELECT * FROM workspace_push_deliveries WHERE event_id=? AND installation_id=?').get(event.event_id, install));
}

async function measuredDrain(f, options = {}) {
  let statements = 0, batches = 0;
  f.db.beforeBatch = items => { statements += items.length; batches++; };
  try {
    return { result: await f.drain(options), counts: () => ({ statements, batches }) };
  } finally {
    f.db.beforeBatch = null;
  }
}

test('twenty fresh shift changes reach one provider batch in one drain', async t => {
  const f = await fixture(t);
  assert.equal((await f.register()).status, 200);
  const events = messages(f, 'twenty-current-changes', 20);
  const { result, counts } = await measuredDrain(f);
  assert.equal(result.sent, 20);
  assert.equal(f.requests.length, 1, 'ready changes must not need later drain invocations');
  const payloads = f.requests[0].body;
  assert.equal(payloads.length, 20);
  assert.deepEqual(new Set(payloads.map(payload => payload.data.eventId)), new Set(events.map(event => event.event_id)));
  for (const [index, payload] of payloads.entries()) {
    assert.equal(payload.to, expoToken);
    assert.deepEqual(payload.data, { v: 1, eventId: payload.data.eventId, installationId: install });
    const row = f.sqlite.prepare('SELECT * FROM workspace_push_deliveries WHERE event_id=? AND installation_id=?').get(payload.data.eventId, install);
    assert.equal(row.status, 'receipt');
    assert.equal(row.ticket_id, 'ticket-' + index);
    assert.equal(row.attempts, 1);
    assert.equal(row.lease_token, null);
  }
  assert.ok(counts().statements < 50, 'single-batch dispatch must remain below 50 SQL statements: ' + counts().statements);
  t.diagnostic(JSON.stringify(counts()));
});

test('fifty due receipts and fifty fresh sends complete in one drain below fifty SQL statements', async t => {
  const f = await fixture(t);
  assert.equal((await f.register()).status, 200);
  const oldEvents = messages(f, 'old-receipt-capacity', 50);
  await f.drain();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.length, 50, 'receipt seeding must also send all fifty ready changes');
  const oldRows = deliveries(f, oldEvents);
  assert.ok(oldRows.every(row => row?.status === 'receipt'));
  const oldTickets = new Set(oldRows.map(row => row.ticket_id));
  assert.equal(oldTickets.size, 50);

  const freshEvents = messages(f, 'fresh-send-capacity', 50);
  const calls = [];
  const now = Date.now() + 16 * minute;
  const { result, counts } = await measuredDrain(f, { now, requestProvider: async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.endsWith('/getReceipts')) {
      assert.deepEqual(new Set(body.ids), oldTickets);
      assert.equal(body.ids.length, 50);
      return Response.json({ data: Object.fromEntries(body.ids.map(id => [id, { status: 'ok' }])) });
    }
    assert.ok(url.endsWith('/send'));
    assert.equal(body.length, 50);
    assert.deepEqual(new Set(body.map(payload => payload.data.eventId)), new Set(freshEvents.map(event => event.event_id)));
    return Response.json({ data: body.map((_, index) => ({ status: 'ok', id: 'fresh-ticket-' + index })) });
  } });
  assert.equal(result.receipts, 50);
  assert.equal(result.sent, 50);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(call => call.url.endsWith('/getReceipts')).length, 1);
  assert.equal(calls.filter(call => call.url.endsWith('/send')).length, 1);
  for (const row of deliveries(f, oldEvents)) {
    assert.equal(row.status, 'delivered');
    assert.ok(oldTickets.has(row.ticket_id));
    assert.equal(row.lease_token, null);
  }
  const send = calls.find(call => call.url.endsWith('/send'));
  for (const [index, payload] of send.body.entries()) {
    const row = f.sqlite.prepare('SELECT * FROM workspace_push_deliveries WHERE event_id=? AND installation_id=?').get(payload.data.eventId, install);
    assert.equal(row.status, 'receipt');
    assert.equal(row.ticket_id, 'fresh-ticket-' + index);
    assert.equal(row.attempts, 1);
    assert.equal(row.lease_token, null);
  }
  assert.ok(counts().statements < 50, 'receipt and send outcomes must use bounded bulk statements: ' + counts().statements);
  t.diagnostic(JSON.stringify(counts()));
});

test('mixed positional tickets update the correct deliveries and preserve a replaced lease', async t => {
  const f = await fixture(t);
  assert.equal((await f.register()).status, 200);
  const events = messages(f, 'mixed-ticket-outcomes', 9);
  const expected = new Map();
  let calls = 0;
  const now = Date.now() + 200;
  const { counts } = await measuredDrain(f, { now, requestProvider: async (url, options) => {
    calls++;
    assert.ok(url.endsWith('/send'));
    const payloads = JSON.parse(options.body);
    assert.equal(payloads.length, 9);
    const tickets = payloads.map((payload, index) => {
      const outcome = index % 3 === 0 ? { status: 'receipt', ticket: 'mixed-ticket-' + index, error: null }
        : index % 3 === 1 ? { status: 'pending', ticket: null, error: 'MessageRateExceeded' }
          : { status: 'failed', ticket: null, error: 'MessageTooBig' };
      expected.set(payload.data.eventId, outcome);
      return outcome.status === 'receipt' ? { status: 'ok', id: outcome.ticket }
        : { status: 'error', details: { error: outcome.error } };
    });
    const replaced = payloads[0].data.eventId;
    f.sqlite.prepare("UPDATE workspace_push_deliveries SET status='cancelled',lease_token='replacement-owner',last_error='replacement-state' WHERE event_id=? AND installation_id=?").run(replaced, install);
    expected.set(replaced, { status: 'cancelled', ticket: null, error: 'replacement-state', lease: 'replacement-owner' });
    return Response.json({ data: tickets });
  } });
  assert.equal(calls, 1);
  for (const row of deliveries(f, events)) {
    const outcome = expected.get(row.event_id);
    assert.ok(outcome);
    assert.equal(row.status, outcome.status);
    assert.equal(row.ticket_id, outcome.ticket);
    assert.equal(row.last_error, outcome.error);
    assert.equal(row.lease_token, outcome.lease ?? null);
    assert.equal(row.attempts, 1);
    if (row.status === 'pending') assert.ok(row.due_at > now);
  }
  assert.equal(f.sqlite.prepare('SELECT active FROM workspace_push_devices WHERE installation_id=?').get(install).active, 1);
  assert.ok(counts().statements < 50);
});

test('mixed keyed receipts preserve each ticket mapping, back off retries and honor replaced leases', async t => {
  const f = await fixture(t);
  assert.equal((await f.register()).status, 200);
  const events = messages(f, 'mixed-receipt-outcomes', 8);
  await f.drain();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.length, 8);
  const originalRows = deliveries(f, events);
  const byTicket = new Map(originalRows.map(row => [row.ticket_id, row]));
  const expected = new Map();
  let calls = 0;
  const now = Date.now() + 16 * minute;
  const { result, counts } = await measuredDrain(f, { now, requestProvider: async (url, options) => {
    calls++;
    assert.ok(url.endsWith('/getReceipts'), 'rate-limited receipts must not resend within the same drain');
    const { ids } = JSON.parse(options.body);
    assert.equal(ids.length, 8);
    assert.deepEqual(new Set(ids), new Set(byTicket.keys()));
    const data = {};
    for (const [index, id] of ids.entries()) {
      const row = byTicket.get(id);
      const outcome = index % 4 === 0 ? { status: 'delivered', error: null }
        : index % 4 === 1 ? { status: 'pending', error: 'MessageRateExceeded' }
          : index % 4 === 2 ? { status: 'failed', error: 'MessageTooBig' }
            : { status: 'receipt', error: 'receipt_pending' };
      expected.set(row.event_id, outcome);
      if (index % 4 === 0) data[id] = { status: 'ok' };
      else if (index % 4 !== 3) data[id] = { status: 'error', details: { error: outcome.error } };
    }
    const replaced = byTicket.get(ids[0]);
    f.sqlite.prepare("UPDATE workspace_push_deliveries SET status='cancelled',lease_token='replacement-owner',last_error='replacement-state' WHERE event_id=? AND installation_id=?").run(replaced.event_id, install);
    expected.set(replaced.event_id, { status: 'cancelled', error: 'replacement-state', lease: 'replacement-owner' });
    return Response.json({ data });
  } });
  assert.equal(calls, 1);
  assert.equal(result.receipts, 8);
  assert.equal(result.sent, 0);
  for (const row of deliveries(f, events)) {
    const outcome = expected.get(row.event_id);
    assert.ok(outcome);
    assert.equal(row.status, outcome.status);
    assert.equal(row.last_error, outcome.error);
    assert.equal(row.ticket_id, originalRows.find(original => original.event_id === row.event_id).ticket_id);
    assert.equal(row.lease_token, outcome.lease ?? null);
    assert.equal(row.attempts, 1);
    if (row.status === 'pending' || row.status === 'receipt') assert.ok(row.due_at > now);
  }
  assert.equal(f.sqlite.prepare('SELECT active FROM workspace_push_devices WHERE installation_id=?').get(install).active, 1);
  assert.ok(counts().statements < 50);
});
