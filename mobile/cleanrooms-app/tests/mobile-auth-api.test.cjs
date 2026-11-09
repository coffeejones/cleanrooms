const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const build = process.env.CLEANROOMS_TEST_BUILD;
if (!build) throw new Error('Run node tests/run.mjs to compile and test the actual domain modules.');
const model = require(path.join(build, 'domain/model.js'));
const filename = require.resolve('../src/auth/mobile-auth-api.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: filename,
}).outputText;
const origin = 'https://mobile-api.example.test';
const token = 'test-session-token-that-never-leaves-this-process';
const plain = value => JSON.parse(JSON.stringify(value));

function publishedShift(overrides = {}) {
  return {
    id: 'shift-own', personId: 'employee-own', date: '2026-11-08', start: '08:00', end: '16:00',
    breakMinutes: 30, site: { id: 'site-ringsted', name: 'CK Ringsted', address: 'Køgevej 50, 4100 Ringsted' },
    description: 'Start i fællesarealet.', checklist: [{ id: 'task-own', text: 'Fyld sæbe op' }],
    clockInRadius: 100, entry: null,
    ...overrides,
  };
}

function client(respond) {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    __DEV__: false,
    process: { env: { EXPO_OS: 'ios', EXPO_PUBLIC_CLEANROOMS_AUTH_URL: origin } },
    AbortController, setTimeout, clearTimeout,
    require(name) {
      if (name === '@/domain/model') return model;
      if (name === '@/state/attendance-runtime') return require(path.join(build, 'state/attendance-runtime.js'));
      if (name === '@/state/retry-policy') return require(path.join(build, 'state/retry-policy.js'));
      if (name === 'expo/fetch') return { fetch: async (url, options) => {
        calls.push({ url, options });
        return respond(url, options);
      } };
      throw new Error(`Unexpected dependency in the native API client: ${name}`);
    },
  }, { filename });
  return { ...module.exports, calls };
}

test('published shift data uses an authenticated native API request without cookies or redirects', async () => {
  const app = client(() => Response.json({ shift: publishedShift() }));
  const detail = await app.mobileAuthApi.publishedShift(token, 'shift-own');
  assert.equal(app.calls.length, 1);
  const [{ url, options }] = app.calls;
  assert.equal(url, origin + '/api/mobile-auth');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, `Bearer ${token}`);
  assert.equal(options.headers.Accept, 'application/json');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(options.body), { action: 'publishedShift', shiftId: 'shift-own' });
  assert.equal(detail.shift.personId, 'employee-own');
  assert.equal(detail.shift.siteId, 'site-ringsted');
  assert.equal(detail.site.name, 'CK Ringsted');
  assert.deepEqual(plain(detail.shift.checklist), [{ id: 'task-own', text: 'Fyld sæbe op' }]);
});

test('published shift parsers preserve only valid, different previous times in details and calendar pages', async () => {
  for (const previousTime of [{ start: '07:00', end: '15:00' }, { start: '23:00', end: '07:00' }]) {
    const app = client((_url, { body }) => JSON.parse(body).action === 'publishedShift'
      ? Response.json({ shift: publishedShift({ previousTime }) })
      : Response.json({ shifts: [publishedShift({ previousTime })], nextCursor: null }));
    assert.deepEqual(plain((await app.mobileAuthApi.publishedShift(token, 'shift-own')).shift.previousTime), previousTime);
    assert.deepEqual(plain((await app.mobileAuthApi.publishedSchedule(token, '2026-11-01', '2026-11-30', null)).shifts[0].shift.previousTime), previousTime);
  }
  for (const previousTime of [null, '07:00–15:00', {}, { start: '25:00', end: '15:00' }, { start: '07:00', end: '07:00' }, { start: '08:00', end: '16:00' }]) {
    const app = client(() => Response.json({ shift: publishedShift({ previousTime }) }));
    assert.equal((await app.mobileAuthApi.publishedShift(token, 'shift-own')).shift.previousTime, undefined);
  }
});

