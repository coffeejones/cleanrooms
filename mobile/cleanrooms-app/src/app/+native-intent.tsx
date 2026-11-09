import { sanitizeNativePath } from '@/state/native-path';

export function redirectSystemPath({ path }: { path: string }) {
  return sanitizeNativePath(path);
}
