/* A read may preserve old data; every new or changed schedule must satisfy the same core rules. */
import Series from '../src/series-engine.js';
import Lifecycle from '../src/series-lifecycle.js';
import Planning from '../src/planning-records.js';
import Time from '../src/timekeeping-model.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512 && !['__proto__','prototype','constructor'].includes(value) && !/[\u0000-\u001f\u007f]/.test(value);
const same = (left, right) => left !== undefined && Planning.canonical(left) === Planning.canonical(right);
export function shiftCoreErrors(shift, expectedId) {
  if (!record(shift)) return ['Vagten skal være et objekt.'];
  const errors = [];
  if (!identity(shift.id) || expectedId !== undefined && shift.id !== expectedId) errors.push('Vagtens id er ugyldigt.');
  if (typeof shift.person !== 'string' || shift.person !== '' && !identity(shift.person)) errors.push('Vælg en gyldig medarbejder.');
  if (!Number.isInteger(shift.site) || shift.site < 0 || shift.site >= 2000) errors.push('Vælg et gyldigt arbejdssted.');
  if (!Time.validDate(shift.date) || shift.date < '2000-01-01' || shift.date > '2100-12-31') errors.push('Vælg en gyldig vagtdato inden for kalenderen.');
  if (Time.minute(shift.start) === null || Time.minute(shift.end) === null || shift.end === shift.start) errors.push('Vagtens start og slut skal være forskellige; vagten må være kortere end 24 timer.');
  if (shift.endDate !== undefined && shift.endDate !== Series.shiftEndDate(shift)) errors.push('Vagtens slutdato skal svare til det planlagte tidsrum.');
  if (!Series.validPlannedBreak(shift)) errors.push('Den planlagte pause skal være et helt antal minutter, der er kortere end vagten.');
  if (shift.note !== undefined && typeof shift.note !== 'string' || shift.noteRich !== undefined && typeof shift.noteRich !== 'string') errors.push('Vagtens beskrivelse skal være tekst.');
  return errors;
}
export function seriesCoreErrors(series) {
  if (!record(series)) return ['Vagtserien skal være et objekt.'];
  const errors = Series.validate(series);
  if (!identity(series.id) || !identity(series.person)) errors.push('Vagtseriens id og medarbejder skal være gyldige.');
  if (!Number.isInteger(series.site) || series.site < 0 || series.site >= 2000) errors.push('Vælg et gyldigt arbejdssted.');
  if (series.startDate < '2000-01-01' || series.endDate > '2100-12-31') errors.push('Vagtseriens datoer skal ligge inden for kalenderen.');
  return errors;
}
export function storedScheduleErrors(kind, id, value) {
  if (value === null) return [];
  if (kind === 'series') return seriesCoreErrors(value);
  if (kind === 'shift' && value?.edit) return shiftCoreErrors(value.edit, id);
  return [];
}
export function planningCoreErrors(studio, previous) {
  const errors = [], priorSeries = new Map((previous?.series ?? []).map(series => [series.id, series]));
  const touchedGroups = new Set(), ids = new Set();
  for (const series of studio.series ?? []) {
    if (ids.has(series.id)) errors.push('Vagtseriens id må kun forekomme én gang.');
    ids.add(series.id);
    if (same(priorSeries.get(series.id), series)) continue;
    errors.push(...seriesCoreErrors(series));
    touchedGroups.add(series.groupId ?? series.id);
  }
  for (const [id, shift] of Object.entries(studio.edits ?? {})) if (!same(previous?.edits?.[id], shift)) errors.push(...shiftCoreErrors(shift, id));
  // Week baselines are derived recovery caches, but cannot introduce invalid schedules either.
  for (const [id, week] of Object.entries(studio.weekPlans ?? {})) if (!same(previous?.weekPlans?.[id], week)) {
    if (Array.isArray(week.baseline)) for (const shift of week.baseline) errors.push(...shiftCoreErrors(shift));
  }
  if (touchedGroups.size && !errors.length) {
    const phases = (studio.series ?? []).filter(series => touchedGroups.has(series.groupId ?? series.id));
    errors.push(...Lifecycle.validate(phases));
  }
  return errors;
}
