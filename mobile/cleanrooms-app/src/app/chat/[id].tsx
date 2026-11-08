import { useLocalSearchParams } from 'expo-router';
import { useMobileAuth } from '@/auth/mobile-auth';
import DemoConversationScreen from '@/screens/conversation-screen';
import LiveConversationScreen from '@/screens/live-conversation-screen';

export default function ConversationRoute() {
  const { state } = useMobileAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (state.mode === 'signedIn') return <LiveConversationScreen key={`${state.session.employee.workspaceId}:${state.session.employee.personId}:${id}`} />;
  return state.mode === 'demo' ? <DemoConversationScreen /> : null;
}
