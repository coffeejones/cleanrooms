import { addDays, copenhagenDate, dateLabel, instantForLocal, upcoming, type AppState, type Shift, type Site, type TimeEntry } from './model';

const iso = (date: string, time: string) => new Date(instantForLocal(date, time)).toISOString();
const taskList = () => [
  { id: 'opening', text: 'Gennemgå dagens opgaver og fordel områderne' },
  { id: 'cleaning', text: 'Rengør arbejdsområder og fællesarealer' },
  { id: 'supplies', text: 'Fyld sæbe, papir og øvrige forbrugsvarer op' },
  { id: 'closing', text: 'Afsluttende kvalitetskontrol og aflåsning' },
];

// Synthetic coordinates for testing proximity in the local demo.
const demoSites = [
  {
    id: 'ringsted', name: 'CK Ringsted', address: 'Køgevej 50, 4100 Ringsted',
    geofence: { latitude: 55.44340, longitude: 11.79560, radiusMeters: 150 },
  },
  {
    id: 'nykobing', name: 'CK Nykøbing F.', address: 'Guldborgsundvej 2, 4800 Nykøbing F.',
    geofence: { latitude: 54.76820, longitude: 11.87440, radiusMeters: 150 },
  },
] satisfies Site[];

/** Supply GPS areas to existing built-in demo worksites while preserving saved settings. */
export function withDemoSiteGeofences(state: AppState): AppState {
  if (state.selfId !== 'jonas') return state;

  const sites = state.sites.map(site => {
    if (site.geofence) return site;
    const fixture = demoSites.find(candidate => candidate.id === site.id && candidate.address === site.address);
    return fixture ? { ...site, geofence: { ...fixture.geofence } } : site;
  });
  return sites.some((site, index) => site !== state.sites[index]) ? { ...state, sites } : state;
}

/** Add the sample to both fresh and earlier local demos without changing planned hours. */
export function withDemoShiftChange(state: AppState): AppState {
  if (state.selfId !== 'jonas') return state;
  const existing = state.shifts.find(shift => shift.previousTime);
  if (existing) return withDemoShiftChangeNotification(state, existing);

  const enteredShifts = new Set(state.entries.map(entry => entry.shiftId));
  const sample = upcoming(state, addDays(state.today, 1)).find(shift =>
    shift.id === `own-${shift.date}` && !enteredShifts.has(shift.id) && (
      shift.start === '08:00' && shift.end === '16:00' || shift.start === '09:00' && shift.end === '15:00'
    ),
  );
  if (!sample) return state;

  const previousTime = sample.start === '08:00' ? { start: '07:00', end: '15:00' } : { start: '08:00', end: '14:00' };
  const changed = { ...sample, previousTime };
  return withDemoShiftChangeNotification({ ...state, shifts: state.shifts.map(shift => shift === sample ? changed : shift) }, changed);
}

function withDemoShiftChangeNotification(state: AppState, shift: Shift): AppState {
  if (!shift.previousTime || shift.personId !== state.selfId || shift.id !== `own-${shift.date}`) return state;
  const id = `demo-shift-change-${shift.id}`;
  if (state.notifications.length >= 1000 || state.notifications.some(item => item.id === id)) return state;
  const site = state.sites.find(item => item.id === shift.siteId);
  if (!site) return state;

  const after = { date: shift.date, start: shift.start, end: shift.end, siteName: site.name, plannedBreakMinutes: shift.breakMinutes };
  return {
    ...state,
    notifications: [{
      id, kind: 'shift', title: 'Vagt ændret', shiftId: shift.id, createdAt: iso(state.today, '10:15'), read: false,
      body: `${site.name} · ${dateLabel(shift.date, { weekday: 'short' })} · ${shift.start}–${shift.end}`,
      shiftChange: { before: { ...after, ...shift.previousTime }, after },
    }, ...state.notifications],
  };
}

