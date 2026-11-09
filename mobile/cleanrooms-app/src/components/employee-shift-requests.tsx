import { useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useMobileAuth } from '@/auth/mobile-auth';
import { Button, Row, Txt } from '@/components/ui';
import { cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { dateLabel } from '@/domain/model';
import { useEmployeeWorkflow, type EmployeeRequest, type EmployeeWorkflow } from '@/state/employee-data';
import { invalidateEmployeeResources } from '@/state/published-schedule';
import { useScopedState } from '@/state/scoped-state';

/** Pending transfers are an inbox workflow, independent of the calendar's current week. */
export function EmployeeShiftRequests() {
  const { state, employeeRequest } = useMobileAuth();
  const personId = state.mode === 'signedIn' ? state.session.employee.personId : '';
  const resource = useEmployeeWorkflow();
  const [extra, setExtra] = useState<{ source: EmployeeWorkflow; generation: number; requests: EmployeeRequest[]; cursor: string | null }>();
  const [busy, setBusy] = useScopedState<string | null>(personId + ':' + resource.generation, null), [error, setError] = useState('');
  const epoch = useRef(0), lock = useRef(false);
  useLayoutEffect(() => { const value = ++epoch.current; lock.current = false; return () => { epoch.current = value + 1; }; }, [personId, resource.generation]);
  const tail = extra && extra.source === resource.data && extra.generation === resource.generation ? extra : undefined;
  const requests = [...new Map([...(resource.data?.requests ?? []), ...(tail?.requests ?? [])].map(item => [item.id, item])).values()]
    .filter(item => ['awaiting_colleague', 'pending'].includes(item.status));
  const cursor = tail ? tail.cursor : resource.data?.pagination.requests;
  async function more() {
    if (!cursor || lock.current || resource.loading) return;
    const generation = epoch.current; lock.current = true; setBusy('more'); setError('');
    try {
      const result = await employeeRequest<EmployeeWorkflow>({ action: 'workflowRead', limit: 50, requestCursor: cursor });
      if (generation !== epoch.current || !resource.data) return;
      if (result.pagination.requests === cursor) throw new Error('Anmodningerne kunne ikke hentes. Hent listen igen.');
      setExtra({ source: resource.data, generation: resource.generation, requests: [...(tail?.requests ?? []), ...result.requests], cursor: result.pagination.requests ?? null });
    } catch (cause) { if (epoch.current === generation) setError(cause instanceof Error ? cause.message : 'Anmodningerne kunne ikke hentes.'); }
    finally { if (epoch.current === generation) { lock.current = false; setBusy(null); } }
  }
  async function respond(request: EmployeeRequest, decision: 'accept' | 'decline' | 'cancel') {
    if (lock.current || resource.loading) return;
    const generation = epoch.current; lock.current = true; setBusy(request.id); setError('');
    try {
      await employeeRequest({ action: 'workflowRespond', requestId: request.id, version: request.version, decision });
      if (epoch.current === generation) invalidateEmployeeResources('workflow:', 'inbox');
    } catch (cause) {
      if (epoch.current === generation) { setError(cause instanceof Error ? cause.message : 'Svaret kunne ikke gemmes.'); resource.refresh(); }
    } finally { if (epoch.current === generation) { lock.current = false; setBusy(null); } }
  }
  if (!requests.length && !cursor && !resource.error && !error) return null;
  return <View style={[cardStyles.listSurface, { padding: 14, gap: 12, marginBottom: 12 }]}>
    <Txt size={15} weight="600" accessibilityRole="header">Vagtanmodninger</Txt>
    {(error || resource.error) && <Txt size={13} color={colors.danger} accessibilityRole="alert">{error || resource.error}</Txt>}
    {!!resource.error && <Button label="Prøv igen" compact variant="ghost" onPress={resource.refresh} />}
    {requests.map(request => {
      const recipient = request.toPersonId === personId && request.kind === 'offer';
      return <View key={request.id} style={{ gap: 6 }}>
        <Txt size={14} weight="600">{request.kind === 'claim' ? 'Ledig vagt' : recipient ? `${request.fromName} tilbyder en vagt` : `Tilbud til ${request.toName}`}</Txt>
        <Txt size={13}>{dateLabel(request.shift.date, { weekday: 'short' })} · {request.shift.start}–{request.shift.end}</Txt>
        <Txt size={12} color={colors.muted}>{request.shift.siteName}</Txt>
        {!!request.comment && <Txt size={13} color={colors.muted}>{request.comment}</Txt>}
        {request.blockedReason && <Txt size={12} color={colors.warning}>{request.blockedReason}</Txt>}
        {recipient && request.status === 'awaiting_colleague' ? <Row gap={10}>
          <Button label={busy === request.id ? 'Gemmer…' : 'Accepter'} compact disabled={busy !== null || resource.loading || Boolean(request.blockedReason)} onPress={() => { void respond(request, 'accept'); }} />
          <Button label="Afslå" compact variant="ghost" disabled={busy !== null || resource.loading} onPress={() => { void respond(request, 'decline'); }} />
        </Row> : <Row gap={10}>
          <Txt size={12} color={colors.muted} style={{ flex: 1 }}>{request.status === 'pending' ? 'Afventer planlægger' : 'Afventer kollega'}</Txt>
          {request.fromPersonId === personId && <Button label="Annuller" compact variant="ghost" disabled={busy !== null || resource.loading} onPress={() => { void respond(request, 'cancel'); }} />}
        </Row>}
      </View>;
    })}
    {cursor && <Button label={busy === 'more' ? 'Henter…' : 'Vis flere anmodninger'} compact variant="ghost" disabled={busy !== null || resource.loading} onPress={() => { void more(); }} />}
  </View>;
}
