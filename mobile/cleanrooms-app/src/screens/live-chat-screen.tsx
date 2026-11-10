import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { FlowScreen } from '@/components/flow-screen';
import { Avatar, EmptyState, Icon, Row } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { useLiveChatRooms } from '@/state/live-chat';

function messageTime(value?: string) {
  return value ? new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';
}

export default function LiveChatScreen() {
  const resource = useLiveChatRooms();
  const [query, setQuery] = useState('');
  const rooms = useMemo(() => (resource.data?.rooms ?? []).filter(room =>
    `${room.name} ${room.departmentName}`.toLocaleLowerCase('da-DK').includes(query.trim().toLocaleLowerCase('da-DK'))), [query, resource.data?.rooms]);

  return (
    <FlowScreen>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        contentContainerStyle={styles.content}
        data={rooms}
        keyExtractor={room => room.id}
        refreshControl={<RefreshControl refreshing={resource.refreshing ?? false} onRefresh={resource.refresh} />}
        ListHeaderComponent={<>
          <View style={[cardStyles.raisedFrame, styles.searchFrame]}>
            <Row gap={10} style={styles.search}>
              <Icon name="search" size={17} color={colors.muted} />
              <TextInput accessibilityLabel="Søg efter chatrum" placeholder="Søg i samtaler" placeholderTextColor={colors.muted}
                autoCorrect={false} value={query} onChangeText={setQuery} returnKeyType="search" style={styles.searchInput} />
            </Row>
          </View>
          {!!resource.error && <Row gap={8} style={styles.feedback} accessibilityLiveRegion="polite">
            <Text selectable style={styles.error}>{resource.error}</Text>
            <Pressable accessibilityRole="button" onPress={resource.refresh} style={styles.retry}><Text style={styles.link}>Prøv igen</Text></Pressable>
          </Row>}
        </>}
        ListEmptyComponent={resource.loading && !resource.data
          ? <View style={styles.loading}><ActivityIndicator color={colors.accent} accessibilityLabel="Henter samtaler" /></View>
          : !resource.error ? <View style={cardStyles.listSurface}><EmptyState icon="chat" title={query ? 'Ingen samtaler matcher' : 'Ingen samtaler endnu'} /></View> : null}
        ListFooterComponent={resource.data?.nextCursor ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: resource.more }}
          disabled={resource.more} onPress={resource.loadMore} style={styles.more}>
          {resource.more ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.link}>Vis flere samtaler</Text>}
        </Pressable> : null}
        renderItem={({ item: room, index }) => {
          const unread = room.unread;
          const initials = room.name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toUpperCase();
          return <Pressable accessibilityRole="button" accessibilityLabel={`${room.name}, ${unread ? `${unread} ulæste beskeder` : 'ingen ulæste beskeder'}`}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: room.id } })}
            style={({ pressed }) => [styles.room, index === 0 ? styles.firstRoom : cardStyles.divider, index === rooms.length - 1 && styles.lastRoom, pressed && styles.pressed]}>
            <Avatar initials={initials} size={40} />
            <View style={styles.details}>
              <Row gap={10}>
                <Text numberOfLines={1} style={styles.name}>{room.name}</Text>
                <Text style={[styles.time, unread > 0 && styles.unreadTime]}>{messageTime(room.lastMessage?.createdAt)}</Text>
              </Row>
              <Row gap={10}>
                <Text numberOfLines={2} style={[styles.preview, unread > 0 && styles.unreadPreview]}>
                  {room.lastMessage ? `${room.lastMessage.authorName.split(' ')[0]}: ${room.lastMessage.text}` : room.departmentName}
                </Text>
                {room.muted && <Icon name="bell" size={13} color={colors.muted} />}
                {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View>}
              </Row>
            </View>
          </Pressable>;
        }}
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  searchFrame: { marginBottom: 16 },
  search: { paddingHorizontal: 13 },
  searchInput: { flex: 1, minHeight: 46, paddingVertical: 10, color: colors.ink, fontSize: 16 },
  room: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74, paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: colors.white, borderColor: cardColors.border, borderLeftWidth: 1, borderRightWidth: 1, borderCurve: 'continuous' },
  firstRoom: { borderTopWidth: 1, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  lastRoom: { borderBottomWidth: 1, borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  pressed: { backgroundColor: cardColors.section },
  details: { flex: 1, minWidth: 0, gap: 4 },
  name: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: '600' },
  time: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  unreadTime: { color: colors.accent, fontWeight: '600' },
  preview: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 20 },
  unreadPreview: { color: colors.ink },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '600' },
  loading: { minHeight: 100, justifyContent: 'center' },
  feedback: { flexWrap: 'wrap', paddingHorizontal: 4, marginBottom: 12 },
  error: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
});
