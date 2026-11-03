// Photos for the chat: pick or take one, shrink it to at most 1600px (enough to read a label), and upload it to
// Convex file storage. The returned storage id is sent with the message (convex/chat.ts send).
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

const MAX_SIDE = 1600;

export type Picked = { uri: string; width: number; height: number };

export async function pickPhoto(source: "library" | "camera"): Promise<Picked | null> {
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Camera access is off. Turn it on in Settings to take a photo.");
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8, allowsEditing: false };
  const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return shrink({ uri: asset.uri, width: asset.width, height: asset.height });
}

async function shrink(p: Picked): Promise<Picked> {
  const scale = Math.min(1, MAX_SIDE / Math.max(p.width || MAX_SIDE, p.height || MAX_SIDE));
  // On web the picker already gives a data URL the browser can upload as is when it's small enough.
  if (scale === 1 && Platform.OS === "web") return p;
  const ctx = ImageManipulator.manipulate(p.uri);
  if (scale < 1) ctx.resize({ width: Math.round(p.width * scale) });
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

export function uploadPhoto(photo: Picked, uploadUrl: () => Promise<string>, claim: (storageId: string) => Promise<unknown>): Promise<string> {
  return uploadFile(photo.uri, "image/jpeg", uploadUrl, claim);
}

// Any picked file (a photo, or a PDF from expo-document-picker); `type` when the file doesn't say.
export async function uploadFile(
  uri: string,
  type: string,
  uploadUrl: () => Promise<string>,
  claim: (storageId: string) => Promise<unknown>,
): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const res = await fetch(await uploadUrl(), {
    method: "POST",
    headers: { "Content-Type": blob.type || type },
    body: blob,
  });
  if (!res.ok) throw new Error("The photo didn't upload. Please try again.");
  const { storageId } = (await res.json()) as { storageId: string };
  await claim(storageId);
  return storageId;
}
