import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import { useMobileAuth } from '@/auth/mobile-auth';
import LiveChatScreen from '@/screens/live-chat-screen';

import { FlowScreen } from '@/components/flow-screen';
import { ChatRoomPreview } from '@/components/chat-room-preview';
import { ChatRoomTitle, chatRoomSearchPattern } from '@/components/chat-room-title';
import { ChatSearchField, useChatSearchMotion } from '@/components/chat-search-field';
import { PressFeedback } from '@/components/press-feedback';
import { Avatar, EmptyState, Row } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors as c } from '@/constants/palette';
import { chatListTimestamp } from '@/domain/chat-list-timestamp';
import { useAppData } from '@/state/app-store';
import { chatDraftPreview } from '@/state/private-draft-store';

export default function ChatScreen() {
  const { state } = useMobileAuth();
  if (state.mode === 'signedIn') return <LiveChatScreen />;
  return state.mode === 'demo' ? <DemoChatScreen /> : null;
}

function DemoChatScreen() {
  const { state, demoChatDrafts } = useAppData();
  const [query, setQuery] = useState('');
  const searchMotion = useChatSearchMotion(query);
  const pattern = useMemo(() => chatRoomSearchPattern(query), [query]);
  const rooms = useMemo(() => state.rooms
    .filter((room) => room.memberIds.includes(state.selfId))
    .filter((room) => !pattern || pattern.test(`${room.name} ${room.subtitle}`)), [pattern, state.rooms, state.selfId]);

  return (
    <FlowScreen>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        style={styles.canvas}
        contentContainerStyle={styles.content}
        data={rooms}
        keyExtractor={(room) => room.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<ChatSearchField value={query} onChangeText={setQuery} />}
        ListEmptyComponent={
          <Animated.View style={[cardStyles.listSurface, searchMotion]}>
            <EmptyState icon="chat" compact={Boolean(query)}
              title={query ? 'Ingen samtaler fundet' : 'Her begynder samtalen'}
              body={query ? 'Prøv et andet navn eller en anden afdeling.' : 'Dine samtaler med teamet samles her.'} />
          </Animated.View>
        }
        renderItem={({ item: room, index }) => {
          const messages = state.messages.filter((message) => message.roomId === room.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          const last = messages[messages.length - 1];
          const author = last ? state.people.find((person) => person.id === last.personId) : undefined;
          const unread = messages.filter((message) => message.personId !== state.selfId && !message.read).length;
          const draft = chatDraftPreview(demoChatDrafts.get(room.id) ?? '');
          const timestamp = chatListTimestamp(last?.createdAt, state.today);
          const preview = last ? `${last.personId === state.selfId ? 'Dig' : author?.name.split(' ')[0] ?? 'Kollega'}: ${last.text}` : room.subtitle;
          const initials = room.name.split(' ').slice(0, 2).map((word) => word[0]).join('').toUpperCase();
          return (
            <Animated.View style={searchMotion}>
              <PressFeedback
                accessibilityRole="button"
                accessibilityLabel={`${room.name}, ${unread ? `${unread} ulæste beskeder` : 'ingen ulæste beskeder'}${draft ? ', kladde' : ''}${timestamp ? `, seneste besked ${timestamp}` : ''}`}
                haptic="light"
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
                    <ChatRoomTitle name={room.name} pattern={pattern} style={styles.roomName} />
                    {timestamp ? <Text style={[styles.time, unread > 0 && styles.unreadTime]}>{timestamp}</Text> : null}
                  </Row>
                  <Row gap={10}>
                    <ChatRoomPreview draft={draft} text={preview} style={[styles.preview, !draft && unread > 0 && styles.unreadPreview]} />
                    {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View>}
                  </Row>
                </View>
              </PressFeedback>
            </Animated.View>
          );
        }}
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
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
