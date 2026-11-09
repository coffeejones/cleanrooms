import { useCallback, useState, type SetStateAction } from 'react';

/** An old page's UI receipt is never carried into a refreshed generation. */
export function useScopedState<T>(scope: string, initial: T) {
  const [stored, setStored] = useState({ scope, value: initial });
  const value = stored.scope === scope ? stored.value : initial;
  const setValue = useCallback((next: SetStateAction<T>) => {
    setStored(previous => ({ scope, value: typeof next === 'function'
      ? (next as (value: T) => T)(previous.scope === scope ? previous.value : initial) : next }));
  }, [initial, scope]);
  return [value, setValue] as const;
}
