import { router } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { useMobileAuth } from '@/auth/mobile-auth';
import { FlowScreen } from '@/components/flow-screen';
import { PressFeedback } from '@/components/press-feedback';
import { Button, EmptyState, Icon, Row, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { copenhagenDate, dateLabel, TIME_ZONE } from '@/domain/model';
import { notificationDateGroups } from '@/notifications/notification-date-groups';
import { useNow } from '@/state/app-store';
import { useEmployeeInbox, type EmployeeInbox, type EmployeeWorkflowMessage, type EmployeeWorkflowShift } from '@/state/employee-data';
import { invalidateEmployeeResources } from '@/state/published-schedule';
import { EmployeeShiftRequests } from '@/components/employee-shift-requests';
import { useScopedState } from '@/state/scoped-state';
import { parsePushTarget } from '@/notifications/push-wire';

const timestamp = new Intl.DateTimeFormat('da-DK', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const titles: Record<string, string> = { new: 'Ny vagt', changed: 'Vagt ændret', moved: 'Vagt flyttet', cancelled: 'Vagt aflyst', request: 'Vagtanmodning', reminder: 'Vagtpåmindelse', checkout_reminder: 'Husk at stemple ud' };

function shiftLabel(shift: EmployeeWorkflowShift) {
  return `${dateLabel(shift.date, { weekday: 'short' })} · ${shift.start}–${shift.end}`;
}

export default function LiveNotificationsScreen() {
  const { state, sessionEpoch, employeeRequest } = useMobileAuth();
  const resource = useEmployeeInbox();
  const today = copenhagenDate(useNow());
  const scope = state.mode === 'signedIn' ? JSON.stringify([state.session.employee.workspaceId, state.session.employee.personId, sessionEpoch]) : '';
  const head = resource.data?.notifications.map(item => item.id).join('|') ?? '';
  const firstCursor = resource.data?.nextCursor ?? null;
  const [more, setMore] = useState<{ scope: string; head: string; firstCursor: string | null; generation: number; items: EmployeeWorkflowMessage[]; cursor?: string | null }>();
  const [read, setRead] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] });
  const [busy, setBusy] = useScopedState<'more' | string | null>(scope, null);
  const [error, setError] = useScopedState<string>(scope, '');
  const pending = useRef(false), mounted = useRef(true), generation = useRef(0);
  const pageGeneration = useRef(0);
  const list = useRef<FlatList<EmployeeWorkflowMessage>>(null);
  // Account/session changes invalidate mutations. A refresh of this same inbox
  // only invalidates pagination; it must not cancel a tap after the read ACK.
  useLayoutEffect(() => { const value = ++generation.current; pending.current = false; return () => { generation.current = value + 1; }; }, [scope]);
  useLayoutEffect(() => { pageGeneration.current++; }, [scope, resource.generation]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const extra = more?.scope === scope && more.head === head && more.firstCursor === firstCursor && more.generation === resource.generation ? more : undefined;
  const cursor = extra ? extra.cursor : resource.data?.nextCursor;
  const items = useMemo(() => [...new Map([...(resource.data?.notifications ?? []), ...(extra?.items ?? [])]
    .map(item => [item.id, item])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), [resource.data, extra]);
  const groups = useMemo(() => notificationDateGroups(items, today), [items, today]);
  const readIds = read.scope === scope ? read.ids : [];

  async function loadMore() {
    if (!cursor || pending.current || resource.loading || resource.error) return;
    const requestGeneration = generation.current;
    const requestPage = pageGeneration.current;
    pending.current = true; setBusy('more'); setError('');
    try {
      const page = await employeeRequest<EmployeeInbox>({ action: 'employeeInbox', limit: 50, cursor });
      if (mounted.current && generation.current === requestGeneration && pageGeneration.current === requestPage) {
        if (page.nextCursor === cursor) throw new Error('Beskederne kunne ikke indlæses. Hent listen igen.');
        setMore({ scope, head, firstCursor, generation: resource.generation, items: [...(extra?.items ?? []), ...page.notifications], cursor: page.nextCursor });
      }
    } catch (cause) {
      if (mounted.current && generation.current === requestGeneration && pageGeneration.current === requestPage) {
        setError(cause instanceof Error ? cause.message : 'Beskederne kunne ikke hentes. Prøv igen.');
        setMore(undefined);
        invalidateEmployeeResources('inbox');
      }
    } finally { if (generation.current === requestGeneration) { pending.current = false; if (mounted.current) setBusy(null); } }
  }

  async function open(item: EmployeeWorkflowMessage) {
    if (pending.current) return;
    const requestGeneration = generation.current;
    const current = () => mounted.current && generation.current === requestGeneration;
    let acknowledged = false;
    pending.current = true; setBusy(item.id); setError('');
    try {
      // Read events need the same fresh authorization as unread events: the
      // planner may have removed or reassigned the shift since this row loaded.
      const receipt = await employeeRequest<{ messageId: string; readAt: string; target: unknown }>({ action: 'employeeInboxRead', messageId: item.id });
      if (!current()) return;
      if (receipt?.messageId !== item.id || typeof receipt.readAt !== 'string' || !Number.isFinite(Date.parse(receipt.readAt))) throw new Error('Beskeden kunne ikke åbnes. Prøv igen.');
      const target = parsePushTarget({ target: receipt.target });
      if (target.kind !== 'shift' && target.kind !== 'inbox') throw new Error('Beskeden kunne ikke åbnes. Prøv igen.');
      acknowledged = true;
      setRead(previous => ({ scope, ids: [...new Set([...(previous.scope === scope ? previous.ids : []), item.id])] }));
      if (target.kind === 'shift') router.push({ pathname: '/shift/[id]', params: { id: target.shiftId } });
      else if (item.kind === 'request') list.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : 'Beskeden kunne ikke åbnes. Prøv igen.');
    } finally {
      if (current()) {
        pending.current = false; setBusy(null);
        // Navigation is decided before a refresh changes the list generation.
        if (acknowledged) invalidateEmployeeResources('inbox');
      }
    }
  }

  return (
    <FlowScreen>
      <FlatList
        ref={list}
        contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}
        style={styles.screen} contentContainerStyle={styles.content}
        data={items} keyExtractor={item => item.id}
        refreshing={resource.refreshing} onRefresh={resource.refresh}
        ListHeaderComponent={<View style={styles.header}>
          <EmployeeShiftRequests />
          {resource.data && <Txt size={13} color={colors.muted}>{resource.data.unreadCount ? `${resource.data.unreadCount} ulæste` : 'Du er opdateret'}</Txt>}
          {(resource.error || error) && <View style={styles.feedback}>
            <Txt size={13} accessibilityRole="alert" color={colors.danger}>{error || resource.error}</Txt>
            {!!resource.error && <Button label="Prøv igen" compact variant="ghost" onPress={resource.refresh} />}
          </View>}
        </View>}
        ListEmptyComponent={resource.loading ? <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Txt size={13} color={colors.muted}>Henter beskeder…</Txt></View>
          : !resource.error ? <View style={cardStyles.listSurface}><EmptyState icon="bell" title="Her er stille lige nu" body="Her får du besked, når der er nyt om dine vagter." /></View> : null}
        ListFooterComponent={cursor ? <Button label={busy === 'more' ? 'Henter flere…' : 'Vis flere beskeder'} compact variant="ghost" disabled={busy !== null} onPress={() => { void loadMore(); }} style={styles.more} /> : null}
        renderItem={({ item, index }) => {
          const { heading, isLastInGroup } = groups[index];
          const seen = Boolean(item.readAt || readIds.includes(item.id));
          const after = item.after, before = item.before;
          const changedTime = Boolean(before && (!after || shiftLabel(before) !== shiftLabel(after)));
          const changedSite = before && after && before.siteName !== after.siteName;
          return (
            <View>
              {heading && <Txt accessibilityRole="header" size={13} weight="600" color={colors.muted} style={styles.groupHeading}>{heading}</Txt>}
              <PressFeedback haptic="light" accessibilityRole="button" disabled={busy !== null}
                accessibilityState={{ disabled: busy !== null, busy: busy === item.id }}
                accessibilityLabel={`${seen ? '' : 'Ulæst. '}${titles[item.kind] ?? 'Besked'}. ${item.summary}`}
                onPress={() => { void open(item); }}
                style={({ pressed }) => [styles.record, heading && styles.firstRecord, isLastInGroup && styles.lastRecord, pressed && styles.pressed]}>
                <View style={styles.icon}><Icon name={item.kind === 'request' ? 'file' : ['reminder', 'checkout_reminder'].includes(item.kind) ? 'clock' : 'calendar'} size={18}
                  color={['changed', 'moved', 'cancelled'].includes(item.kind) ? colors.danger : seen ? colors.muted : colors.accent} /></View>
                <View style={styles.message}>
                  <Row gap={8}><Txt size={15} weight={seen ? '600' : '700'} style={{ flex: 1 }}>{titles[item.kind] ?? 'Besked'}</Txt>
                    {!seen && <View style={styles.unreadDot} />}
                    {busy === item.id && <ActivityIndicator size="small" color={colors.accent} />}
                  </Row>
                  {item.kind === 'request' && <Txt size={13} color={colors.text}>{item.summary}</Txt>}
                  {before && changedTime && <Txt size={13} color={colors.muted} style={styles.struck}>{shiftLabel(before)}</Txt>}
                  {after && <Txt size={14} weight="500">{shiftLabel(after)}</Txt>}
                  {changedSite && before && <Txt size={12} color={colors.muted} style={styles.struck}>{before.siteName}</Txt>}
                  {(after || before) && <Txt size={13} color={colors.muted}>{(after ?? before)?.siteName}</Txt>}
                  {!after && !before && item.kind !== 'request' && <Txt size={13} color={colors.muted}>{item.summary}</Txt>}
                  <Txt size={11} color={colors.muted}>{Number.isFinite(Date.parse(item.createdAt)) ? timestamp.format(new Date(item.createdAt)) : ''}</Txt>
                </View>
                {(after || before) && <View style={styles.chevron}><Icon name="chevron-right" size={12} color={colors.muted} /></View>}
              </PressFeedback>
            </View>
          );
        }}
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },
  header: { paddingBottom: 12, gap: 8 },
  groupHeading: { paddingTop: 14, paddingBottom: 8, paddingHorizontal: 2 },
  feedback: { gap: 6 },
  loading: { padding: 24, alignItems: 'center', gap: 10 },
  record: { backgroundColor: colors.white, borderColor: cardColors.border, borderWidth: 1, borderBottomWidth: 0,
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 15 },
  firstRecord: { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderCurve: 'continuous' },
  lastRecord: { borderBottomWidth: 1, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderCurve: 'continuous' },
  pressed: { backgroundColor: colors.paper },
  icon: { minHeight: 22, justifyContent: 'center', alignItems: 'center', width: 23 },
  message: { flex: 1, minWidth: 0, gap: 5 },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  struck: { textDecorationLine: 'line-through' },
  chevron: { alignSelf: 'center' },
  more: { marginTop: 12 },
});
