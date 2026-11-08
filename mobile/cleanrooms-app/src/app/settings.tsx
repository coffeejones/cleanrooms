import { useMobileAuth } from '@/auth/mobile-auth';
import AccountScreen from '@/screens/account-screen';
import DemoSettingsScreen from '@/screens/settings-screen';

export default function SettingsRoute() {
  const { state } = useMobileAuth();
  if (state.mode === 'signedIn') return <AccountScreen />;
  if (state.mode === 'demo') return <DemoSettingsScreen />;
  return null;
}
