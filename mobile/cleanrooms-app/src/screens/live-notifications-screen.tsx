import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { useMobileAuth } from '@/auth/mobile-auth';
import { Button, EmptyState, Icon, Row, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { addDays, copenhagenDate, dateLabel, TIME_ZONE } from '@/domain/model';
import { useEmployeeWorkflow, type EmployeeWorkflow, type EmployeeWorkflowMessage, type EmployeeWorkflowShift } from '@/state/employee-data';
import { useNow } from '@/state/app-store';

const timestamp = new Intl.DateTimeFormat('da-DK', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const titles: Record<string, string> = { new: 'Ny vagt', changed: 'Vagt ændret', moved: 'Vagt flyttet', cancelled: 'Vagt aflyst', request: 'Vagtanmodning' };

function shiftLabel(shift: EmployeeWorkflowShift) {
  return `${dateLabel(shift.date, { weekday: 'short' })} · ${shift.start}–${shift.end}`;
}

export default function LiveNotificationsScreen() {
  const { state, employeeRequest } = useMobileAuth();
  const today = copenhagenDate(useNow());
  const from = addDays(today, -28), to = addDays(today, 27);
  const resource = useEmployeeWorkflow(from, to);
  const scope = state.mode === 'signedIn' ? JSON.stringify([state.session.employee.workspaceId, state.session.employee.personId, from, to]) : '';
  const head = resource.data?.notifications.map(item => item.id).join('|') ?? '';
  const firstCursor = resource.data?.pagination.messages ?? null;
  const [more, setMore] = useState<{ scope: string; head: string; firstCursor: string | null; items: EmployeeWorkflowMessage[]; cursor?: string | null }>();
  const [read, setRead] = useState<{ scope: string; ids: string[] }>({ scope: '', ids: [] });
  const [busy, setBusy] = useState<'more' | string | null>(null);
  const [error, setError] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const extra = more?.scope === scope && more.head === head && more.firstCursor === firstCursor ? more : undefined;
  const cursor = extra ? extra.cursor : resource.data?.pagination.messages;
  const items = useMemo(() => [...new Map([...(resource.data?.notifications ?? []), ...(extra?.items ?? [])]
    .map(item => [item.id, item])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), [resource.data, extra]);
  const readIds = read.scope === scope ? read.ids : [];

  async function loadMore() {
    if (!cursor || pending.current) return;
    pending.current = true; setBusy('more'); setError('');
    try {
      const page = await employeeRequest<EmployeeWorkflow>({ action: 'workflowRead', from, to, limit: 50, messageCursor: cursor });
      if (mounted.current) setMore({ scope, head, firstCursor, items: [...(extra?.items ?? []), ...page.notifications], cursor: page.pagination.messages });
    } catch (cause) {
      if (mounted.current) {
        setError(cause instanceof Error ? cause.message : 'Beskederne kunne ikke hentes. Prøv igen.');
        setMore(undefined);
        resource.refresh();
      }
    } finally { pending.current = false; if (mounted.current) setBusy(null); }
  }

  async function open(item: EmployeeWorkflowMessage) {
    if (pending.current) return;
    pending.current = true; setBusy(item.id); setError('');
    try {
      if (!item.readAt && !readIds.includes(item.id)) {
        await employeeRequest({ action: 'workflowReadMessage', messageId: item.id, from, to });
        if (!mounted.current) return;
        setRead(previous => ({ scope, ids: [...(previous.scope === scope ? previous.ids : []), item.id] }));
        resource.refresh();
      }
      const shift = item.after ?? item.before;
      if (shift && mounted.current) router.push({ pathname: '/shift/[id]', params: { id: shift.id } });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Beskeden kunne ikke åbnes. Prøv igen.');
    } finally { pending.current = false; if (mounted.current) setBusy(null); }
  }

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}
      style={styles.screen} contentContainerStyle={styles.content}
      data={items} keyExtractor={item => item.id}
      refreshing={resource.refreshing} onRefresh={resource.refresh}
      ListHeaderComponent={<View style={styles.header}>
        {resource.data && <Txt size={13} color={colors.muted}>{resource.data.unreadCount ? `${resource.data.unreadCount} ulæste` : 'Du er opdateret'}</Txt>}
        {(resource.error || error) && <View style={styles.feedback}>
          <Txt size={13} accessibilityRole="alert" color={colors.danger}>{error || resource.error}</Txt>
          {!!resource.error && <Button label="Prøv igen" compact variant="ghost" onPress={resource.refresh} />}
        </View>}
      </View>}
      ListEmptyComponent={resource.loading ? <View style={styles.loading}><ActivityIndicator color={colors.accent} /><Txt size={13} color={colors.muted}>Henter beskeder…</Txt></View>
        : !resource.error ? <View style={cardStyles.listSurface}><EmptyState icon="bell" title="Ingen notifikationer" /></View> : null}
      ListFooterComponent={cursor ? <Button label={busy === 'more' ? 'Henter flere…' : 'Vis flere beskeder'} compact variant="ghost" disabled={busy !== null} onPress={() => { void loadMore(); }} style={styles.more} /> : null}
      renderItem={({ item, index }) => {
        const seen = Boolean(item.readAt || readIds.includes(item.id));
        const after = item.after, before = item.before;
        const changedTime = Boolean(before && (!after || shiftLabel(before) !== shiftLabel(after)));
        const changedSite = before && after && before.siteName !== after.siteName;
        return <Pressable accessibilityRole="button" disabled={busy !== null}
          accessibilityState={{ disabled: busy !== null, busy: busy === item.id }}
          accessibilityLabel={`${seen ? '' : 'Ulæst. '}${titles[item.kind] ?? 'Besked'}. ${item.summary}`}
          onPress={() => { void open(item); }}
          style={({ pressed }) => [styles.record, index === 0 && styles.firstRecord, index === items.length - 1 && styles.lastRecord, pressed && styles.pressed]}>
          <View style={styles.icon}><Icon name={item.kind === 'request' ? 'file' : 'calendar'} size={18}
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
        </Pressable>;
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cardColors.canvas },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },
  header: { paddingBottom: 12, gap: 8 },
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
