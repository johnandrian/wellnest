// The printable medication list: medicine, strength / dose, when and how it's taken, and notes, one row each. Built
// from the user's medications in the Medications tool, or from what someone typed on the free /medication-list page.
// On the web it opens in a new tab with the print dialog (print or save as PDF); on phones it becomes a PDF to share.
import { Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import type { Strings } from "./i18n";

export type MedRow = { name: string; dose: string; when: string; notes: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cell = (s: string) => esc(s).replace(/\n/g, "<br>");

export function medListHtml(rows: MedRow[], s: Strings, who?: string): string {
  const date = new Date().toLocaleDateString(s.locale, { year: "numeric", month: "long", day: "numeric" });
  const body = rows
    .map((r) => `<tr><td class="name">${cell(r.name)}</td><td>${cell(r.dose)}</td><td>${cell(r.when)}</td><td>${cell(r.notes)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="${esc(s.locale)}"><head><meta charset="utf-8"><title>${esc(s.medList)}</title>
<style>
body{font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:960px;margin:28px auto;padding:0 20px}
h1{font-size:22px;color:#0B5D57;margin:0}
.meta{color:#4B5563;margin:4px 0 16px}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #D1D5DB;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#E4F4EC;color:#0B5D57;font-size:13px}
td.name{font-weight:600}
tr{break-inside:avoid}
.foot{color:#4B5563;font-size:12px;margin-top:14px}
@media print{body{margin:0}}
</style></head><body>
<h1>${esc(s.medList)}</h1>
<p class="meta">${[who?.trim() && esc(s.medListFor.replace("{name}", who.trim())), esc(s.medListUpdated.replace("{date}", date))].filter(Boolean).join(" · ")}</p>
<table><thead><tr><th>${esc(s.medListName)}</th><th>${esc(s.medListDose)}</th><th>${esc(s.medListWhen)}</th><th>${esc(s.medListNotes)}</th></tr></thead>
<tbody>${body}</tbody></table>
<p class="foot">${esc(s.medListFooter)}</p>
</body></html>`;
}

// Opens an HTML page to print or save as PDF. Throws `s.allowPopups` when the browser blocks the new tab.
export async function printHtml(html: string, s: Strings, title: string) {
  if (Platform.OS === "web") {
    const win = window.open("", "_blank");
    if (!win) throw new Error(s.allowPopups);
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: title });
  else await Print.printAsync({ uri });
}
