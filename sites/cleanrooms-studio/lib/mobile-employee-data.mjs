/* Employee-owned attendance and pay. Never return payroll policy or another person's rows. */
import { StudioError } from './studio-store.mjs';
import { readPublishedTimeShifts } from './publication-time-store.mjs';
import { readTimeEntries } from './time-entry-store.mjs';
import Time from '../src/timekeeping-model.js';
import Payroll from '../src/payroll-model.js';
import Groups from '../src/payroll-groups-model.js';

const MINUTE = 60_000;
const maximumRows = 5000;
const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
const rows = async (db, sql, ...values) => (await db.batch([query(db, sql, ...values)]))[0]?.results ?? [];
const first = async (...args) => (await rows(...args))[0] ?? null;
const fail = (status, code, message) => { throw new StudioError(status, code, message); };
const sum = values => {
  const total = values.reduce((value, next) => value + BigInt(next), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail(422, 'mobile_pay_overflow', 'Beløbet er for stort til at kunne vises sikkert.');
  return Number(total);
};
const roundFraction = (numerator, denominator) => Number((numerator + denominator / 2n) / denominator);

async function frame(db, { workspaceId, personId }) {
  const result = await db.batch([
    query(db, "SELECT version FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND id=? AND deleted=0 AND active=1", workspaceId, personId),
    query(db, 'SELECT version,write_token FROM workspace_directory_state WHERE workspace_id=?', workspaceId),
    query(db, 'SELECT plan.revision,plan.write_token FROM studio_states plan JOIN workspaces workspace ON workspace.snapshot_owner_id=plan.owner_id WHERE workspace.id=?', workspaceId),
    query(db, 'SELECT version,write_token FROM workspace_timekeeping WHERE workspace_id=?', workspaceId),
    query(db, 'SELECT version FROM workspace_payroll_policies WHERE workspace_id=?', workspaceId),
    query(db, 'SELECT version FROM workspace_payroll WHERE workspace_id=? AND person_id=?', workspaceId, personId),
  ]);
  if (!result[0]?.results?.length) fail(403, 'mobile_employee_inactive', 'Din medarbejderkonto er ikke længere aktiv.');
  return JSON.stringify(result.map(item => item.results?.[0] ?? null));
}

function compactEntry(entry) {
  const fields = ['id', 'shiftId', 'personId', 'date', 'site', 'start', 'end', 'endDate', 'plannedStart', 'plannedEnd',
    'plannedBreakMinutes', 'breakMinutes', 'breaks', 'breakAllocation', 'status', 'version', 'clockStartAt', 'clockEndAt',
    'pauseAt', 'timingResolved', 'resolvedStartAt', 'resolvedEndAt', 'dstUnresolved', 'payroll', 'frozenShift'];
  return Object.fromEntries(fields.filter(key => Object.hasOwn(entry, key)).map(key => [key, entry[key]]));
}

function plannedEntry(shift) {
  return {
    date: shift.date, start: shift.start, end: shift.end,
    endDate: shift.endDate || (shift.end <= shift.start ? Time.addDays(shift.date, 1) : shift.date),
    plannedStart: shift.start, plannedEnd: shift.end, plannedBreakMinutes: shift.plannedBreakMinutes ?? 0,
    breakMinutes: shift.plannedBreakMinutes ?? 0, breaks: [], breakAllocation: 'end-of-shift',
  };
}

function clipEntry(entry, bounds) {
  const span = Time.span(entry), absolute = Time.absoluteInterval(entry);
  if (!span || !absolute) return null;
  const start = Math.max(absolute.start, bounds.start), end = Math.min(absolute.end, bounds.end);
  if (start >= end) return null;
  const localStart = Time.localNow(new Date(start)), localEnd = Time.localNow(new Date(end));
  const pauses = Time.breaks(entry, span).map(pause => ({
    start: Math.max(start, absolute.start + (pause.start - span.start) * MINUTE),
    end: Math.min(end, absolute.start + (pause.end - span.start) * MINUTE),
  })).filter(pause => pause.end > pause.start);
  const offset = Time.minute(localStart.time);
  const clipped = {
    ...entry, date: localStart.date, start: localStart.time, end: localEnd.time, endDate: localEnd.date,
    breakMinutes: sum(pauses.map(pause => (pause.end - pause.start) / MINUTE)),
    breaks: pauses.map(pause => ({ start: offset + (pause.start - start) / MINUTE, end: offset + (pause.end - start) / MINUTE })),
    breakAllocation: 'clocked', clockStartAt: new Date(start).toISOString(), clockEndAt: new Date(end).toISOString(),
    timingResolved: true, resolvedStartAt: new Date(start).toISOString(), resolvedEndAt: new Date(end).toISOString(),
  };
  return { entry: clipped, minutes: (end - start) / MINUTE - clipped.breakMinutes, full: start === absolute.start && end === absolute.end };
}

function payFor(entry, clipped, resolved, versions, approved) {
  let snapshot;
  if (approved && entry.payroll) {
    if (!clipped.full) return unavailable('Den godkendte registrering går over periodegrænsen. Beløbet skal afklares af planlæggeren.');
    snapshot = entry.payroll;
  } else if (Time.hasDSTAmbiguity(entry) || Time.validate(entry).length) {
    return unavailable('Registreringen skal afklares, før lønnen kan beregnes.');
  } else snapshot = Time.payroll(clipped.entry, resolved, versions);
  if (snapshot?.unavailableReason || !Number.isSafeInteger(snapshot?.baseCents) || snapshot.baseCents < 0
    || !Number.isSafeInteger(snapshot?.supplementCents) || snapshot.supplementCents < 0
    || !Number.isSafeInteger(snapshot?.totalCents) || snapshot.totalCents < 0
    || BigInt(snapshot.baseCents) + BigInt(snapshot.supplementCents) !== BigInt(snapshot.totalCents)) {
    return unavailable(snapshot?.unavailableReason || 'Lønaftalen kunne ikke bekræftes.');
  }
  return { baseCents: snapshot.baseCents, allowanceCents: snapshot.supplementCents, totalCents: snapshot.totalCents,
    sourceLabel: snapshot.sourceLabel || 'Lønaftale' };
}

function unavailable(reason) {
  return { baseCents: 0, allowanceCents: 0, totalCents: 0, sourceLabel: 'Afventer afklaring', unavailableReason: reason };
}

function monthlyPay(resolved, from, to) {
  const amounts = new Map();
  for (let day = from; day <= to; day = Time.addDays(day, 1)) {
    const month = day.slice(0, 7), monthDays = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate();
    const agreement = resolved.payroll.agreements.filter(item => item.from <= day).at(-1);
    const components = [
      ...(agreement?.type === 'monthly' ? [{ ...agreement, label: 'Fast månedsløn', kind: 'base' }] : []),
      ...resolved.payroll.supplements.filter(item => item.type === 'monthly' && item.from <= day && (!item.to || item.to >= day))
        .map(item => ({ ...item, label: item.name, kind: 'supplement' })),
    ];
    for (const component of components) {
      const key = [month, component.id, component.kind, component.amountCents].join('|');
      const previous = amounts.get(key);
      if (previous) { previous.days++; previous.to = day; }
      else amounts.set(key, { label: component.label, type: component.kind, calculation: 'monthly', from: day, to: day,
        rateCents: component.amountCents, days: 1, monthDays });
    }
  }
  return [...amounts.values()].map(line => ({ ...line,
    amountCents: roundFraction(BigInt(line.rateCents) * BigInt(line.days), BigInt(line.monthDays)),
  }));
}

/** Read only the authenticated person's attendance, published assignments and applicable pay. */
export async function readMobileHours(db, employee, { from, to }) {
  if (!Time.validDate(from) || !Time.validDate(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 366) {
    fail(400, 'mobile_hours_period_invalid', 'Vælg en periode på højst 366 dage.');
  }
  const { workspaceId, personId } = employee;
  const before = await frame(db, employee), lower = Time.addDays(from, -2);
  const counted = await first(db, `SELECT COUNT(*) AS n FROM workspace_published_shifts
    WHERE workspace_id=? AND person_id=? AND deleted=0 AND work_date>=? AND work_date<=?`, workspaceId, personId, lower, to);
  if ((counted?.n ?? 0) > maximumRows) fail(413, 'mobile_hours_period_full', 'Vælg en kortere periode for at se timerne.');
  // Keep the overnight look-behind without exceeding the publication reader's one-year bound.
  const publicationWindows = (Date.parse(to) - Date.parse(lower)) / 86_400_000 > 366
    ? [{ from: lower, to: Time.addDays(from, -1) }, { from, to }] : [{ from: lower, to }];
  const [publishedWindows, policyRow, personalRow] = await Promise.all([
    Promise.all(publicationWindows.map(window => readPublishedTimeShifts({ db, workspaceId, personId, ...window }))),
    first(db, 'SELECT version,config FROM workspace_payroll_policies WHERE workspace_id=?', workspaceId),
    first(db, 'SELECT version,config FROM workspace_payroll WHERE workspace_id=? AND person_id=?', workspaceId, personId),
  ]);
  const published = publishedWindows.flat();
  let policy, personal;
  try {
    policy = Groups.normalize(policyRow ? JSON.parse(policyRow.config) : null);
    personal = Payroll.normalize(personalRow ? JSON.parse(personalRow.config) : null);
  } catch { fail(503, 'mobile_payroll_invalid', 'Dine lønoplysninger kunne ikke læses sikkert. Prøv igen.'); }
  const resolved = Groups.resolve({ policy, personId, payroll: personal, from, to });
  const versions = { policyVersion: policyRow?.version ?? 0, personVersion: personalRow?.version ?? 0 };
  const entries = []; let cursor = null;
  do {
    const page = await readTimeEntries({ db, workspaceId, personId, from: lower, to, includeDemo: false, limit: 500, cursor });
    for (const entry of page.entries) entries.push(compactEntry(entry));
    if (entries.length > maximumRows) fail(413, 'mobile_hours_period_full', 'Vælg en kortere periode for at se timerne.');
    cursor = page.nextCursor;
  } while (cursor);
  const byShift = new Map(entries.map(entry => [entry.shiftId, entry]));
  const shifts = new Map(published.map(shift => [shift.id, shift]));
  for (const entry of entries) if (!shifts.has(entry.shiftId)) shifts.set(entry.shiftId, {
    ...(entry.frozenShift ?? {}), id: entry.shiftId, person: personId, date: entry.date, site: entry.site,
    start: entry.plannedStart || entry.start, end: entry.plannedEnd || entry.end || entry.start,
    plannedBreakMinutes: entry.plannedBreakMinutes ?? 0, recovered: true,
  });
  const indices = [...new Set([...shifts.values()].map(shift => shift.site))];
  const catalog = indices.length ? await rows(db, `SELECT site_index,catalog FROM workspace_directory_records
    WHERE workspace_id=? AND kind='site' AND deleted=0 AND site_index IN (SELECT value FROM json_each(?))`, workspaceId, JSON.stringify(indices)) : [];
  const sites = new Map(catalog.map(row => {
    let site; try { site = JSON.parse(row.catalog); } catch { fail(503, 'mobile_site_invalid', 'Arbejdsstedet kunne ikke læses.'); }
    return [row.site_index, { id: site.id, name: site.name, address: site.address ?? '' }];
  }));
  const bounds = { start: Time.instantForLocal(from, '00:00'), end: Time.instantForLocal(Time.addDays(to, 1), '00:00') };
  if (!Number.isFinite(bounds.start) || !Number.isFinite(bounds.end)) fail(400, 'mobile_hours_period_invalid', 'Vælg en gyldig periode.');
  const summary = { plannedMinutes: 0, workedMinutes: 0, approvedMinutes: 0, estimatedCents: 0, earnedCents: 0,
    approvedCents: 0, baseEarnedCents: 0, allowanceEarnedCents: 0, baseEstimatedCents: 0, allowanceEstimatedCents: 0,
    progress: 0, shiftCount: 0, completedCount: 0, missingPayCount: 0, missingEarnedPayCount: 0,
    missingEstimatedPayCount: 0, monthlyCents: 0 };
  const resultRows = [], warnings = new Set(), missingPay = new Set(), missingEarned = new Set(), missingEstimated = new Set();
  for (const shift of shifts.values()) {
    const entry = byShift.get(shift.id), planned = plannedEntry(shift), plannedClip = clipEntry(planned, bounds);
    const closed = entry && ['submitted', 'approved'].includes(entry.status) && Boolean(entry.end);
    const actualClip = closed ? clipEntry(entry, bounds) : null;
    if (!plannedClip && !actualClip) continue;
    if (!shift.recovered && plannedClip) {
      const plannedPay = payFor(planned, plannedClip, resolved, versions, false);
      summary.plannedMinutes += plannedClip.minutes; summary.shiftCount++;
      if (!plannedPay.unavailableReason) {
        summary.estimatedCents += plannedPay.totalCents; summary.baseEstimatedCents += plannedPay.baseCents;
        summary.allowanceEstimatedCents += plannedPay.allowanceCents;
      } else { missingPay.add(shift.id); missingEstimated.add(shift.id); warnings.add(plannedPay.unavailableReason); }
    }
    const chosenClip = actualClip ?? plannedClip;
    if (!chosenClip) continue;
    const pay = payFor(actualClip ? entry : planned, chosenClip, resolved, versions, Boolean(actualClip && entry.status === 'approved'));
    if (pay.unavailableReason) {
      missingPay.add(shift.id); (actualClip ? missingEarned : missingEstimated).add(shift.id); warnings.add(pay.unavailableReason);
    }
    if (actualClip) {
      summary.workedMinutes += actualClip.minutes; summary.completedCount++;
      if (entry.status === 'approved') summary.approvedMinutes += actualClip.minutes;
      if (!pay.unavailableReason) {
        summary.earnedCents += pay.totalCents; summary.baseEarnedCents += pay.baseCents; summary.allowanceEarnedCents += pay.allowanceCents;
        if (entry.status === 'approved') summary.approvedCents += pay.totalCents;
      }
    }
    const site = sites.get(shift.site) ?? { id: `site-${shift.site}`, name: 'Arbejdssted', address: '' };
    const { sourceLabel, ...amount } = pay;
    resultRows.push({
      shift: { id: shift.id, personId, date: shift.date, start: shift.start, end: shift.end,
        breakMinutes: shift.plannedBreakMinutes ?? 0, siteId: site.id, role: '', description: '', checklist: [] },
      site, entry: entry ? { version: entry.version, status: entry.status,
        clockIn: entry.clockStartAt ?? null, clockOut: entry.clockEndAt ?? null, pauseAt: entry.pauseAt ?? null } : null,
      pay: { kind: actualClip ? 'registered' : 'planned', minutes: chosenClip.minutes, ...amount }, sourceLabel,
    });
  }
  const monthlyLines = monthlyPay(resolved, from, to);
  summary.missingPayCount = missingPay.size;
  summary.missingEarnedPayCount = missingEarned.size;
  summary.missingEstimatedPayCount = missingEstimated.size;
  summary.monthlyCents = sum(monthlyLines.map(line => line.amountCents));
  summary.progress = summary.plannedMinutes ? Math.min(1, summary.workedMinutes / summary.plannedMinutes) : 0;
  for (const key of Object.keys(summary)) if (key !== 'progress' && !Number.isSafeInteger(summary[key])) {
    fail(422, 'mobile_hours_overflow', 'Periodens beløb eller timer er for store til at kunne vises sikkert.');
  }
  if (before !== await frame(db, employee)) fail(409, 'mobile_hours_changed', 'Timerne eller lønoplysningerne blev ændret. Hent perioden igen.');
  return { from, to, currency: 'DKK', summary, rows: resultRows.sort((a, b) =>
    a.shift.date.localeCompare(b.shift.date) || a.shift.start.localeCompare(b.shift.start)), monthlyLines, warnings: [...warnings] };
}