/** Deterministic, local-only employee data. Never seeded into a real company's workspace. */
export function createDemoState(at = Date.now()): AppState {
  const today = copenhagenDate(at), shifts: Shift[] = [], entries: TimeEntry[] = [];
  const todayAt = (time: string) => iso(today, time);
  const add = (id: string, date: string, personId: string | null, siteId: string, start = '08:00', end = '16:00') => {
    const shift: Shift = {
      id, personId, siteId, date, start, end, breakMinutes: end === '16:00' ? 30 : 0,
      role: siteId === 'ringsted' ? 'Serviceassistent' : 'Rengøring',
      description: 'Start med fællesarealerne og fortsæt med de aftalte områder. Nøglen ligger i nøgleskabet ved personalerummet. Kontakt din teamleder, hvis du mangler materialer eller opdager noget, der kræver opfølgning.',
      checklist: taskList(),
    };
    shifts.push(shift); return shift;
  };
  for (let offset = -40; offset <= 65; offset++) {
    const date = addDays(today, offset), weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    const ownDay = [1, 2, 4, 5].includes(weekday) || offset === 0 || offset === 1 || offset === 6;
    if (ownDay) {
      const weekend = weekday === 0 || weekday === 6;
      const shift = add('own-' + date, date, 'jonas', weekday === 5 ? 'nykobing' : 'ringsted', weekend ? '09:00' : '08:00', weekend ? '15:00' : '16:00');
      if (offset === 0) { shift.start = '08:00'; shift.end = '16:00'; shift.breakMinutes = 30; }
      if (offset < 0) {
        const clockIn = iso(date, shift.start), clockOut = iso(date, shift.end);
        entries.push({
          shiftId: shift.id, clockIn, clockOut, pauses: shift.breakMinutes ? [{ start: iso(date, '12:00'), end: iso(date, '12:30') }] : [],
          comment: offset === -1 ? 'Alt er afsluttet og nøglen er lagt tilbage.' : '', completedTaskIds: shift.checklist.map(t => t.id),
          status: offset < -2 ? 'approved' : 'submitted',
        });
      }
      add('sara-' + date, date, 'sara', shift.siteId, '07:00', '15:00');
      add('mikkel-' + date, date, 'mikkel', shift.siteId, '16:00', '22:00');
      add('emma-' + date, date, 'emma', shift.siteId, '10:00', '17:00');
    }
  }
  const active = shifts.find(s => s.id === 'own-' + today)!;
  entries.push({ shiftId: active.id, clockIn: todayAt('07:58'), pauses: [{ start: todayAt('09:45'), end: todayAt('10:00') }], comment: '', completedTaskIds: ['opening'], status: 'running' });
  const completedToday = add('early-' + today, today, 'jonas', 'ringsted', '06:00', '07:00');
  completedToday.description = 'Kort morgenkontrol og klargøring af personalerum.';
  entries.push({ shiftId: completedToday.id, clockIn: todayAt('06:00'), clockOut: todayAt('07:00'), pauses: [], comment: '', completedTaskIds: completedToday.checklist.map(t => t.id), status: 'submitted' });
  const open1 = add('open-evening', addDays(today, 2), null, 'ringsted', '18:00', '22:00');
  const open2 = add('open-saturday', addDays(today, 5), null, 'nykobing', '08:00', '14:00');
  open2.breakMinutes = 30;
  add('open-later', addDays(today, 9), null, 'ringsted', '16:00', '22:00');
  add('own-evening', addDays(today, 12), 'jonas', 'ringsted', '18:00', '22:00');
  const sites = demoSites.map(site => ({ ...site, geofence: { ...site.geofence } }));
  const nextShift = shifts.find(shift => shift.id === 'own-' + addDays(today, 1))!;
  const nextSite = sites.find(site => site.id === nextShift.siteId)!;
  return withDemoShiftChange({
    schemaVersion: 1, selfId: 'jonas', today, demoStartedAt: at, demoBaseAt: todayAt('10:24'), shifts, entries,
    unavailableDates: [],
    people: [
      { id: 'jonas', name: 'Jonas Hansen', initials: 'JH', role: 'Serviceassistent' },
      { id: 'sara', name: 'Sara Nielsen', initials: 'SN', role: 'Teamleder' },
      { id: 'mikkel', name: 'Mikkel Jensen', initials: 'MJ', role: 'Serviceassistent' },
      { id: 'emma', name: 'Emma Sørensen', initials: 'ES', role: 'Serviceassistent' },
      { id: 'oscar', name: 'Oscar Larsen', initials: 'OL', role: 'Planlægger' },
    ],
    sites,
    requests: [{ id: 'request-demo', kind: 'claim', shiftId: open1.id, status: 'pending', createdAt: todayAt('09:12'), comment: 'Jeg kan tage aftenvagten.' }],
    rooms: [
      { id: 'ringsted-team', name: 'CK Ringsted', subtitle: 'Afdeling · 5 medlemmer', memberIds: ['jonas', 'sara', 'mikkel', 'emma', 'oscar'], pinned: 'Husk at lægge nøglerne tilbage i skabet, når du går. Koden er uændret.' },
      { id: 'cleanrooms', name: 'Alle i CleanRooms', subtitle: 'Fælles beskeder', memberIds: ['jonas', 'sara', 'mikkel', 'emma', 'oscar'] },
      { id: 'nykobing-team', name: 'CK Nykøbing F.', subtitle: 'Afdeling · 3 medlemmer', memberIds: ['jonas', 'sara', 'oscar'] },
    ],
    messages: [
      { id: 'm1', roomId: 'ringsted-team', personId: 'sara', text: 'Godmorgen! Vi har fået leveret nye materialer. De står i depotet ved personalerummet.', createdAt: todayAt('08:10'), read: true },
      { id: 'm2', roomId: 'ringsted-team', personId: 'jonas', text: 'Perfekt, tak. Jeg fylder op i løbet af formiddagen.', createdAt: todayAt('08:14'), read: true },
      { id: 'm3', roomId: 'ringsted-team', personId: 'emma', text: 'Jeg er ved indgangen fra kl. 10, hvis nogen har brug for en hånd 👋', createdAt: todayAt('10:03'), read: false },
      { id: 'm4', roomId: 'cleanrooms', personId: 'oscar', text: 'Vagtplanen for næste uge er nu udgivet. Kig gerne på jeres vagter, og kontakt mig, hvis der er noget.', createdAt: iso(addDays(today, -1), '14:30'), read: false },
      { id: 'm5', roomId: 'nykobing-team', personId: 'sara', text: 'Tak for en god indsats i sidste uge. Alt er klar til fredag.', createdAt: iso(addDays(today, -1), '16:12'), read: true },
    ],
    notifications: [
      {
        id: 'n1', kind: 'shift', title: 'Din næste vagt er klar',
        body: `${nextSite.name} · ${dateLabel(nextShift.date, { weekday: 'short' })} · ${nextShift.start}–${nextShift.end}`,
        createdAt: todayAt('09:40'), read: false, shiftId: nextShift.id,
      },
      { id: 'n2', kind: 'request', title: 'Anmodning sendt', body: 'Du har meldt dig til aftenvagten. Planlæggeren skal godkende den, før den bliver din.', createdAt: todayAt('09:12'), read: true, shiftId: open1.id },
      { id: 'n3', kind: 'chat', title: 'Ny besked i CK Ringsted', body: 'Emma: Jeg er ved indgangen fra kl. 10, hvis nogen har brug for en hånd.', createdAt: todayAt('10:03'), read: false, roomId: 'ringsted-team' },
      { id: 'n4', kind: 'system', title: 'Dine timer er godkendt', body: 'Planlæggeren har godkendt de registrerede timer fra sidste uge.', createdAt: iso(addDays(today, -1), '15:20'), read: true },
    ],
    preferences: { notifications: true, chatNotifications: true, biometricLock: false },
  });
}
