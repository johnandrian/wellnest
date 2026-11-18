import { describe, expect, test } from "vitest";
import { joinTimes, nextTime, splitTimes } from "../src/times";

describe("medication reminder times", () => {
  test("split, sorted, padded, and without repeats", () => {
    expect(splitTimes("8:00, 20:00 08:00")).toEqual(["8:00", "20:00", "08:00"]);
    expect(joinTimes(["20:00", "8:00", "08:00"])).toBe("08:00, 20:00");
  });

  test("the next time offered is four hours after the last", () => {
    expect(nextTime([])).toBe("08:00");
    expect(nextTime(["08:00"])).toBe("12:00");
    expect(nextTime(["22:30"])).toBe("02:30");
  });
});
