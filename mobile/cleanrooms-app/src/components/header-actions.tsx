import { router } from 'expo-router';
import { View } from 'react-native';
import { useMobileAuth } from '@/auth/mobile-auth';
import { IconButton } from '@/components/ui';
import { useAppData } from '@/state/app-store';
import { useEmployeeInbox } from '@/state/employee-data';

function DemoNotifications() {
  const { state } = useAppData();
  return <IconButton name="bell" label="Notifikationer" badge={state.notifications.some(n => !n.read)} onPress={() => router.push('/notifications')} />;
}

function EmployeeNotifications() {
  const resource = useEmployeeInbox();
  return <IconButton name="bell" label="Notifikationer" badge={(resource.data?.unreadCount ?? 0) > 0} onPress={() => router.push('/notifications')} />;
}

export function HeaderActions() {
  const { state } = useMobileAuth();
  return (
    <View style={{ flexDirection: 'row' }}>
      {state.mode === 'demo' && <DemoNotifications />}
      {state.mode === 'signedIn' && <EmployeeNotifications />}
      <IconButton name="settings" label="Indstillinger" onPress={() => router.push('/settings')} />
    </View>
  );
}
