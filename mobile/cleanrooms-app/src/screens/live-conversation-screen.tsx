import { Stack, useLocalSearchParams } from 'expo-router';
import { BottomSheet, RNHostView, ScrollView as NativeScrollView } from '@expo/ui';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConversationLatestButton, latestMessageThreshold } from '@/components/conversation-latest-button';
import { ConversationMessage } from '@/components/conversation-message';
import { ConversationSendError } from '@/components/conversation-send-error';
import { FlowScreen } from '@/components/flow-screen';
import { Icon, IconButton, Row, Txt } from '@/components/ui';
import { cardColors, cardStyles } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { firstUnreadLiveMessageId, type LiveUnreadSnapshot } from '@/state/chat-unread';
import { useLiveConversation, type LiveChatMessage } from '@/state/live-chat';

const viewability = { itemVisiblePercentThreshold: 60, minimumViewTime: 500 };

export default function LiveConversationScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const conversation = useLiveConversation(id ?? '');
  const detail = conversation.data;
  const { draft, setDraft } = conversation;
  const [selectedPin, setSelectedPin] = useState<LiveChatMessage | null>(null);
  const [latestWhenAway, setLatestWhenAway] = useState<number | null>(null);
  const list = useRef<FlatList<LiveChatMessage>>(null);
  const atBottom = useRef(true);
  const previousLatest = useRef(0);
  const mark = useRef(conversation.markRead);
  useLayoutEffect(() => { mark.current = conversation.markRead; }, [conversation.markRead]);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [unreadAtOpen, setUnreadAtOpen] = useState<(LiveUnreadSnapshot & { roomId: string })>();
  if (unreadAtOpen?.roomId !== detail?.room.id || unreadAtOpen?.viewerId !== detail?.viewer.userId) {
    setUnreadAtOpen(detail ? {
      roomId: detail.room.id,
      viewerId: detail.viewer.userId,
      unread: detail.room.unread,
      latestSeq: detail.room.latestSeq,
    } : undefined);
  }
  const unreadMessageId = useMemo(() => unreadAtOpen && firstUnreadLiveMessageId(detail?.messages ?? [], unreadAtOpen), [detail?.messages, unreadAtOpen]);
  const messages = useMemo(() => [...(detail?.messages ?? [])].reverse(), [detail?.messages]);
  const latest = detail?.messages.at(-1)?.seq ?? 0;
  const hasNewMessages = latestWhenAway !== null &&
    (messages.find(message => message.authorId !== detail?.viewer.userId)?.seq ?? 0) > latestWhenAway;
  useEffect(() => {
    if (latest > previousLatest.current && atBottom.current) {
      const first = previousLatest.current === 0;
      const frame = requestAnimationFrame(() => list.current?.scrollToOffset({ offset: 0, animated: !first }));
      previousLatest.current = latest;
      return () => cancelAnimationFrame(frame);
    }
    previousLatest.current = latest;
  }, [latest]);
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<LiveChatMessage>[] }) => {
    const throughSeq = Math.max(0, ...viewableItems.filter(item => item.isViewable).map(item => item.item.seq));
    if (throughSeq) mark.current(throughSeq);
  }, []);

  async function send() {
    if (await conversation.send(draft)) {
      atBottom.current = true;
      requestAnimationFrame(() => list.current?.scrollToOffset({ offset: 0, animated: true }));
    }
  }

  const canSend = Boolean(draft.trim()) && !conversation.sending && conversation.draftReady && conversation.sendRetryReady;

  return <KeyboardAvoidingView style={styles.screen} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
    keyboardVerticalOffset={process.env.EXPO_OS === 'ios' ? headerHeight : 0}>
    <Stack.Screen options={{ title: detail?.room.name ?? 'Samtale', headerStyle: { backgroundColor: cardColors.canvas } }} />
    {detail && <Row gap={6} style={styles.metadata}>
      <Icon name="users" size={14} color={colors.muted} />
      <Text selectable style={styles.memberCount}>{detail.room.memberCount} medlemmer</Text>
      <Text selectable numberOfLines={1} style={styles.department}>{detail.room.departmentName}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={detail.room.muted ? 'Slå notifikationer til for samtalen' : 'Gør samtalen lydløs'}
        accessibilityState={{ disabled: conversation.muting }} disabled={conversation.muting} onPress={() => { void conversation.mute(); }} style={styles.mute}>
        <Text style={styles.link}>{detail.room.muted ? 'Slå lyd til' : 'Lydløs'}</Text>
      </Pressable>
    </Row>}
    {detail?.pins.map(pin => <Pressable key={pin.id} accessibilityRole="button" accessibilityLabel={`Åbn fastgjort besked fra ${pin.authorName}`}
      onPress={() => setSelectedPin(pin)} style={[cardStyles.listSurface, styles.pinned]}>
      <Text style={styles.pinnedLabel}>FASTGJORT</Text><Text numberOfLines={2} style={styles.pinnedText}>{pin.text}</Text>
    </Pressable>)}
    {!!(conversation.error || conversation.draftError) && <Row gap={8} style={styles.feedback} accessibilityLiveRegion="polite">
      <Text selectable style={styles.error}>{conversation.error || conversation.draftError}</Text>
      <Pressable accessibilityRole="button" onPress={() => { conversation.refresh(); if (conversation.draftError) conversation.retryDraft(); }} style={styles.retry}><Text style={styles.link}>Prøv igen</Text></Pressable>
    </Row>}
    <FlowScreen>
      {conversation.loading && !detail ? <View style={styles.loading}><ActivityIndicator color={colors.accent} accessibilityLabel="Henter beskeder" /></View> : <FlatList
        ref={list} inverted data={messages} keyExtractor={item => item.id}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
        onViewableItemsChanged={onViewable} viewabilityConfig={viewability}
        scrollEventThrottle={32}
        onScroll={({ nativeEvent: { contentOffset } }) => {
          const nearLatest = contentOffset.y < latestMessageThreshold;
          atBottom.current = nearLatest;
          setLatestWhenAway(previous => nearLatest ? null : previous ?? latest);
        }}
        ListEmptyComponent={!conversation.error ? <Text selectable style={styles.empty}>Start samtalen med dit team.</Text> : null}
        ListFooterComponent={detail?.nextCursor ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: conversation.more }} disabled={conversation.more}
          onPress={conversation.loadOlder} style={styles.older}>{conversation.more ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.link}>Ældre beskeder</Text>}</Pressable> : null}
        renderItem={({ item, index }) => (
          <ConversationMessage
            message={item}
            older={messages[index + 1]}
            newer={messages[index - 1]}
            unreadId={unreadMessageId}
            mine={item.authorId === detail?.viewer.userId}
            authorName={item.authorName}
          />
        )}
      />}
      {latestWhenAway !== null && messages.length > 0 && (
        <ConversationLatestButton hasNewMessages={hasNewMessages}
          onJump={animated => list.current?.scrollToOffset({ offset: 0, animated })} />
      )}
    </FlowScreen>
    {detail && <View style={[styles.composer, { paddingBottom: Math.max(12, insets.bottom) }]}>
      {!!conversation.sendError && <ConversationSendError error={conversation.sendError} disabled={!canSend} onRetry={() => { void send(); }} />}
      <View style={styles.composerRow}>
        <View style={[cardStyles.raisedFrame, styles.inputFrame]}>
          <TextInput accessibilityLabel="Skriv besked" placeholder="Skriv til dit team…" placeholderTextColor={colors.muted}
            value={draft} onChangeText={setDraft} multiline editable={!conversation.sending && conversation.draftReady} maxLength={10_000}
            style={[cardStyles.raisedSurface, styles.input]} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={conversation.sending ? 'Sender besked' : 'Send besked'}
          accessibilityState={{ disabled: !canSend, busy: conversation.sending }}
          disabled={!canSend} onPress={() => { void send(); }}
          style={({ pressed }) => [styles.send, canSend && styles.sendReady, pressed && styles.pressed]}>
          {conversation.sending ? <ActivityIndicator color={colors.muted} /> : <Icon name="send" size={20} color={canSend ? colors.white : colors.muted} />}
        </Pressable>
      </View>
    </View>}
    <BottomSheet isPresented={Boolean(detail && selectedPin)} onDismiss={() => setSelectedPin(null)} snapPoints={['half', 'full']}
      containerColor={colors.white} contentPadding={{ top: 12, bottom: 20, left: 20, right: 20 }}>
      <NativeScrollView showsIndicators>
        <RNHostView matchContents={{ vertical: true }}>
          <View style={{ gap: 14 }}>
            <Row gap={12}>
              <Txt size={18} weight="600" accessibilityRole="header" style={{ flex: 1 }}>Fastgjort besked</Txt>
              <IconButton name="x" label="Luk besked" onPress={() => setSelectedPin(null)} />
            </Row>
            <Txt size={13} color={colors.muted}>{selectedPin?.authorName}</Txt>
            <Txt size={15} style={{ lineHeight: 23 }}>{selectedPin?.text}</Txt>
          </View>
        </RNHostView>
      </NativeScrollView>
    </BottomSheet>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: cardColors.canvas },
  metadata: { paddingHorizontal: 19, paddingTop: 0, paddingBottom: 4, flexWrap: 'wrap' },
  memberCount: { color: colors.muted, fontSize: 12 },
  department: { flex: 1, textAlign: 'right', color: colors.muted, fontSize: 12 },
  mute: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' },
  pinned: { marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  pinnedLabel: { color: colors.accent, fontSize: 10, letterSpacing: 0.8, fontWeight: '600' },
  pinnedText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  messages: { paddingHorizontal: 16, paddingVertical: 16, flexGrow: 1 },
  composer: { backgroundColor: cardColors.section, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: cardColors.border,
    paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  inputFrame: { flex: 1 },
  input: { minHeight: 44, maxHeight: 140, fontSize: 16, lineHeight: 22, paddingHorizontal: 13, paddingTop: 11, paddingBottom: 11, color: colors.ink },
  send: { width: 46, height: 46, borderRadius: 23, borderCurve: 'continuous', marginBottom: 2, borderWidth: 1,
    borderColor: cardColors.border, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  sendReady: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.72 },
  loading: { flex: 1, justifyContent: 'center' },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 18 },
  feedback: { paddingHorizontal: 16, paddingVertical: 8, minHeight: 44 },
  error: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  older: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 22 },
});
