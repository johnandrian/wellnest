// Scanning a pill bottle or pharmacy label (convex/medScan.ts): take or pick a photo, upload it, and get back what the
// label says to fill in a medication form. Used by the Medications tool and account setup.
import { useState } from "react";
import { Platform } from "react-native";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Strings } from "./i18n";
import { pickPhoto, uploadPhoto } from "./photo";

export type Label = NonNullable<FunctionReturnType<typeof api.medScan.read>>;

// "Twice a day" on a label: reminder times to start from, changed in the form if they don't suit.
export const TIMES_FOR = ["08:00", "08:00, 20:00", "08:00, 14:00, 20:00", "08:00, 12:00, 16:00, 20:00"];
export const timesFor = (perDay: number) => TIMES_FOR[Math.min(perDay, TIMES_FOR.length) - 1];

const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];

export function useLabelScan(s: Strings, onLabel: (label: Label) => void) {
  const uploadUrl = useMutation(api.chat.generateUploadUrl);
  const claim = useMutation(api.chat.claimUpload);
  const read = useAction(api.medScan.read);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async () => {
    setError(null);
    try {
      const photo = await pickPhoto(Platform.OS === "web" ? "library" : "camera");
      if (!photo) return;
      setScanning(true);
      const storageId = await uploadPhoto(photo, () => uploadUrl(), (sid) => claim({ storageId: sid as Id<"_storage"> }));
      const label = await read({ storageId: storageId as Id<"_storage"> });
      if (label) onLabel(label);
      else setError(s.medScanNone);
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setScanning(false);
    }
  };

  return { scan, scanning, error, clearError: () => setError(null) };
}
