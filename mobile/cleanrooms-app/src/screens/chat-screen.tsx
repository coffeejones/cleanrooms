import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useMobileAuth } from '@/auth/mobile-auth';
import LiveChatScreen from '@/screens/live-chat-screen';

import { Avatar, EmptyState, Icon, Row } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors as c } from '@/constants/palette';
import { useAppData } from '@/state/app-store';

function messageTime(value?: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function ChatScreen() {
  const { state } = useMobileAuth();
  if (state.mode === 'signedIn') return <LiveChatScreen />;
  return state.mode === 'demo' ? <DemoChatScreen /> : null;
}

function DemoChatScreen() {
  const { state } = useAppData();
  const [query, setQuery] = useState('');
  const rooms = useMemo(() => state.rooms
    .filter((room) => room.memberIds.includes(state.selfId))
    .filter((room) => `${room.name} ${room.subtitle}`.toLocaleLowerCase('da-DK').includes(query.toLocaleLowerCase('da-DK'))), [query, state.rooms, state.selfId]);

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      style={styles.canvas}
      contentContainerStyle={styles.content}
      data={rooms}
      keyExtractor={(room) => room.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={[cardStyles.raisedFrame, styles.searchFrame]}>
          <Row gap={10} style={[cardStyles.raisedSurface, styles.search]}>
            <Icon name="search" size={17} color={c.muted} />
            <TextInput
              accessibilityLabel="Søg efter chatrum"
              placeholder="Søg i samtaler"
              placeholderTextColor={c.muted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              returnKeyType="search"
              style={styles.searchInput}
            />
          </Row>
        </View>
      }
      ListEmptyComponent={
        <View style={cardStyles.listSurface}>
          <EmptyState icon="chat" title={query ? 'Ingen samtaler matcher' : 'Ingen samtaler'} />
        </View>
      }
      renderItem={({ item: room, index }) => {
        const messages = state.messages.filter((message) => message.roomId === room.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const last = messages[messages.length - 1];
        const author = last ? state.people.find((person) => person.id === last.personId) : undefined;
        const unread = messages.filter((message) => message.personId !== state.selfId && !message.read).length;
        const initials = room.name.split(' ').slice(0, 2).map((word) => word[0]).join('').toUpperCase();
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${room.name}, ${unread ? `${unread} ulæste beskeder` : 'ingen ulæste beskeder'}`}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: room.id } })}
            style={({ pressed }) => [
              styles.room,
              index === 0 ? styles.firstRoom : cardStyles.divider,
              index === rooms.length - 1 && styles.lastRoom,
              pressed && styles.roomPressed,
            ]}>
            <Avatar initials={initials} size={40} />
            <View style={styles.roomDetails}>
              <Row gap={10}>
                <Text numberOfLines={1} style={styles.roomName}>{room.name}</Text>
                <Text style={[styles.time, unread > 0 && styles.unreadTime]}>{messageTime(last?.createdAt)}</Text>
              </Row>
              <Row gap={10}>
                <Text numberOfLines={2} style={[styles.preview, unread > 0 && styles.unreadPreview]}>
                  {last ? `${last.personId === state.selfId ? 'Dig' : author?.name.split(' ')[0] ?? 'Kollega'}: ${last.text}` : room.subtitle}
                </Text>
                {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View>}
              </Row>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: cardColors.canvas },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
  searchFrame: { marginBottom: 16 },
  search: { paddingHorizontal: 13 },
  searchInput: { flex: 1, minHeight: 46, paddingVertical: 10, color: c.ink, fontSize: 16 },
  room: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68,
    paddingVertical: 13, paddingHorizontal: 14,
    backgroundColor: c.white, borderColor: cardColors.border, borderLeftWidth: 1, borderRightWidth: 1,
    borderCurve: 'continuous',
  },
  firstRoom: { borderTopWidth: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  lastRoom: { borderBottomWidth: 1, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  roomPressed: { backgroundColor: cardColors.section },
  roomDetails: { flex: 1, minWidth: 0, gap: 4 },
  roomName: { flex: 1, color: c.ink, fontWeight: '600', fontSize: 16 },
  time: { color: c.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  unreadTime: { color: c.accent, fontWeight: '600' },
  preview: { flex: 1, color: c.muted, fontSize: 14, lineHeight: 20 },
  unreadPreview: { color: c.ink },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: c.white, fontSize: 11, fontWeight: '600' },
});
