// Small per-viewer layout choices (the rail folded to icons, the chat drawer open) remembered in this browser. Phones,
// private windows, and blocked storage just get the default each time.
const store = (): Storage | null => {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = store()?.getItem(key);
    return v === "1" ? true : v === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean) {
  try {
    store()?.setItem(key, value ? "1" : "0");
  } catch {
    // Nothing to do: the choice just isn't remembered.
  }
}
