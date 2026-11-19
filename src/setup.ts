// Opening account setup from anywhere in the app (App.tsx provides it): "short" is the first-time setup, "rest" the
// parts it leaves out (from the dashboard's "Finish your profile" card), "full" everything (Settings → Redo setup).
import { createContext, useContext } from "react";

export type SetupMode = "short" | "rest" | "full";
export const SetupContext = createContext<(mode: SetupMode) => void>(() => {});
export const useOpenSetup = () => useContext(SetupContext);
