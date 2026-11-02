// A printable HTML page from the simple Markdown the assistant writes (headings, bullets, **bold**, *italic*, links).

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w_])_(?!\s)([^_]+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const line of md.split("\n")) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (heading) {
      close();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      const kind = /\d/.test(bullet[1]) ? "ol" : "ul";
      if (list !== kind) {
        close();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline(bullet[2])}</li>`);
    } else if (line.trim()) {
      close();
      out.push(`<p>${inline(line)}</p>`);
    } else {
      close();
    }
  }
  close();
  return out.join("\n");
}

export function printablePage(title: string, md: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:720px;margin:32px auto;padding:0 20px}
h1{font-size:22px;color:#0B5D57;margin:0 0 4px}h2{font-size:16px;margin:20px 0 6px;border-bottom:1px solid #D1D5DB;padding-bottom:3px}
h3{font-size:15px}ul,ol{margin:4px 0 8px;padding-left:22px}li{margin:2px 0}p{margin:6px 0}a{color:#0B5D57}
@media print{body{margin:0}}
</style></head><body>${markdownToHtml(md)}</body></html>`;
}
