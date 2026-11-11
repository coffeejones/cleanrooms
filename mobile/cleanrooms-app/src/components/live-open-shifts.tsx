import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useMobileAuth } from '@/auth/mobile-auth';
import { Button, EmptyState, Row, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { addDays, dateLabel, instantForLocal } from '@/domain/model';
import { useNow } from '@/state/app-store';
import { useEmployeeWorkflow, type EmployeeWorkflow, type EmployeeWorkflowShift } from '@/state/employee-data';
import { useScopedState } from '@/state/scoped-state';

export function LiveOpenShifts({ from, to, unavailableDates }: { from: string; to: string; unavailableDates: ReadonlySet<string> }) {
  const { employeeRequest, state: auth } = useMobileAuth();
  const resource = useEmployeeWorkflow(from, to);
  const now = useNow();
  const employee = auth.mode === 'signedIn' ? auth.session.employee : null;
  const key = employee ? JSON.stringify([employee.workspaceId, employee.personId, from, to]) : '';
  const [pages, setPages] = useState<{ key: string; generation: number; shifts: EmployeeWorkflowShift[]; cursor: string | null }>();
  const [confirmed, setConfirmed] = useState<{ key: string; generation: number; shifts: string[] }>();
  const [busy, setBusy] = useScopedState<string | null>(key + ':' + resource.generation, null);
  const [paging, setPaging] = useScopedState(key + ':' + resource.generation, false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const epoch = useRef(0);
  useLayoutEffect(() => { const value = ++epoch.current; pending.current = false; return () => { epoch.current = value + 1; }; }, [key, resource.generation]);
  const extra = pages?.key === key && pages.generation === resource.generation ? pages : undefined;
  const cursor = extra ? extra.cursor : resource.data?.pagination.openShifts ?? null;
  const shifts = useMemo(() => [...new Map([...(resource.data?.openShifts ?? []), ...(extra?.shifts ?? [])].map(shift => [shift.id, shift])).values()]
    .filter(shift => instantForLocal(shift.date, shift.start) > now)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)), [extra?.shifts, now, resource.data?.openShifts]);
  const requested = new Set([
    ...(resource.data?.requests ?? []).filter(request => request.kind === 'claim' && ['pending', 'awaiting_colleague'].includes(request.status)).map(request => request.shift.id),
    ...(confirmed?.key === key && confirmed.generation === resource.generation ? confirmed.shifts : []),
  ]);

  async function loadMore() {
    if (!cursor || pending.current || resource.loading || resource.error) return;
    const generation = epoch.current;
    pending.current = true;
    setPaging(true); setError('');
    try {
      const page = await employeeRequest<EmployeeWorkflow>({ action: 'workflowRead', from, to, openCursor: cursor, limit: 50 });
      if (epoch.current !== generation) return;
      if (!page || !Array.isArray(page.openShifts) || !page.pagination || page.pagination.openShifts === cursor) throw new Error('De næste vagter kunne ikke indlæses. Prøv igen.');
      setPages({ key, generation: resource.generation, shifts: [...(extra?.shifts ?? []), ...page.openShifts], cursor: page.pagination.openShifts ?? null });
    } catch (failure) { if (epoch.current === generation) { setError(failure instanceof Error ? failure.message : 'Vagterne kunne ikke hentes. Prøv igen.'); resource.refresh(); } }
    finally { if (epoch.current === generation) { pending.current = false; setPaging(false); } }
  }

  async function claim(shift: EmployeeWorkflowShift) {
    if (pending.current || resource.loading) return;
    const generation = epoch.current;
    pending.current = true;
    setBusy(shift.id); setError('');
    try {
      const result = await employeeRequest<EmployeeWorkflow>({ action: 'workflowRequest', kind: 'claim', shiftId: shift.id, fingerprint: shift.fingerprint, comment: '', from, to });
      if (epoch.current !== generation) return;
      if (!result || !Array.isArray(result.requests) || !result.requests.some(request => request.kind === 'claim' && request.shift.id === shift.id
        && ['pending', 'awaiting_colleague', 'approved'].includes(request.status))) throw new Error('Anmodningen kunne ikke bekræftes. Prøv igen.');
      setConfirmed(previous => ({ key, generation: resource.generation, shifts: [...new Set([...(previous?.key === key && previous.generation === resource.generation ? previous.shifts : []), shift.id])] }));
      resource.refresh();
    } catch (failure) { if (epoch.current === generation) { setError(failure instanceof Error ? failure.message : 'Anmodningen kunne ikke sendes. Prøv igen.'); resource.refresh(); } }
    finally { if (epoch.current === generation) { pending.current = false; setBusy(null); } }
  }

  return <View style={cardStyles.listSurface}>
    <View style={styles.heading}>
      <Txt size={16} weight="600" accessibilityRole="header">Ledige vagter</Txt>
      <Txt size={12} color={colors.muted}>{dateLabel(from)} – {dateLabel(to)}</Txt>
    </View>
    {!!(error || resource.error) && <Row gap={8} style={styles.feedback} accessibilityLiveRegion="polite">
      <Txt size={13} color={colors.muted} style={{ flex: 1 }}>{error || resource.error}</Txt>
      <Pressable accessibilityRole="button" onPress={resource.refresh} style={styles.retry}><Txt size={13} weight="600" color={colors.accent}>Prøv igen</Txt></Pressable>
    </Row>}
    {resource.loading && !resource.data ? <View style={styles.loading}><ActivityIndicator color={colors.accent} accessibilityLabel="Henter ledige vagter" /></View>
      : shifts.length === 0 && !resource.error ? <EmptyState title="Ingen ledige vagter" body="Nye ledige vagter vises her. Kig gerne forbi igen senere." /> : shifts.map((shift, index) => {
        const startsDay = shifts[index - 1]?.date !== shift.date;
        const sent = requested.has(shift.id);
        const unavailable = unavailableDates.has(shift.date) || shift.end < shift.start && shift.end !== '00:00' && unavailableDates.has(addDays(shift.date, 1));
        return <View key={shift.id} style={[styles.shift, index > 0 && cardStyles.divider]}>
          {startsDay && <Txt accessibilityRole="header" size={13} weight="600" color={colors.muted}>
            {dateLabel(shift.date, { weekday: 'long', month: 'long' })}
          </Txt>}
          <Row gap={12} style={{ alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Txt size={17} weight="600">{shift.start}–{shift.end}</Txt>
              <Txt size={13} color={colors.muted}>{shift.siteName || 'Arbejdssted'}</Txt>
            </View>
            {sent ? <Txt size={13} color={colors.muted}>Anmodet</Txt>
              : unavailable ? <Txt size={13} color={colors.warning}>Utilgængelig</Txt>
              : <Button label={busy === shift.id ? 'Sender…' : 'Anmod'} variant="secondary" compact style={{ minWidth: 92 }}
                disabled={Boolean(busy) || paging} onPress={() => { void claim(shift); }} />}
          </Row>
        </View>;
      })}
    {cursor && <Pressable accessibilityRole="button" accessibilityState={{ disabled: paging || Boolean(busy) }} disabled={paging || Boolean(busy)}
      onPress={() => { void loadMore(); }} style={[cardStyles.divider, styles.more]}>
      {paging ? <ActivityIndicator color={colors.accent} /> : <Txt size={13} weight="600" color={colors.accent}>Vis flere vagter</Txt>}
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  heading: { paddingHorizontal: 16, paddingVertical: 14, gap: 3, backgroundColor: cardColors.section },
  shift: { paddingHorizontal: 16, paddingVertical: 14, gap: 7 },
  feedback: { paddingHorizontal: 16, paddingVertical: 8 },
  retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  loading: { minHeight: 100, justifyContent: 'center' },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