function timeChange(overrides = {}) {
  return {
    id: 'message-own', kind: 'changed', personId: 'employee-own', createdAt: '2026-11-07T12:00:00Z',
    before: { id: 'shift-own', person: 'employee-own', date: '2026-11-08', start: '07:00', end: '15:00' },
    after: { id: 'shift-own', person: 'employee-own', date: '2026-11-08', start: '08:00', end: '16:00' },
    ...overrides,
  };
}
const targetShift = () => ({ id: 'shift-own', personId: 'employee-own', date: '2026-11-08', start: '08:00', end: '16:00' });

test('shift time history uses the authenticated date-scoped workflow and chooses the latest matching change across unread and read pages', async () => {
  const older = timeChange({ id: 'unread-older', createdAt: '2026-11-06T12:00:00Z' });
  const latest = timeChange({ id: 'read-newer', createdAt: '2026-11-07T13:00:00Z', kind: 'moved',
    before: { id: 'shift-own', person: 'employee-own', date: '2026-11-07', start: '09:00', end: '17:00' } });
  const app = client((_url, { body }) => JSON.parse(body).messageCursor
    ? Response.json({ notifications: [latest], pagination: { messages: null } })
    : Response.json({ notifications: [older], pagination: { messages: 'next-message-page' } }));
  assert.deepEqual(plain(await app.mobileAuthApi.shiftTimeChange(token, targetShift())), { start: '09:00', end: '17:00' });
  assert.deepEqual(app.calls.map(call => JSON.parse(call.options.body)), [
    { action: 'workflowRead', from: '2026-11-08', to: '2026-11-08', limit: 50 },
    { action: 'workflowRead', from: '2026-11-08', to: '2026-11-08', limit: 50, messageCursor: 'next-message-page' },
  ]);
  assert.ok(app.calls.every(call => call.options.headers.Authorization === `Bearer ${token}` && call.options.credentials === 'omit'));
});

test('shift time history ignores other assignments, employees, stale after times and malformed changes', async () => {
  const change = timeChange(), after = change.after, before = change.before;
  const invalid = [
    null, { ...change, kind: 'new' }, { ...change, kind: 'request' }, { ...change, createdAt: 'not-a-date' },
    { ...change, after: { ...after, id: 'another-shift' } }, { ...change, before: { ...before, id: 'another-shift' } },
    { ...change, after: { ...after, date: '2026-11-09' } }, { ...change, after: { ...after, end: '17:00' } },
    { ...change, personId: 'employee-other', before: { ...before, person: 'employee-other' }, after: { ...after, person: 'employee-other' } },
    { ...change, before: { ...before, person: 'employee-other' } }, { ...change, after: { ...after, person: 'employee-other' } },
    { ...change, before: { ...before, date: '2026-02-30' } }, { ...change, before: { ...before, start: '25:00' } },
    { ...change, before: { ...before, end: '07:00' } }, { ...change, before: { ...before, start: after.start, end: after.end } },
  ];
  const app = client(() => Response.json({ notifications: invalid, pagination: { messages: null } }));
  assert.equal(await app.mobileAuthApi.shiftTimeChange(token, targetShift()), null);
  assert.equal(app.calls.length, 1);
  const overnight = client(() => Response.json({ notifications: [timeChange({ before: { ...before, start: '23:00', end: '07:00' } })], pagination: { messages: null } }));
  assert.deepEqual(plain(await overnight.mobileAuthApi.shiftTimeChange(token, targetShift())), { start: '23:00', end: '07:00' });
});

test('shift history validates its page envelope and never reports a partial or looping history as complete', async () => {
  for (const payload of [{}, { notifications: [], pagination: {} }, { notifications: [], pagination: { messages: 42 } },
    { notifications: Array.from({ length: 51 }, () => timeChange()), pagination: { messages: null } }]) {
    const app = client(() => Response.json(payload));
    await assert.rejects(app.mobileAuthApi.shiftTimeChange(token, targetShift()), error => error.code === 'mobile_shift_change_invalid');
    assert.equal(app.calls.length, 1);
  }
  const looping = client(() => Response.json({ notifications: [timeChange()], pagination: { messages: 'repeated-cursor' } }));
  await assert.rejects(looping.mobileAuthApi.shiftTimeChange(token, targetShift()), error => error.code === 'mobile_shift_change_invalid');
  assert.equal(looping.calls.length, 2);
  let pages = 0;
  const incomplete = client(() => Response.json({ notifications: [timeChange()], pagination: { messages: 'page-' + ++pages } }));
  await assert.rejects(incomplete.mobileAuthApi.shiftTimeChange(token, targetShift()), error => error.code === 'mobile_shift_change_incomplete');
  assert.equal(incomplete.calls.length, 10);
});

