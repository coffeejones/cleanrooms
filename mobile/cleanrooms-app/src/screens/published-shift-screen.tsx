import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMobileAuth } from '@/auth/mobile-auth';
import { mobileAuthOrigin, MobileAuthError, type PublishedShiftDetail, type ShiftTimeEntry, type ShiftTimeOperation } from '@/auth/mobile-auth-api';
import { ScheduleFeedback } from '@/components/schedule-feedback';
import { ShiftActionButton, ShiftConfirmation, type ShiftConfirmationKind } from '@/components/shift-confirmation';
import { Avatar, Button, EmptyState, Icon, Row, Surface, Txt } from '@/components/ui';
import { ShiftOffer } from '@/components/shift-offer';
import { ShiftTimeChange } from '@/components/shift-time-change';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { shiftTimeLabel, addDays, clockTimeLabel, instantForLocal, currency, dateLabel, minutesLabel, shiftInterval, type ClockInLocation, type Result } from '@/domain/model';
import { readClockInLocation } from '@/location/clock-in-location';
import { useNow } from '@/state/app-store';
import { invalidateEmployeeResources, usePublishedResource, usePublishedShift } from '@/state/published-schedule';
import { currentShiftLeave, parseShiftLeave, useEmployeeHours, useShiftLeaves, useShiftTimeChange, type ShiftLeaveRequest } from '@/state/employee-data';
import { useScopedState } from '@/state/scoped-state';
import { confirmsTimeCommand } from '@/state/attendance-runtime';
import { useEmployeeDraft } from '@/state/private-drafts';

