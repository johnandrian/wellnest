// Saving a text file the app made (a calendar file, an export) on a phone: a file in the cache handed to the share
// sheet, where it can be opened in Calendar, saved to Files, or sent on. The web downloads it (./saveFile.web.ts).
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

export async function saveTextFile(name: string, text: string, mimeType: string, uti?: string) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(file.uri, { mimeType, ...(uti && { UTI: uti }), dialogTitle: name });
}
