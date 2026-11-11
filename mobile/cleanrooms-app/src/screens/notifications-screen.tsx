import { FlatList, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { useMobileAuth } from '@/auth/mobile-auth';
import { FlowScreen } from '@/components/flow-screen';
import { NotificationShiftChange, notificationShiftChange } from '@/components/notification-shift-change';
import { PressFeedback } from '@/components/press-feedback';
import LiveNotificationsScreen from '@/screens/live-notifications-screen';

import { EmptyState, Icon, Row, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { TIME_ZONE, type AppNotification } from '@/domain/model';
import { notificationDateGroups } from '@/notifications/notification-date-groups';
import { useAppData } from '@/state/app-store';

const timestamp = new Intl.DateTimeFormat('da-DK', {
  timeZone: TIME_ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const icons = { chat: 'chat', request: 'file', system: 'bell', shift: 'calendar' };

export default function NotificationsScreen() {
  const { state } = useMobileAuth();
  return state.mode === 'signedIn' ? <LiveNotificationsScreen /> : state.mode === 'demo' ? <DemoNotificationsScreen /> : null;
}

function DemoNotificationsScreen() {
  const { state, actions } = useAppData();
  const items = useMemo(() => [...state.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.notifications]);
  const groups = useMemo(() => notificationDateGroups(items, state.today), [items, state.today]);
  const unread = items.filter((item) => !item.read);

  function open(item: AppNotification) {
    actions.markNotificationRead(item.id);
    if (item.shiftId) router.push({ pathname: '/shift/[id]', params: { id: item.shiftId } });
    else if (item.roomId) router.push({ pathname: '/chat/[id]', params: { id: item.roomId } });
  }

  return (
    <FlowScreen>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        style={styles.screen}
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={items.length > 0 ? (
          <Row gap={10} style={styles.listHeader}>
            <Txt size={14} weight="600" style={styles.headerLabel}>
              {unread.length ? `${unread.length} ulæste` : 'Du er opdateret'}
            </Txt>
            <PressFeedback haptic="selection"
              accessibilityRole="button"
              disabled={unread.length === 0}
              onPress={() => unread.forEach((item) => actions.markNotificationRead(item.id))}
              style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}
            >
              <Txt size={13} weight="600" color={unread.length ? colors.accent : colors.muted}>Markér alle som læst</Txt>
            </PressFeedback>
          </Row>
        ) : null}
        ListEmptyComponent={
          <View style={cardStyles.listSurface}><EmptyState icon="bell" title="Her er stille lige nu" body="Her får du besked, når der er nyt om dine vagter." /></View>
        }
        renderItem={({ item, index }) => {
          const { heading, isLastInGroup } = groups[index];
          const change = item.shiftChange ? notificationShiftChange(item.shiftChange.before, item.shiftChange.after) : null;
          return (
            <View>
              {heading && <Txt accessibilityRole="header" size={13} weight="600" color={colors.muted} style={styles.groupHeading}>{heading}</Txt>}
              <PressFeedback haptic="light"
                accessibilityRole="button"
                accessibilityLabel={`${!item.read ? 'Ulæst. ' : ''}${item.title}. ${change?.spoken ?? item.body}`}
                onPress={() => open(item)}
                style={({ pressed }) => [
                  styles.record, cardStyles.divider, heading && styles.firstRecord, isLastInGroup && styles.lastRecord, pressed && styles.pressed,
                ]}
              >
                <View style={styles.icon}>
                  <Icon name={icons[item.kind]} size={17} color={item.read ? colors.muted : colors.accent} />
                </View>
                <View style={styles.message}>
                  <Row gap={7}>
                    <Txt size={15} weight={item.read ? '600' : '700'} style={styles.messageTitle}>{item.title}</Txt>
                    {!item.read && <View style={styles.unreadDot} />}
                  </Row>
                  {change ? <NotificationShiftChange change={change} /> : <Txt size={13} color={colors.muted}>{item.body}</Txt>}
                  <Txt size={11} color={colors.muted}>{timestamp.format(new Date(item.createdAt))}</Txt>
                </View>
                {(item.shiftId || item.roomId) && (
                  <View style={styles.chevron}><Icon name="chevron-right" size={12} color={colors.muted} /></View>
                )}
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
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
  listHeader: {
    justifyContent: 'space-between', flexWrap: 'wrap', paddingHorizontal: 14, paddingVertical: 2,
    backgroundColor: cardColors.section, borderWidth: 1, borderColor: cardColors.border,
    borderRadius: 14, borderCurve: 'continuous',
  },
  headerLabel: { flexShrink: 1 },
  groupHeading: { paddingTop: 14, paddingBottom: 8, paddingHorizontal: 2 },
  markAll: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 7 },
  pressed: { backgroundColor: colors.paper },
  record: {
    backgroundColor: colors.white, borderLeftWidth: 1, borderRightWidth: 1, borderColor: cardColors.border,
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 13,
  },
  firstRecord: { borderTopWidth: 1, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderCurve: 'continuous' },
  lastRecord: { borderBottomWidth: 1, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, borderCurve: 'continuous' },
  icon: { minHeight: 22, justifyContent: 'center', alignItems: 'center', width: 23 },
  message: { flex: 1, minWidth: 0, gap: 3 },
  messageTitle: { flex: 1, minWidth: 0 },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  chevron: { alignSelf: 'center' },
});
