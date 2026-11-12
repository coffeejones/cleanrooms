import { StyleSheet, Text, View } from 'react-native';

import { UnreadMessageDivider } from '@/components/unread-message-divider';
import { cardColors } from '@/constants/card-styles';
import { colors } from '@/constants/palette';
import { copenhagenDate, dateLabel, type Message } from '@/domain/model';
import type { LiveChatMessage } from '@/state/chat-wire';

type ChatMessage = Message | LiveChatMessage;

const groupInterval = 2 * 60_000;
const timeFormatter = new Intl.DateTimeFormat('da-DK', {
  timeZone: 'Europe/Copenhagen',
  hour: '2-digit',
  minute: '2-digit',
});

function authorId(message: ChatMessage) {
  return 'authorId' in message ? message.authorId : message.personId;
}

function sameGroup(older: ChatMessage | undefined, newer: ChatMessage | undefined, unreadId?: string) {
  if (!older || !newer || newer.id === unreadId || authorId(older) !== authorId(newer)) return false;
  // Keep a break when some messages between two loaded pages are still missing.
  if ('seq' in older && 'seq' in newer && newer.seq !== older.seq + 1) return false;
  const start = Date.parse(older.createdAt);
  const end = Date.parse(newer.createdAt);
  const gap = end - start;
  return gap >= 0 && gap <= groupInterval && copenhagenDate(start) === copenhagenDate(end);
}

export function ConversationMessage({ message, older, newer, unreadId, mine, authorName }: {
  message: ChatMessage;
  older?: ChatMessage;
  newer?: ChatMessage;
  unreadId?: string;
  mine: boolean;
  authorName: string;
}) {
  const continuesGroup = sameGroup(older, message, unreadId);
  const endsGroup = !sameGroup(message, newer, unreadId);
  const timestamp = Date.parse(message.createdAt);
  const day = copenhagenDate(timestamp);
  const newDay = !older || day !== copenhagenDate(Date.parse(older.createdAt));
  const time = timeFormatter.format(timestamp);

  return (
    <View style={[styles.message, older && (continuesGroup ? styles.withinGroup : styles.betweenGroups)]}>
      {newDay && <Text selectable style={styles.date}>{dateLabel(day, { month: 'long' })}</Text>}
      {message.id === unreadId && <UnreadMessageDivider />}
      <View style={[styles.body, mine ? styles.trailing : styles.leading]}>
        {!mine && !continuesGroup && <Text selectable aria-hidden style={styles.author}>{authorName}</Text>}
        <View style={[styles.bubble, mine ? styles.sent : styles.received]}>
          <Text
            selectable
            accessibilityLabel={`${mine ? 'Dig' : authorName}, ${time}. ${message.text}`}
            style={[styles.text, mine && styles.sentText]}
          >
            {message.text}
          </Text>
        </View>
        {endsGroup && <Text aria-hidden style={[styles.time, mine ? styles.trailing : styles.leading]}>{time}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  message: { gap: 12 },
  withinGroup: { paddingTop: 4 },
  betweenGroups: { paddingTop: 14 },
  date: { textAlign: 'center', color: colors.muted, fontSize: 11, fontWeight: '500', paddingVertical: 6 },
  body: { maxWidth: '86%', gap: 5 },
  leading: { alignSelf: 'flex-start' },
  trailing: { alignSelf: 'flex-end' },
  author: { color: colors.muted, fontSize: 11, paddingLeft: 13 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, borderCurve: 'continuous' },
  sent: { backgroundColor: colors.accent, borderBottomRightRadius: 5 },
  received: { backgroundColor: colors.white, borderBottomLeftRadius: 5, borderWidth: 1, borderColor: cardColors.border },
  text: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  sentText: { color: colors.white },
  time: { paddingHorizontal: 12, color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
});
