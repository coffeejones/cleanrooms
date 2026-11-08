import type { ReactNode } from 'react';
import { useMobileAuth } from '@/auth/mobile-auth';

export function EmployeeSection({ children }: { section: 'overview' | 'calendar' | 'hours' | 'chat'; children: ReactNode }) {
  const { state } = useMobileAuth();
  return state.mode === 'demo' || state.mode === 'signedIn' ? children : null;
}
