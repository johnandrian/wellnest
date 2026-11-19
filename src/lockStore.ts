// App lock on phones (Settings → Privacy, ./AppLock.tsx): a PIN kept in the phone's secure storage (Keychain or
// Keystore), plus Face ID, Touch ID, or a fingerprint when the phone has one set up. Nothing about it goes to the
// server. The web has no app lock (./lockStore.web.ts).
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

const KEY = "wellnest.appLock";
export type LockSettings = { pin: string; biometrics: boolean };
export const lockSupported = true;

const listeners = new Set<(l: LockSettings | null) => void>();
// The lock screen hears when Settings turns the lock on or off.
export const onLockChange = (fn: (l: LockSettings | null) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export async function readLock(): Promise<LockSettings | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as LockSettings) : null;
  } catch {
    return null;
  }
}

export async function saveLock(lock: LockSettings) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(lock));
  listeners.forEach((fn) => fn(lock));
}

export async function clearLock() {
  await SecureStore.deleteItemAsync(KEY);
  listeners.forEach((fn) => fn(null));
}

export async function biometricsAvailable() {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function checkBiometrics(prompt: string, cancel: string) {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: cancel, disableDeviceFallback: true });
    return result.success;
  } catch {
    return false;
  }
}