test('invalid or unassigned shift history targets never issue a workflow request and session errors propagate', async () => {
  const app = client(() => { throw Error('No request expected'); });
  assert.equal(await app.mobileAuthApi.shiftTimeChange(token, { ...targetShift(), personId: null }), null);
  for (const shift of [{ ...targetShift(), id: '' }, { ...targetShift(), date: '2026-02-30' }, { ...targetShift(), start: 'oops' }]) {
    await assert.rejects(app.mobileAuthApi.shiftTimeChange(token, shift), error => error.code === 'mobile_shift_change_invalid');
  }
  assert.equal(app.calls.length, 0);
  const expired = client(() => Response.json({ error: 'mobile_session_invalid', message: 'Log ind igen.' }, { status: 401 }));
  await assert.rejects(expired.mobileAuthApi.shiftTimeChange(token, targetShift()), error => error.code === 'mobile_session_invalid');
  assert.equal(expired.calls.length, 1);
});

test('re-reading a shift receives the current radius and GPS-off requires an explicit null', async () => {
  const radii = [100, 250, null];
  const app = client(() => Response.json({ shift: publishedShift({ clockInRadius: radii.shift() }) }));
  for (const expected of [100, 250, null]) {
    const detail = await app.mobileAuthApi.publishedShift(token, 'shift-own');
    assert.equal(detail.clockInRadius, expected);
    assert.equal(detail.entry, null);
  }
  assert.equal(app.calls.length, 3, 'each re-read asks the API rather than reusing a cached GPS rule');
});

test('a missing or malformed GPS radius fails closed instead of becoming GPS-off', async () => {
  for (const radius of [undefined, 0, -1, 1.5, '100', false, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const fixture = publishedShift({ clockInRadius: radius });
    const app = client(() => Response.json({ shift: fixture }));
    await assert.rejects(app.mobileAuthApi.publishedShift(token, 'shift-own'), error => {
      assert.ok(error instanceof app.MobileAuthError);
      assert.equal(error.code, 'mobile_response_invalid');
      assert.equal(error.status, 503);
      return true;
    }, `invalid radius: ${String(radius)}`);
    assert.equal(app.calls.length, 1);
  }
});

test('only an explicit missing published shift becomes null', async () => {
  const missing = client(() => Response.json({ shift: null }));
  assert.equal(await missing.mobileAuthApi.publishedShift(token, 'removed-shift'), null);
  const malformed = client(() => Response.json({}));
  await assert.rejects(malformed.mobileAuthApi.publishedShift(token, 'shift-own'), error =>
    error instanceof malformed.MobileAuthError && error.code === 'mobile_schedule_invalid');
});

test('redirects, HTML, malformed JSON and connection failures stay in the API error flow', async () => {
  const cases = [
    [() => new Response('', { status: 302, headers: { location: 'https://external.example.test/login' } }), 'mobile_unavailable'],
    [() => new Response('<html>Log in elsewhere</html>', { headers: { 'content-type': 'text/html' } }), 'mobile_response_invalid'],
    [() => new Response('{', { headers: { 'content-type': 'application/json' } }), 'mobile_response_invalid'],
    [() => { throw new Error('Network unavailable'); }, 'mobile_connection_failed'],
  ];
  for (const [respond, expectedCode] of cases) {
    const app = client(respond);
    await assert.rejects(app.mobileAuthApi.publishedShift(token, 'shift-own'), error =>
      error instanceof app.MobileAuthError && error.code === expectedCode);
    assert.equal(app.calls.length, 1, 'a failed request never opens or follows a fallback URL');
    assert.equal(app.calls[0].options.redirect, 'error');
  }
});

test('native clock-in sends the GPS fix to the API and receives the server-owned clock receipt', async () => {
  const receipt = { version: 1, status: 'running', clockIn: '2026-11-08T07:00:00Z', clockOut: null, pauseAt: null };
  const app = client(() => Response.json({ entry: receipt }));
  const location = { latitude: 55.61, longitude: 12.1, accuracyMeters: 5, timestamp: 1794121200000 };
  const command = { shiftId: 'shift-own', operation: 'start', version: 0, comment: null, location };
  assert.deepEqual(plain(await app.mobileAuthApi.shiftTime(token, command)), receipt);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(app.calls[0].options.body), { action: 'shiftTime', ...command });
});

