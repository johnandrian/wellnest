// The web has no app lock: a browser has no secure storage for a PIN or a fingerprint reader the page can use.
// Phones: ./lockStore.ts.
export type LockSettings = { pin: string; biometrics: boolean };
export const lockSupported = false;
export const onLockChange = (_fn: (l: LockSettings | null) => void) => () => {};
export const readLock = async (): Promise<LockSettings | null> => null;
export const saveLock = async (_lock: LockSettings) => {};
export const clearLock = async () => {};
export const biometricsAvailable = async () => false;
export const checkBiometrics = async (_prompt: string, _cancel: string) => false;
