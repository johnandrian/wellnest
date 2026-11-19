// The app lock's rules (src/lockRules.ts).
import { describe, expect, test } from "vitest";
import { afterWrong, LOCK_AFTER_MS, shouldLock, validPin, WAIT_MS } from "../src/lockRules";

describe("app lock", () => {
  test("a PIN is 4 to 6 digits", () => {
    expect(["1234", "123456"].map(validPin)).toEqual([true, true]);
    expect(["123", "1234567", "12a4", ""].map(validPin)).toEqual([false, false, false, false]);
  });

  test("locks again only after a minute away", () => {
    expect(shouldLock(null, 1_000_000)).toBe(false);
    expect(shouldLock(1_000_000, 1_000_000 + LOCK_AFTER_MS - 1)).toBe(false);
    expect(shouldLock(1_000_000, 1_000_000 + LOCK_AFTER_MS)).toBe(true);
  });

  test("5 wrong PINs wait 30 seconds and start the count again", () => {
    let state = { tries: 0, waitUntil: null as number | null };
    for (let i = 0; i < 4; i++) state = afterWrong(state.tries, 0);
    expect(state).toEqual({ tries: 4, waitUntil: null });
    expect(afterWrong(state.tries, 100)).toEqual({ tries: 0, waitUntil: 100 + WAIT_MS });
  });
});