test('clock-in without a fix keeps the server GPS requirement authoritative without a browser fallback', async () => {
  const command = { shiftId: 'shift-own', operation: 'start', version: 0, comment: null, location: null };
  const app = client(() => Response.json({ error: 'time_location_required', message: 'Del din aktuelle placering.' }, { status: 400 }));
  await assert.rejects(app.mobileAuthApi.shiftTime(token, command), error => {
    assert.ok(error instanceof app.MobileAuthError);
    assert.equal(error.code, 'time_location_required');
    assert.equal(error.message, 'Del din aktuelle placering.');
    return true;
  });
  assert.deepEqual(JSON.parse(app.calls[0].options.body), { action: 'shiftTime', ...command });
  assert.equal(app.calls.length, 1);
});

test('active attendance is restored without any calendar interval and accepts an overnight assignment', async () => {
  const receipt={version:4,status:'running',clockIn:'2026-10-31T22:00:00Z',clockOut:null,pauseAt:null,workedSeconds:3600,measuredAt:100};
  const app=client(()=>Response.json({shift:publishedShift({date:'2026-10-31',start:'23:00',end:'07:00',entry:receipt})}));
  const active=await app.mobileAuthApi.activeTime(token);
  assert.deepEqual(JSON.parse(app.calls[0].options.body),{action:'employeeActiveTime'});
  assert.equal(active.shift.date,'2026-10-31');assert.equal(active.entry.workedSeconds,3600);
  assert.equal(typeof active.entry.receivedAtMonotonic,'number');
  const empty=client(()=>Response.json({shift:null}));
  assert.equal(await empty.mobileAuthApi.activeTime(token),null);
  const invalid=client(()=>Response.json({shift:publishedShift({entry:{...receipt,status:'submitted'}})}));
  await assert.rejects(invalid.mobileAuthApi.activeTime(token),error=>error.code==='mobile_response_invalid');
});

test('an unknown stamping result reconciles the exact transition before reporting failure or permitting another write', async () => {
  const receipt={version:2,status:'submitted',clockIn:'2026-11-08T07:00:00Z',clockOut:'2026-11-08T15:00:00Z',pauseAt:null,comment:'Færdig'};
  const app=client((_url,{body})=>{
    if(JSON.parse(body).action==='shiftTime')throw new Error('Response lost after server commit');
    return Response.json({shift:publishedShift({entry:receipt})});
  });
  const result=await app.mobileAuthApi.shiftTime(token,{shiftId:'shift-own',operation:'finish',version:1,location:null,comment:'Færdig'});
  assert.equal(result.version,2);assert.equal(result.status,'submitted');
  assert.deepEqual(app.calls.map(call=>JSON.parse(call.options.body).action),['shiftTime','publishedShift']);
  assert.equal(app.calls.filter(call=>JSON.parse(call.options.body).action==='shiftTime').length,1);
  const otherComment=client((_url,{body})=>JSON.parse(body).action==='shiftTime'
    ? new Response('',{status:503}) : Response.json({shift:publishedShift({entry:{...receipt,comment:'En anden kommentar'}})}));
  await assert.rejects(otherComment.mobileAuthApi.shiftTime(token,{shiftId:'shift-own',operation:'finish',version:1,location:null,comment:'Færdig'}),error=>error.code==='mobile_time_unconfirmed');
  const unknown=client((_url,{body})=>JSON.parse(body).action==='shiftTime'
    ? new Response('',{status:503}) : Response.json({shift:null}));
  await assert.rejects(unknown.mobileAuthApi.shiftTime(token,{shiftId:'shift-own',operation:'finish',version:1,location:null,comment:null}),error=>error.code==='mobile_time_unconfirmed');
  assert.equal(unknown.calls.length,2);
});

