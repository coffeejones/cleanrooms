import { Tabs, TabList, TabTrigger, TabSlot, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, View } from 'react-native';
import { useMobileAuth } from '@/auth/mobile-auth';
import { Icon, Txt } from '@/components/ui';
import { colors } from '@/constants/palette';
import { useAppData } from '@/state/app-store';
function TabButton({ children, isFocused, icon, badge, ...props }: TabTriggerSlotProps & { icon: string; badge?: boolean }) {
  return <Pressable {...props} accessibilityRole="tab" accessibilityState={{ selected: isFocused }} style={{ flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 4 }}><View><Icon name={icon} size={23} color={isFocused ? colors.accent : '#87919a'} />{badge && <View style={{ position: 'absolute', right: -2, top: -2, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger }} />}</View><Txt size={11} weight={isFocused ? '600' : '400'} color={isFocused ? colors.accent : colors.muted}>{children}</Txt></Pressable>;
}
export default function AppTabs() {
  const { state: auth } = useMobileAuth();
  const { state } = useAppData();
  const unread = auth.mode === 'demo' && state.messages.some(m => m.personId !== state.selfId && !m.read);
  return <Tabs><TabSlot style={{ flex: 1 }} /><TabList style={{ flexDirection: 'row', backgroundColor: colors.white, borderTopWidth: 1, borderColor: colors.line, paddingBottom: 8 }}><TabTrigger name="home" href="/" asChild><TabButton icon="home">Overblik</TabButton></TabTrigger><TabTrigger name="calendar" href="/calendar" asChild><TabButton icon="calendar">Kalender</TabButton></TabTrigger><TabTrigger name="hours" href="/hours" asChild><TabButton icon="clock">Timer</TabButton></TabTrigger><TabTrigger name="chat" href="/chat" asChild><TabButton icon="chat" badge={unread}>Chat</TabButton></TabTrigger></TabList></Tabs>;
}
