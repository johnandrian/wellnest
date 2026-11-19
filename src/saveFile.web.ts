// Files on the web: a text file the app made (a calendar file, an export) is downloaded. Phones: ./saveFile.ts.
// The web shows a PDF in the app's viewer (./FileViewer.tsx); this is the fallback, a new tab.
export async function openPdf(url: string, _name: string) {
  window.open(url, "_blank", "noopener");
}

export async function saveTextFile(name: string, text: string, mimeType: string, _uti?: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
