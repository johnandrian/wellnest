// The page address on the web, for the few pages with their own URL (/privacy). Back and forward work; phones
// just keep it in memory.
import { useEffect, useState } from "react";
import { Platform } from "react-native";

const web = Platform.OS === "web";

export function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => (web ? window.location.pathname : "/"));
  useEffect(() => {
    if (!web) return;
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (next: string) => {
    if (web && window.location.pathname !== next) window.history.pushState(null, "", next);
    setPath(next);
  };
  return [path, go];
}
