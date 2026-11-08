import { router } from 'expo-router';
import { View } from 'react-native';
import { useMobileAuth } from '@/auth/mobile-auth';
import { IconButton } from '@/components/ui';
import { useAppData, useNow } from '@/state/app-store';
import { addDays, copenhagenDate } from '@/domain/model';
import { useEmployeeWorkflow } from '@/state/employee-data';

function DemoNotifications() {
  const { state } = useAppData();
  return <IconButton name="bell" label="Notifikationer" badge={state.notifications.some(n => !n.read)} onPress={() => router.push('/notifications')} />;
}

function EmployeeNotifications() {
  const today = copenhagenDate(useNow());
  const resource = useEmployeeWorkflow(addDays(today, -28), addDays(today, 27));
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
