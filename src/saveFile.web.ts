// Saving a text file the app made (a calendar file, an export) on the web: a download. Phones: ./saveFile.ts.
export async function saveTextFile(name: string, text: string, mimeType: string, _uti?: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
