/**
 * Bağımlılıksız .xlsx okuyucu (yalnız okuma, ilk sayfa).
 *
 * Neden kütüphane yok: uygulama şu an sıfır ek bağımlılıkla kuruluyor;
 * SheetJS eklemek herkesin `npm install` çalıştırmasını gerektirirdi.
 * .xlsx zaten bir ZIP + XML; ihtiyacımız olan üç şey var — paylaşılan
 * metinler, hücre değerleri ve satır/sütun konumu.
 *
 * Sıkıştırmayı tarayıcının DecompressionStream'i açar (Chrome 80+,
 * Safari 16.4+). Yoksa anlaşılır bir hata verilir.
 */

/* --------------------------------- ZIP --------------------------------- */

type ZipEntry = { name: string; compressed: boolean; data: Uint8Array };

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** Merkezi dizinden girdileri okur. Yerel başlıkları taramaktan güvenli. */
function readZip(buf: ArrayBuffer): ZipEntry[] {
  const b = new Uint8Array(buf);
  // End of central directory: sondan geriye 0x06054b50 ara.
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i -= 1) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Geçerli bir .xlsx dosyası değil");

  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const localOff = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));

    // Yerel başlık: değişken alanların gerçek uzunlukları burada.
    const lNameLen = u16(b, localOff + 26);
    const lExtraLen = u16(b, localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;

    out.push({
      name,
      compressed: method === 8,
      data: b.subarray(start, start + compSize),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(e: ZipEntry): Promise<string> {
  if (!e.compressed) return new TextDecoder().decode(e.data);
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!DS) {
    throw new Error(
      "Tarayıcın .xlsx açmayı desteklemiyor — Chrome veya Safari'yi güncelle",
    );
  }
  // subarray view'ı kopyala; stream'e ArrayBuffer'ın tamamı gitmesin.
  const copy = new Uint8Array(e.data.length);
  copy.set(e.data);
  const stream = new Blob([copy]).stream().pipeThrough(new DS("deflate-raw"));
  return new Response(stream).text();
}

/* --------------------------------- XML --------------------------------- */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, g: string) => {
    if (g[0] === "#") {
      const code =
        g[1] === "x" || g[1] === "X"
          ? parseInt(g.slice(2), 16)
          : parseInt(g.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[g] ?? m;
  });
}

/** <t>…</t> içeriklerini sırayla toplar (rich text parçaları birleşir). */
function collectText(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += unescapeXml(m[1] ?? "");
  return out;
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/* -------------------------------- okuma -------------------------------- */

/** İlk sayfayı satır dizisi olarak döndürür. Boş hücreler "" olur. */
export async function readXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const entries = readZip(buf);
  const find = (name: string) => entries.find((e) => e.name === name);

  const sharedEntry = find("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedEntry) {
    const xml = await inflate(sharedEntry);
    const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) shared.push(collectText(m[1]));
  }

  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (!sheets.length) throw new Error("Çalışma sayfası bulunamadı");
  const sheetXml = await inflate(sheets[0]);

  const rows: string[][] = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row\s[^>]*\/>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheetXml))) {
    const body = rm[1] ?? "";
    const cells: string[] = [];
    const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(body))) {
      const attrs = cm[1] ?? "";
      const inner = cm[2] ?? "";
      const refM = /\br="([A-Z]+\d+)"/.exec(attrs);
      const idx = refM ? colIndex(refM[1]) : cells.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";

      let value = "";
      if (type === "s") {
        const vi = /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const i = vi ? parseInt(vi, 10) : -1;
        value = shared[i] ?? "";
      } else if (type === "inlineStr" || type === "str") {
        value = collectText(inner) || unescapeXml(
          /<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "",
        );
      } else {
        value = unescapeXml(/<v[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = value.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/** Basit CSV/TSV okuyucu — Excel'i kaydetmek istemeyenler için. */
export function readDelimitedRows(text: string): string[][] {
  const sep = text.indexOf("\t") >= 0 && text.indexOf(";") < 0 ? "\t"
    : text.indexOf(";") >= 0 ? ";" : ",";
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === sep) { row.push(cell.trim()); cell = ""; continue; }
    if (ch === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; continue; }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}