export default function PublishedShiftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const resource = usePublishedShift(id);
  const { state: auth, sessionEpoch, readPublishedShift, writeShiftTime, employeeRequest } = useMobileAuth();
  const draftScope = auth.mode === 'signedIn' ? JSON.stringify([mobileAuthOrigin, auth.session.employee.workspaceId, auth.session.employee.personId, auth.session.expiresAt, 'clock-out', id]) : '';
  const checkoutDraft = useEmployeeDraft(draftScope ? JSON.stringify([draftScope, sessionEpoch]) : '', draftScope, auth.mode === 'signedIn' ? Date.parse(auth.session.expiresAt) : 0);
  const [form, setForm] = useState<ShiftConfirmationKind | null>(null);
  const [saved, setSaved] = useState<{ shiftId: string; entry: ShiftTimeEntry }>();
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [taskPending, setTaskPending] = useState(false);
  const taskLock = useRef(false);
  const [taskReceipt, setTaskReceipt] = useState<{
    shiftId: string; checklistToken: string; source: PublishedShiftDetail; completedTaskIds: string[];
  } | null>(null);
  const [taskError, setTaskError] = useState<string>();
  const [leave, setLeave] = useState(false);
  const [leaveReceipt, setLeaveReceipt] = useState<{ date: string; source: ShiftLeaveRequest[] | undefined; request: ShiftLeaveRequest }>();
  const pending = useRef(false);
  const uncertain = useRef<{ shiftId: string; operation: ShiftTimeOperation; version: number; comment: string | null; previousComment?: string } | null>(null);
  const insets = useSafeAreaInsets();
  const now = useNow();

  const detail = resource.data;
  const timeChange = useShiftTimeChange(detail?.shift);
  const leaves = useShiftLeaves(detail?.shift.date ?? '');
  const leaveRequest = currentShiftLeave([...(leaves.data ?? []), ...(leaveReceipt && detail && leaveReceipt.date === detail.shift.date && leaveReceipt.source === leaves.data ? [leaveReceipt.request] : [])], detail?.shift.date ?? '');
  const previousTime = detail?.shift.previousTime ?? timeChange.data ?? undefined;
  const hours = useEmployeeHours(detail?.shift.date ?? '', detail ? addDays(detail.shift.date, 2) : '');
  const pay = hours.data?.rows.find(row => row.shift.id === id)?.pay;
  const readColleagues = useCallback(() => employeeRequest<CoworkerPage>({ action: 'employeeColleagues', shiftId: id, cursor: null, limit: 50 }), [employeeRequest, id]);
  const coworkers = usePublishedResource('colleagues:' + id, readColleagues, Boolean(detail));
  const [extraCoworkers, setExtraCoworkers] = useState<{ shiftId: string; generation: number; source: CoworkerPage; page: CoworkerPage } | null>(null);
  const [loadingMore, setLoadingMore] = useScopedState(id + ':' + coworkers.generation, false);
  const [coworkerError, setCoworkerError] = useState<string>();
  const coworkerGeneration = useRef(0);
  useLayoutEffect(() => { const value = ++coworkerGeneration.current; return () => { coworkerGeneration.current = value + 1; }; }, [id, coworkers.generation]);
  const coworkerPage = extraCoworkers?.shiftId === id && extraCoworkers.source === coworkers.data && extraCoworkers.generation === coworkers.generation
    ? extraCoworkers.page : coworkers.data;
  // A successful refresh is authoritative even if the checklist structure is unchanged.
  const completed = taskReceipt?.shiftId === id && taskReceipt.checklistToken === detail?.checklistToken && taskReceipt.source === detail
    ? taskReceipt.completedTaskIds : detail?.completedTaskIds ?? [];
  const lastSaved = saved?.shiftId === id ? saved.entry : undefined;
  const entry = lastSaved && lastSaved.version > (detail?.entry?.version ?? 0) ? lastSaved : detail?.entry;
  useEffect(() => {
    // Reading the same committed comment is also a valid receipt after a lost
    // checkout response or an interrupted app. Never clear a newer edited note.
    if (entry?.clockOut && checkoutDraft.draft && (entry.comment ?? '').trim() === checkoutDraft.draft.trim()) {
      void checkoutDraft.clear(checkoutDraft.draft).catch(() => undefined);
    }
  }, [checkoutDraft, entry]);
  const running = entry?.status === 'running' || entry?.status === 'paused';
  const plannedInterval = detail ? shiftInterval(detail.shift) : null;
  const canStart = detail && !entry && plannedInterval && now >= Math.max(plannedInterval.start - 30 * 60_000, instantForLocal(detail.shift.date, '00:00')) && now < plannedInterval.end;
  const status = entry?.status === 'approved' ? 'Godkendt' : entry?.status === 'rejected' ? 'Sendt retur' :
    entry?.status === 'paused' ? 'På pause' : entry?.status === 'running' ? 'I gang' : entry ? 'Afsluttet' : 'Planlagt';
  const statusColor = entry?.status === 'rejected' ? colors.danger : entry?.status === 'paused' ? colors.warning :
    entry ? colors.success : colors.muted;

  async function register(operation: ShiftTimeOperation, comment: string | null = null, signal?: AbortSignal): Promise<Result> {
    if (!detail || pending.current || signal?.aborted) return { ok: false };
    pending.current = true;
    setBusy(true);
    setActionError(undefined);
    try {
      if (uncertain.current?.shiftId === id) {
        const previous = uncertain.current;
        const latest = await readPublishedShift(id);
        if (latest?.entry) setSaved({ shiftId: id, entry: latest.entry });
        if (confirmsTimeCommand(previous.operation, previous.version, latest?.entry, previous.comment, previous.previousComment)) {
          uncertain.current = null; resource.refresh(); invalidateEmployeeResources('active-time', 'hours:');
          if (previous.operation === operation && ['finish', 'submit'].includes(operation) && (comment ?? '').trim() !== (previous.comment ?? '').trim()) {
            return { ok: false, error: 'Registreringen er allerede opdateret med din tidligere kommentar. Den nye tekst er bevaret som udkast.' };
          }
          return previous.operation === operation ? { ok: true } : { ok: false, error: 'Registreringen er opdateret. Kontrollér vagten.' };
        }
        if (!latest || (latest.entry?.version ?? 0) !== previous.version) {
          resource.refresh();
          return { ok: false, error: 'Registreringen er ændret. Hent vagten igen.', uncertain: true };
        }
        uncertain.current = null;
      }
      let location: ClockInLocation | null = null;
      if (operation === 'start' && signal) {
        const latest = await readPublishedShift(id);
        if (signal.aborted) return { ok: false };
        if (!latest) {
          resource.refresh();
          return { ok: false, error: 'Vagten er ikke længere udgivet til dig.' };
        }
        if (latest.clockInRadius !== null) {
          const reading = await readClockInLocation(signal, latest.clockInRadius);
          if ('error' in reading) return { ok: false, error: reading.error };
          location = reading.location;
        }
      }
      if (signal?.aborted) return { ok: false };
      const result = await writeShiftTime({ shiftId: id, operation, version: entry?.version ?? 0, location, comment,
        ...(operation === 'submit' ? { previousComment: entry?.comment ?? '' } : {}) });
      uncertain.current = null;
      setSaved({ shiftId: id, entry: result });
      resource.refresh();
      invalidateEmployeeResources('active-time', 'hours:', 'inbox');
      return { ok: true };
    } catch (error) {
      if (error instanceof MobileAuthError && error.code === 'mobile_time_unconfirmed') uncertain.current = { shiftId: id, operation, version: entry?.version ?? 0, comment,
        ...(operation === 'submit' ? { previousComment: entry?.comment ?? '' } : {}) };
      if (error instanceof MobileAuthError && (error.status === 409 || error.code === 'mobile_time_unconfirmed')) { resource.refresh(); invalidateEmployeeResources('active-time'); }
      return { ok: false, error: error instanceof MobileAuthError ? error.message : 'Stemplingen kunne ikke bekræftes. Prøv igen.', uncertain: uncertain.current?.shiftId === id };
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function togglePause() {
    const result = await register(entry?.status === 'paused' ? 'resume' : 'pause');
    if (!result.ok) setActionError(result.error);
  }

  async function toggleTask(taskId: string) {
    if (taskLock.current || !detail?.checklistToken) return;
    taskLock.current = true; setTaskPending(true); setTaskError(undefined);
    try {
      const result = await employeeRequest<{ completedTaskIds: string[] }>({ action: 'employeeChecklist', shiftId: id, taskId, checked: !completed.includes(taskId), checklistToken: detail.checklistToken });
      setTaskReceipt({ shiftId: id, checklistToken: detail.checklistToken, source: detail, completedTaskIds: result.completedTaskIds });
      resource.refresh();
    } catch (error) {
      setTaskReceipt(null);
      setTaskError(error instanceof MobileAuthError ? error.message : 'Opgaven kunne ikke gemmes. Prøv igen.');
      resource.refresh();
    } finally { taskLock.current = false; setTaskPending(false); }
  }
  function refreshColleagues() {
    coworkerGeneration.current++;
    setExtraCoworkers(null); setLoadingMore(false); setCoworkerError(undefined);
    coworkers.refresh();
  }
  function refreshShift() {
    setTaskReceipt(null); setTaskError(undefined);
    refreshColleagues(); resource.refresh(); hours.refresh();leaves.refresh();timeChange.refresh();
  }
  async function loadMoreColleagues() {
    if (!coworkerPage?.nextCursor || !coworkers.data || loadingMore || coworkers.loading || coworkers.error) return;
    const generation = ++coworkerGeneration.current;
    const source = coworkers.data;
    setLoadingMore(true); setCoworkerError(undefined);
    try {
      const next = await employeeRequest<CoworkerPage>({ action: 'employeeColleagues', shiftId: id, cursor: coworkerPage.nextCursor, limit: 50 });
      if (coworkerGeneration.current !== generation) return;
      const colleagues = [...new Map([...coworkerPage.colleagues, ...next.colleagues].map(person => [person.id, person])).values()];
      setExtraCoworkers({ shiftId: id, generation: coworkers.generation, source, page: { ...next, colleagues } });
    } catch (error) {
      if (coworkerGeneration.current !== generation) return;
      setCoworkerError(error instanceof MobileAuthError ? error.message : 'Kollegaerne kunne ikke hentes. Prøv igen.');
      if (error instanceof MobileAuthError && error.status === 409) { setExtraCoworkers(null); coworkers.refresh(); }
    }
    finally { if (coworkerGeneration.current === generation) setLoadingMore(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: cardColors.canvas }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 }}
        refreshControl={<RefreshControl refreshing={resource.refreshing} onRefresh={refreshShift} />}
      >
        <ScheduleFeedback loading={resource.loading && detail === undefined} error={resource.error} onRetry={refreshShift} />
        {detail === null && <EmptyState title="Vagten er ikke længere udgivet til dig" />}
        {detail && <>
          <Surface style={[cardStyles.listSurface, { gap: 20, padding: 18 }]}>
            <View style={{ gap: 10 }}>
              <Row gap={12} style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <Txt size={13} weight="500" color={colors.muted} style={{ flexShrink: 1 }}>
                  {dateLabel(detail.shift.date, { weekday: 'long', month: 'long' })}
                </Txt>
                <Row gap={5}>
                  {previousTime && <ShiftTimeChange shift={{ ...detail.shift, previousTime }} />}
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
                  <Txt size={12} weight="500" color={colors.muted}>{status}</Txt>
                </Row>
              </Row>
              <Txt size={32} weight="600" accessibilityRole="header" style={{ letterSpacing: -1.2 }}>
                {shiftTimeLabel(detail.shift)}
              </Txt>
            </View>
            {timeChange.error && <Pressable accessibilityRole="button" onPress={timeChange.refresh} style={{ minHeight: 44, justifyContent: 'center' }}><Txt size={12} color={colors.muted}>Vagtændringer kunne ikke hentes. Prøv igen.</Txt></Pressable>}
            <View style={{ gap: 7 }}>
              <Txt size={19} weight="600" style={{ letterSpacing: -0.35 }}>{detail.site.name}</Txt>
              {detail.site.address ? <Row gap={7} style={{ alignItems: 'flex-start' }}>
                <Icon name="map-pin" color={colors.muted} size={14} />
                <Txt size={13} color={colors.muted} style={{ flex: 1 }}>{detail.site.address}</Txt>
              </Row> : null}
              {detail.shift.breakMinutes > 0 && <Txt size={13} color={colors.muted}>
                Planlagt pause · {minutesLabel(detail.shift.breakMinutes)}
              </Txt>}
            </View>
            <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt size={12} color={colors.muted}>{pay?.kind === 'registered' ? 'Løn før skat' : 'Forventet løn før skat'}</Txt><Txt size={16} weight="600">{pay && !pay.unavailableReason ? currency(pay.totalCents) : '—'}</Txt></Row>
            {pay?.unavailableReason && <Txt size={12} color={colors.muted}>{pay.unavailableReason}</Txt>}
            {leaves.loading && !leaves.data && <Txt size={12} color={colors.muted}>Henter friønske…</Txt>}
            {leaves.error && <Pressable accessibilityRole="button" onPress={leaves.refresh} style={{ minHeight: 44, justifyContent: 'center' }}><Txt size={12} color={colors.danger}>Friønsket kunne ikke hentes. Prøv igen.</Txt></Pressable>}
            {leaveRequest && <View style={{ gap: 5 }}>
              <Txt size={13} weight="500" color={leaveRequest.status === 'rejected' ? colors.danger : colors.muted}>{leaveRequest.type === 'Friønske' ? 'Friønske' : 'Fravær'} {leaveRequest.status === 'pending' ? 'afventer godkendelse' : leaveRequest.status === 'approved' ? 'godkendt' : 'afvist'}.</Txt>
              {!!leaveRequest.decision?.reason && <Txt size={13} color={colors.muted}>{leaveRequest.decision.reason}</Txt>}
            </View>}
            {!entry && leaves.data && !leaves.loading && !leaves.error && (!leaveRequest || leaveRequest.status === 'rejected') && shiftInterval(detail.shift).start > now && <Pressable accessibilityRole="button" onPress={() => setLeave(true)} style={{ minHeight: 44, justifyContent: 'center' }}><Txt size={14} weight="600" color={colors.accent}>{leaveRequest ? 'Ønsk fri igen' : 'Ønsk fri'}</Txt></Pressable>}
            {!entry && shiftInterval(detail.shift).start > now && <ShiftOffer shiftId={id} date={detail.shift.date} />}
            {entry?.status === 'rejected' && <View style={{ gap: 10 }}>
              <Txt size={15} weight="600">Timer sendt retur</Txt>
              {!!entry.rejectionReason && <Txt size={14} color={colors.muted}>{entry.rejectionReason}</Txt>}
              {!!entry.comment && <Txt size={13} color={colors.muted}>Din kommentar: {entry.comment}</Txt>}
              {!entry.clockOut && <Txt size={13} color={colors.muted}>Den manglende udstempling afklares af planlæggeren.</Txt>}
              <TextInput accessibilityLabel="Kommentar til genindsendelse" value={returnComment} onChangeText={setReturnComment} multiline placeholder="Svar til planlæggeren" placeholderTextColor={colors.muted} style={{ minHeight: 86, padding: 12, color: colors.ink, borderColor: colors.line, borderWidth: 1, borderRadius: 8, textAlignVertical: 'top' }} />
              <Button label={busy ? 'Sender…' : entry.clockOut ? 'Send timer igen' : 'Send forklaring'} disabled={busy || !returnComment.trim()} onPress={() => { void register('submit', returnComment.trim()).then(result => { if (result.ok) setReturnComment(''); else setActionError(result.error); }); }} />
              {actionError && <Txt size={13} color={colors.danger} accessibilityRole="alert">{actionError}</Txt>}
            </View>}
            {entry?.clockIn && <View style={[cardStyles.divider, { paddingTop: 18, gap: 12 }]}>
              <Row gap={16} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <View style={{ gap: 4, flexGrow: 1, flexBasis: '44%' }}>
                  <Txt size={12} color={colors.muted}>Stemplet ind</Txt>
                  <Txt size={16} weight="600">{clockTimeLabel(Date.parse(entry.clockIn))}</Txt>
                </View>
                {entry.clockOut && <View style={{ gap: 4, flexGrow: 1, flexBasis: '44%' }}>
                  <Txt size={12} color={colors.muted}>Stemplet ud</Txt>
                  <Txt size={16} weight="600">{clockTimeLabel(Date.parse(entry.clockOut))}</Txt>
                </View>}
              </Row>
              {running && <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                onPress={() => void togglePause()}
                disabled={busy}
                style={({ pressed }) => ({
                  alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, justifyContent: 'center',
                  backgroundColor: colors.white, borderWidth: 1, borderColor: cardColors.border,
                  borderRadius: 8, borderCurve: 'continuous', opacity: busy ? 0.45 : pressed ? 0.65 : 1,
                })}
              >
                <Row gap={8}>
                  <Icon name={entry.status === 'paused' ? 'play' : 'pause'} size={15} color={colors.ink} />
                  <Txt size={14} weight="600">{entry.status === 'paused' ? 'Genoptag' : 'Start pause'}</Txt>
                </Row>
              </Pressable>}
            </View>}
          </Surface>
          {!!(detail.shift.description || detail.shift.checklist.length) && <Surface style={[cardStyles.listSurface, { gap: 14, padding: 18 }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: descriptionOpen }} onPress={() => setDescriptionOpen(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}><Row gap={10}>
              <Icon name="file" size={18} color={colors.muted} />
              <Txt size={15} weight="600" style={{ flex: 1 }}>Beskrivelse</Txt>
              {!!detail.shift.checklist.length && <Txt size={12} color={colors.muted}>{completed.length} af {detail.shift.checklist.length}</Txt>}
              <Icon name="chevron-down" size={12} color={colors.muted} />
            </Row></Pressable>
            {descriptionOpen && <>
              {detail.shift.description && <Txt size={15} style={{ lineHeight: 23 }}>{detail.shift.description}</Txt>}
              {detail.shift.checklist.map(task => <Pressable key={task.id} accessibilityRole="checkbox" accessibilityLabel={task.text} accessibilityState={{ checked: completed.includes(task.id), disabled: taskPending || !detail.checklistToken }} disabled={taskPending || !detail.checklistToken} onPress={() => void toggleTask(task.id)} style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8 }}><Row gap={10} style={{ alignItems: 'flex-start' }}>
                <View style={{ width: 21, height: 21, borderRadius: 5, borderWidth: 1, borderColor: colors.line, backgroundColor: completed.includes(task.id) ? colors.accent : colors.white, alignItems: 'center', justifyContent: 'center' }}>{completed.includes(task.id) && <Icon name="check" color={colors.white} size={13} />}</View>
                <Txt size={14} color={completed.includes(task.id) ? colors.muted : colors.ink} style={{ flex: 1, lineHeight: 21 }}>{task.text}</Txt>
              </Row></Pressable>)}
              {taskError && <Txt size={13} color={colors.danger} accessibilityRole="alert">{taskError}</Txt>}
            </>}
          </Surface>}
          <Surface style={[cardStyles.listSurface, { padding: 18, gap: 14 }]}>
            <Txt size={15} weight="600" accessibilityRole="header">Kollegaer den dag</Txt>
            <ScheduleFeedback loading={coworkers.loading && !coworkerPage} error={coworkerError ?? coworkers.error} onRetry={refreshColleagues} />
            {coworkerPage?.colleagues.map(person => <Row key={person.id} gap={10}><Avatar initials={person.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('')} size={32} /><View style={{ flex: 1 }}><Txt size={14} weight="500">{person.name}</Txt>{!!person.role && <Txt size={12} color={colors.muted}>{person.role}</Txt>}</View><Txt size={13} color={colors.muted}>{shiftTimeLabel(person)}</Txt></Row>)}
            {coworkerPage?.colleagues.length === 0 && <Txt size={13} color={colors.muted}>Ingen andre på arbejdsstedet den dag.</Txt>}
            {coworkerPage?.nextCursor && <Pressable accessibilityRole="button" accessibilityState={{ disabled: loadingMore || coworkers.loading || Boolean(coworkers.error), busy: loadingMore }} disabled={loadingMore || coworkers.loading || Boolean(coworkers.error)} onPress={() => void loadMoreColleagues()} style={{ minHeight: 44, justifyContent: 'center' }}><Txt size={13} weight="600" color={colors.accent}>{loadingMore ? 'Henter…' : 'Vis flere'}</Txt></Pressable>}
          </Surface>
        </>}
      </ScrollView>
      {(canStart || running) && <View style={{
        backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.line, gap: 8,
        boxShadow: '0 -3px 12px rgba(0, 30, 43, 0.035)',
        paddingTop: 12, paddingBottom: Math.max(12, insets.bottom),
        paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right),
      }}>
        {actionError && <Txt color={colors.danger} accessibilityRole="alert">{actionError}</Txt>}
        <ShiftActionButton label={running ? 'Stempl ud' : 'Stempl ind'} onPress={() => setForm(running ? 'clock-out' : 'clock-in')} disabled={busy} />
      </View>}
      <ShiftConfirmation
        kind={form}
        commentDraft={form === 'clock-out' ? { text: checkoutDraft.draft, ready: checkoutDraft.draftReady, error: checkoutDraft.draftError, setText: checkoutDraft.setDraft, clear: checkoutDraft.clear } : undefined}
        summary={detail ? `${detail.site.name} · ${shiftTimeLabel(detail.shift)}` : ''}
        locationCheck={detail?.clockInRadius ? 'required' : undefined}
        onConfirm={(comment, signal) => form === 'clock-in' ? register('start', null, signal) : register('finish', comment, signal)}
        onDismiss={() => setForm(null)}
      />
      <ShiftConfirmation kind={leave ? 'leave' : null} summary="Anmod om fri hele dagen. Vagten gælder, indtil ønsket er godkendt." onDismiss={() => setLeave(false)} onConfirm={async comment => {
        try {
          if (!detail || auth.mode !== 'signedIn') return { ok: false, error: 'Hent vagten igen.' };
          const latest = currentShiftLeave(await leaves.read(), detail.shift.date);
          if (latest && latest.status !== 'rejected') { leaves.refresh();return { ok: false, error: latest.status === 'pending' ? 'Der er allerede et friønske, der afventer svar.' : 'Fraværet er allerede godkendt.' }; }
          const result = await employeeRequest<{ request: unknown }>({ action: 'shiftLeave', shiftId: id, comment });
          const request = parseShiftLeave(result.request, auth.session.employee.personId);
          if (!request.days.includes(detail.shift.date)) throw new Error('Friønsket kunne ikke bekræftes. Hent vagten igen.');
          setLeaveReceipt({ date: detail.shift.date, source: leaves.data, request });invalidateEmployeeResources('leave:');
          return { ok: true };
        } catch (error) { leaves.refresh();return { ok: false, error: error instanceof Error ? error.message : 'Friønsket kunne ikke sendes.' }; }
      }} />
    </View>
  );
}

type CoworkerPage = { colleagues: { id: string; personId: string; name: string; role: string; start: string; end: string }[]; nextCursor: string | null };
