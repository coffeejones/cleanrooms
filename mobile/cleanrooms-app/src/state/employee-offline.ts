import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { EmployeeOfflineCache, offlineMaxBytes } from './employee-offline-cache';

const keyName = 'cleanrooms.employee-offline.key.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const filename = 'cleanrooms-employee-offline-v1.sealed';
const aad = (scope: string) => new TextEncoder().encode('cleanrooms.employee-offline.v1:' + scope);
async function encryptionKey(scope: string, create: boolean) {
  const raw = await SecureStore.getItemAsync(keyName, options);
  if (raw) {
    try { const value: unknown = JSON.parse(raw); if (value && typeof value === 'object' && 'scope' in value && value.scope === scope && 'key' in value && typeof value.key === 'string') return AESEncryptionKey.import(value.key, 'hex'); }
    catch { /* A changed credential or malformed key does not unlock another cache. */ }
  }
  if (!create) return null;
  const key = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(keyName, JSON.stringify({ scope, key: await key.encoded('hex') }), options);
  return key;
}
export const employeeOffline = new EmployeeOfflineCache({
  async read(scope) {
    const file = new File(Paths.cache, filename);
    if (!file.exists || !file.size || file.size > offlineMaxBytes + 1024) return null;
    const key = await encryptionKey(scope, false); if (!key) return null;
    try { const decrypted = await aesDecryptAsync(AESSealedData.fromCombined(await file.bytes()), key, { additionalData: aad(scope) }); return new TextDecoder().decode(decrypted); }
    catch { return null; }
  },
  async write(scope, value) {
    const key = await encryptionKey(scope, true); if (!key) throw Error('Offline key unavailable');
    const sealed = await aesEncryptAsync(new TextEncoder().encode(value), key, { additionalData: aad(scope) });
    const temporary = new File(Paths.cache, filename + '.' + randomUUID());
    try { temporary.create({ overwrite: true }); temporary.write(await sealed.combined()); await temporary.move(new File(Paths.cache, filename), { overwrite: true }); }
    finally { if (temporary.exists && temporary.name !== filename) temporary.delete(); }
  },
  async clear() {
    // Removing the key first makes interrupted deletion safe; ciphertext cannot
    // become readable when a future account is opened.
    try { await SecureStore.deleteItemAsync(keyName, options); }
    finally { const file = new File(Paths.cache, filename); if (file.exists) file.delete(); }
  },
});
export function offlineScope(origin: string, token: string) {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([origin, token]));
}
export function clearEmployeeOffline() { return employeeOffline.clear(); }
