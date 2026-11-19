// The app lock's rules (./AppLock.tsx): a 4 to 6 digit PIN, locking again after a minute away, and a 30 second wait
// after 5 wrong tries.
export const LOCK_AFTER_MS = 60_000;
export const MAX_TRIES = 5;
export const WAIT_MS = 30_000;

export const validPin = (pin: string) => /^\d{4,6}$/.test(pin);

// Coming back to the app: lock when it was away (in the background) for a minute or more.
export const shouldLock = (hiddenAt: number | null, now: number) => hiddenAt !== null && now - hiddenAt >= LOCK_AFTER_MS;

// After a wrong PIN: how many tries are used, and until when entry waits.
export function afterWrong(tries: number, now: number): { tries: number; waitUntil: number | null } {
  const next = tries + 1;
  return next >= MAX_TRIES ? { tries: 0, waitUntil: now + WAIT_MS } : { tries: next, waitUntil: null };
}