test('reconciliation preserves a concrete conflict and propagates an expired session', async()=>{
  const conflict=client((_url,{body})=>JSON.parse(body).action==='shiftTime'
    ? Response.json({error:'time_overlap',message:'Du har allerede en aktiv vagt.'},{status:409}) : Response.json({shift:null}));
  const command={shiftId:'shift-own',operation:'start',version:0,location:null,comment:null};
  await assert.rejects(conflict.mobileAuthApi.shiftTime(token,command),error=>error.code==='time_overlap');
  const expired=client((_url,{body})=>JSON.parse(body).action==='shiftTime'
    ? new Response('',{status:503}) : Response.json({error:'mobile_session_invalid',message:'Log ind igen.'},{status:401}));
  await assert.rejects(expired.mobileAuthApi.shiftTime(token,command),error=>error.code==='mobile_session_invalid');
});

test('a lost resubmission receipt reconciles the exact appended explanation without leaking local previous-comment context', async () => {
  const receipt={version:5,status:'submitted',clockIn:'2026-11-08T07:00:00Z',clockOut:'2026-11-08T15:00:00Z',pauseAt:null,comment:'Den tidligere forklaring\n\nDen supplerende forklaring'};
  const app=client((_url,{body})=>JSON.parse(body).action==='shiftTime'
    ? new Response('',{status:503}) : Response.json({shift:publishedShift({entry:receipt})}));
  const result=await app.mobileAuthApi.shiftTime(token,{shiftId:'shift-own',operation:'submit',version:4,location:null,comment:'  Den supplerende forklaring  ',previousComment:' Den tidligere forklaring '});
  assert.equal(result.comment,receipt.comment);
  const sent=JSON.parse(app.calls[0].options.body);assert.equal(Object.hasOwn(sent,'previousComment'),false);assert.equal(sent.comment,'  Den supplerende forklaring  ');
  assert.equal(app.calls.filter(call=>JSON.parse(call.options.body).action==='shiftTime').length,1);
  const different=client((_url,{body})=>JSON.parse(body).action==='shiftTime'
    ? new Response('',{status:503}) : Response.json({shift:publishedShift({entry:{...receipt,comment:'En anden tidligere forklaring\n\nDen supplerende forklaring'}})}));
  await assert.rejects(different.mobileAuthApi.shiftTime(token,{shiftId:'shift-own',operation:'submit',version:4,location:null,comment:'Den supplerende forklaring',previousComment:'Den tidligere forklaring'}),error=>error.code==='mobile_time_unconfirmed');
});

test('returned time keeps its reason/comment and resubmission carries no editable clock fields', async()=>{
  const returned={version:4,status:'rejected',clockIn:'2026-11-08T07:22:00Z',clockOut:'2026-11-08T15:00:00Z',pauseAt:null,comment:'Jeg mødte kl. 8.',rejectionReason:'Beskriv venligst afvigelsen.'};
  const app=client((_url,{body})=>JSON.parse(body).action==='publishedShift'
    ? Response.json({shift:publishedShift({entry:returned})}) : Response.json({entry:{...returned,version:5,status:'submitted',comment:'Jeg glemte at stemple ind.'}}));
  const detail=await app.mobileAuthApi.publishedShift(token,'shift-own');
  assert.equal(detail.entry.rejectionReason,returned.rejectionReason);assert.equal(detail.entry.comment,returned.comment);
  const result=await app.mobileAuthApi.shiftTime(token,{shiftId:'shift-own',operation:'submit',version:4,location:null,comment:'Jeg glemte at stemple ind.'});
  assert.equal(result.clockIn,returned.clockIn);assert.equal(result.clockOut,returned.clockOut);assert.equal(result.status,'submitted');
  assert.deepEqual(JSON.parse(app.calls[1].options.body),{action:'shiftTime',shiftId:'shift-own',operation:'submit',version:4,location:null,comment:'Jeg glemte at stemple ind.'});
});

test('HTTP throttling exposes a bounded retry delay without retrying the request',async()=>{
  const app=client(()=>Response.json({error:'mobile_auth_rate_limited',message:'Vent lidt.'},{status:429,headers:{'retry-after':'42'}}));
  await assert.rejects(app.mobileAuthApi.employeeRequest(token,{action:'chatList',cursor:null,limit:50}),error=>error.status===429&&error.retryAfterMs===42_000);
  assert.equal(app.calls.length,1);
});
