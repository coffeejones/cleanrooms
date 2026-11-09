import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useMobileAuth } from '@/auth/mobile-auth';
import { Button, Row, Txt } from '@/components/ui';
import { colors } from '@/constants/palette';
import type { EmployeeWorkflow } from '@/state/employee-data';
import { invalidateEmployeeResources, usePublishedResource } from '@/state/published-schedule';
import { useScopedState } from '@/state/scoped-state';

export function ShiftOffer({ shiftId, date }: { shiftId: string; date: string }) {
  const { employeeRequest } = useMobileAuth();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [draft, setDraft] = useState('');
  const load = useCallback(() => employeeRequest<EmployeeWorkflow>({ action: 'workflowRead', from: date, to: date, limit: 50, colleagueQuery: query }), [date, employeeRequest, query]);
  const resource = usePublishedResource('offer:' + shiftId + ':' + query, load, open);
  const [busy, setBusy] = useScopedState<string | null>(shiftId + ':' + query + ':' + resource.generation, null), [error, setError] = useState(''), [sent, setSent] = useState('');
  const [extra, setExtra] = useState<{ source: EmployeeWorkflow; generation: number; people: EmployeeWorkflow['colleagues']; cursor: string | null }>();
  const epoch = useRef(0), lock = useRef(false);
  useLayoutEffect(() => { const value = ++epoch.current; lock.current = false; return () => { epoch.current = value + 1; }; }, [shiftId, query, resource.generation]);
  const tail = extra && extra.source === resource.data && extra.generation === resource.generation ? extra : undefined;
  const people = [...new Map([...(resource.data?.colleagues ?? []), ...(tail?.people ?? [])].map(person => [person.id, person])).values()];
  const cursor = tail ? tail.cursor : resource.data?.pagination.colleagues;
  async function more() {
    if (!cursor || lock.current || resource.loading) return;
    const generation = epoch.current; lock.current = true; setBusy('more'); setError('');
    try {
      const page = await employeeRequest<EmployeeWorkflow>({ action: 'workflowRead', from: date, to: date, limit: 50, colleagueQuery: query, colleagueCursor: cursor });
      if (epoch.current !== generation || !resource.data) return;
      if (page.pagination.colleagues === cursor) throw new Error('Kollegaerne kunne ikke hentes. Søg igen.');
      setExtra({ source: resource.data, generation: resource.generation, people: [...(tail?.people ?? []), ...page.colleagues], cursor: page.pagination.colleagues ?? null });
    } catch (cause) { if (epoch.current === generation) setError(cause instanceof Error ? cause.message : 'Kollegaerne kunne ikke hentes.'); }
    finally { if (epoch.current === generation) { lock.current = false; setBusy(null); } }
  }
  async function offer(personId: string, name: string) {
    const shift = resource.data?.ownShifts.find(item => item.id === shiftId);
    if (lock.current || resource.loading || !shift) return;
    const generation = epoch.current; lock.current = true; setBusy(personId); setError('');
    try {
      await employeeRequest({ action: 'workflowRequest', kind: 'offer', shiftId, fingerprint: shift.fingerprint, toPersonId: personId, comment: '', from: date, to: date });
      if (epoch.current !== generation) return;
      setSent(name); setOpen(false); invalidateEmployeeResources('workflow:', 'inbox');
    } catch (cause) { if (epoch.current === generation) { setError(cause instanceof Error ? cause.message : 'Tilbuddet kunne ikke sendes.'); resource.refresh(); } }
    finally { if (epoch.current === generation) { lock.current = false; setBusy(null); } }
  }
  if (sent) return <Txt size={13} color={colors.muted}>Tilbud sendt til {sent}. Afventer svar og planlæggerens godkendelse.</Txt>;
  return <View style={{ gap: 10 }}>
    <Button label={open ? 'Luk vagtbytte' : 'Tilbyd vagt til en kollega'} compact variant="ghost" onPress={() => setOpen(value => !value)} />
    {open && <>
      <Row gap={8}><TextInput accessibilityLabel="Søg kollega" placeholder="Søg kollega" placeholderTextColor={colors.muted} value={draft} onChangeText={setDraft} onSubmitEditing={() => setQuery(draft.trim())} returnKeyType="search" style={{ flex: 1, minHeight: 44, padding: 10, borderColor: colors.line, borderWidth: 1, borderRadius: 8, color: colors.ink }} /><Button label="Søg" compact variant="ghost" onPress={() => setQuery(draft.trim())} /></Row>
      {(error || resource.error) && <Txt size={13} color={colors.danger} accessibilityRole="alert">{error || resource.error}</Txt>}
      {resource.error && <Button label="Prøv igen" compact variant="ghost" onPress={resource.refresh} />}
      <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled contentContainerStyle={{ gap: 5 }}>
        {people.map(person => <Row key={person.id} gap={10}><Txt size={14} style={{ flex: 1 }}>{person.name}</Txt><Button label={busy === person.id ? 'Sender…' : 'Tilbyd'} compact variant="ghost" disabled={busy !== null || resource.loading || !resource.data?.ownShifts.some(shift => shift.id === shiftId)} onPress={() => { void offer(person.id, person.name); }} /></Row>)}
      </ScrollView>
      {resource.loading && <Txt size={13} color={colors.muted}>Henter kollegaer…</Txt>}
      {!resource.loading && resource.data && !people.length && <Txt size={13} color={colors.muted}>Ingen kollegaer fundet.</Txt>}
      {!resource.loading && resource.data && !resource.data.ownShifts.some(shift => shift.id === shiftId) && <Txt size={13} color={colors.warning}>Vagten kan ikke tilbydes. Hent vagten igen.</Txt>}
      {cursor && <Button label={busy === 'more' ? 'Henter…' : 'Vis flere kollegaer'} compact variant="ghost" disabled={busy !== null || resource.loading} onPress={() => { void more(); }} />}
    </>}
  </View>;
}
