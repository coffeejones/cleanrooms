import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useMobileAuth } from '@/auth/mobile-auth';
import { colors } from '@/constants/palette';
import { useAppData } from '@/state/app-store';
export default function AppTabs() {
  const { state: auth } = useMobileAuth();
  const { state } = useAppData();
  const unread = auth.mode === 'demo' ? state.messages.filter(m => m.personId !== state.selfId && !m.read).length : 0;
  return <NativeTabs tintColor={colors.accent} backgroundColor={colors.white} disableTransparentOnScrollEdge labelStyle={{ fontSize: 11 }}>
    <NativeTabs.Trigger name="(home)"><NativeTabs.Trigger.Label>Overblik</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="(calendar)"><NativeTabs.Trigger.Label>Kalender</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="(hours)"><NativeTabs.Trigger.Label>Timer</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf={{ default: 'clock', selected: 'clock.fill' }} md="schedule" /></NativeTabs.Trigger>
    <NativeTabs.Trigger name="(chat)"><NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label><NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="chat_bubble" />{unread > 0 && <NativeTabs.Trigger.Badge>{String(unread)}</NativeTabs.Trigger.Badge>}</NativeTabs.Trigger>
  </NativeTabs>;
}
