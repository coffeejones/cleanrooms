// Account teardown is synchronous before its first await. This also cancels a token
// registration or notification-open read that is already in flight.
const listeners = new Set<(remote: boolean) => Promise<void>>();
export function onPushAccountClosing(listener: (remote: boolean) => Promise<void>) {
  listeners.add(listener);return () => { listeners.delete(listener); };
}
export async function closePushAccount(remote = true) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...listeners].map(listener => listener(remote))),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
