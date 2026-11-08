import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

const ReduceMotionContext = createContext(true);

export function MotionPreference({ children }: { children: ReactNode }) {
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let useInitialPreference = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      useInitialPreference = false;
      setReduceMotion(enabled);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (useInitialPreference) setReduceMotion(enabled);
    }).catch(() => {});
    return () => {
      useInitialPreference = false;
      subscription?.remove();
    };
  }, []);

  return <ReduceMotionContext value={reduceMotion}>{children}</ReduceMotionContext>;
}

export function useReduceMotionPreference() {
  return use(ReduceMotionContext);
}
