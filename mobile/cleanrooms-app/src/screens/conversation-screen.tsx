import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Row } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors as c } from '@/constants/palette';
import { useAppData } from '@/state/app-store';
import type { Message } from '@/domain/model';

function time(value: string) {
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { state, actions } = useAppData();
  const room = state.rooms.find((item) => item.id === id && item.memberIds.includes(state.selfId));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const list = useRef<FlatList<Message>>(null);
  const atBottom = useRef(true);
  const shouldScroll = useRef(true);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const messages = useMemo(() => state.messages.filter((message) => message.roomId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [id, state.messages]);

  useEffect(() => {
    if (room && messages.some((message) => message.personId !== state.selfId && !message.read)) actions.markRoomRead(room.id);
  }, [actions, messages, room, state.selfId]);

  const onContentSizeChange = useCallback(() => {
    if (shouldScroll.current || atBottom.current) {
      list.current?.scrollToEnd({ animated: !shouldScroll.current });
      shouldScroll.current = false;
    }
  }, []);

  if (!room) return <View style={[styles.canvas, styles.missing]}><Text selectable style={{ fontSize: 16, color: c.ink }}>Samtalen findes ikke.</Text></View>;

  const canSend = Boolean(draft.trim());

  function send() {
    const result = actions.sendMessage(id, draft);
    if (!result.ok) { setError(result.error ?? 'Beskeden kunne ikke sendes.'); return; }
    setDraft('');
    setError('');
    shouldScroll.current = true;
  }

  return (
    <KeyboardAvoidingView style={styles.canvas} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={process.env.EXPO_OS === 'ios' ? headerHeight : 0}>
      <Stack.Screen options={{ title: room.name, headerStyle: { backgroundColor: cardColors.canvas } }} />
      <Row gap={6} style={styles.roomMeta}>
        <Icon name="users" size={14} color={c.muted} />
        <Text selectable style={styles.memberCount}>{room.memberIds.length} medlemmer</Text>
      </Row>
      {room.pinned && <View style={[cardStyles.listSurface, styles.pinned]}>
        <Text style={styles.pinnedLabel}>FASTGJORT</Text>
        <Text selectable style={styles.pinnedText}>{room.pinned}</Text>
      </View>}
      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(message) => message.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={32}
        onScroll={(event) => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; atBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 72; }}
        ListEmptyComponent={<Text selectable style={{ color: c.muted, fontSize: 14 }}>Start samtalen med dit team.</Text>}
        renderItem={({ item, index }) => {
          const mine = item.personId === state.selfId;
          const person = state.people.find((entry) => entry.id === item.personId);
          const previous = messages[index - 1];
          const newDay = !previous || new Date(previous.createdAt).toLocaleDateString('da-DK', { timeZone: 'Europe/Copenhagen' }) !== new Date(item.createdAt).toLocaleDateString('da-DK', { timeZone: 'Europe/Copenhagen' });
          return <View style={{ gap: 12 }}>
            {newDay && <Text selectable style={{ textAlign: 'center', color: c.muted, fontSize: 11, fontWeight: '500', paddingVertical: 6 }}>{new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'long' }).format(new Date(item.createdAt))}</Text>}
            <View style={{ maxWidth: '86%', alignSelf: mine ? 'flex-end' : 'flex-start', gap: 5 }}>
              {!mine && <Text selectable style={{ color: c.muted, fontSize: 11, paddingLeft: 13 }}>{person?.name ?? 'Kollega'}</Text>}
              <View style={[styles.bubble, mine ? styles.sent : styles.received]}>
                <Text selectable style={{ color: mine ? '#fff' : c.ink, fontSize: 15, lineHeight: 22 }}>{item.text}</Text>
              </View>
              <Text style={{ alignSelf: mine ? 'flex-end' : 'flex-start', paddingHorizontal: 12, color: c.muted, fontSize: 10, fontVariant: ['tabular-nums'] }}>{time(item.createdAt)}</Text>
            </View>
          </View>;
        }}
      />
      <View style={[styles.composer, { paddingBottom: Math.max(12, insets.bottom) }]}>
        {!!error && <Text selectable accessibilityRole="alert" style={{ color: '#a34f3c', fontSize: 13 }}>{error}</Text>}
        <View style={styles.composerRow}>
          <View style={[cardStyles.raisedFrame, styles.inputFrame]}>
            <TextInput
              accessibilityLabel="Skriv besked"
              placeholder="Skriv til dit team…"
              placeholderTextColor={c.muted}
              value={draft}
              onChangeText={setDraft}
              multiline
              style={[cardStyles.raisedSurface, styles.input]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send besked"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            style={({ pressed }) => [styles.send, canSend && styles.sendReady, pressed && styles.sendPressed]}>
            <Icon name="send" size={20} color={canSend ? c.white : c.muted} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: cardColors.canvas },
  missing: { padding: 24 },
  roomMeta: { paddingHorizontal: 19, paddingTop: 4, paddingBottom: 10 },
  memberCount: { color: c.muted, fontSize: 12 },
  pinned: { marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  pinnedLabel: { color: c.accent, fontSize: 10, letterSpacing: 0.8, fontWeight: '700' },
  pinnedText: { color: c.ink, fontSize: 13, lineHeight: 19 },
  messages: { paddingHorizontal: 16, paddingVertical: 16, gap: 14, flexGrow: 1 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderCurve: 'continuous' },
  sent: { backgroundColor: c.accent, borderBottomRightRadius: 5 },
  received: { backgroundColor: c.white, borderBottomLeftRadius: 5, borderWidth: 1, borderColor: cardColors.border },
  composer: {
    backgroundColor: cardColors.section, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cardColors.border,
    paddingHorizontal: 16, paddingTop: 10, gap: 8,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  inputFrame: { flex: 1 },
  input: {
    minHeight: 44, maxHeight: 140, fontSize: 16, lineHeight: 22,
    paddingHorizontal: 13, paddingTop: 11, paddingBottom: 11, color: c.ink,
  },
  send: {
    width: 46, height: 46, borderRadius: 23, borderCurve: 'continuous', marginBottom: 2,
    borderWidth: 1, borderColor: cardColors.border, backgroundColor: c.paper,
    alignItems: 'center', justifyContent: 'center',
  },
  sendReady: { backgroundColor: c.accent, borderColor: c.accent },
  sendPressed: { opacity: 0.75 },
});
