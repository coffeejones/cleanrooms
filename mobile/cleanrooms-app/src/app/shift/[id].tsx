import { useLocalSearchParams } from 'expo-router';
import { useMobileAuth } from '@/auth/mobile-auth';
import PublishedShiftScreen from '@/screens/published-shift-screen';
import DemoShiftScreen from '@/screens/shift-screen';

export default function ShiftRoute() {
  const { state } = useMobileAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  return state.mode === 'signedIn' ? <PublishedShiftScreen key={id} /> : <DemoShiftScreen />;
}
