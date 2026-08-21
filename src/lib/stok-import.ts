/**
 * Stok Excel'ini afiş sayfalarına çevirir.
 *
 * Excel zaten işin yarısını yapıyor: SAYFA sütunu hangi ürünün hangi sayfaya
 * gideceğini söylüyor. Bize düşen ürün adını katalogla eşlemek.
 *
 * Eşleme sırası:
 *   1. "AFİŞ ÜRÜNÜ" sütunu doluysa yalnız o kullanılır (istisna sütunu),
 *   2. değilse ad normalize edilip aynı EBATTAKİ ürünlerle karşılaştırılır.
 *
 * Normalizasyon: Türkçe harfler sadeleşir, tire/alt çizgi boşluğa döner
 * (katalogda "cipollino-white", Excel'de "CIPOLLINO WHITE"), ürün adı
 * olmayan kelimeler (SG, EXP., FULL LAP, LAPPATO...) atılır ve renk adları
 * tek dile indirilir — katalog hem "space antrasit" hem "ginza white"
 * yazıyor, Excel ise "SPACE ANTHRACITE".
 */

export type CatalogProduct = {
  id: string;
  name: string;
  brand: string;
  size: string;
  image: string;
};

export type ImportRow = {
  key: string;
  rawName: string;
  cleaned: string;
  /** Eşleşme yoksa afişte yazılacak ad (ebat ve teknik kelimeler atılmış). */
  fallbackName: string;
  size: string;
  surface: string;
  grade: "" | "1." | "END.";
  isRec: boolean;
  stock: string;
  price: string;
  page: string;
  productId: string | null;
  /** "baska-ebat": desen doğru ama fotoğraf başka ebattan alındı. */
  status: "kesin" | "baska-ebat" | "belirsiz" | "yok";
  /** Eşleşen ürünün kendi ebadı — satırın ebadından farklıysa uyarılır. */
  matchedSize: string;
  /** Sözlükten (daha önce elle yapılmış eşleşmeden) geldi mi. */
  fromMemory: boolean;
  /** Sözlük anahtarı — seçim değişirse bu anahtarla kaydedilir. */
  memoryKey: string;
  score: number;
  candidates: CatalogProduct[];
  /** Aynı ürünün birden çok lot satırı toplandıysa kaç satırdan geldiği. */
  mergedFrom: number;
};

export type ImportPage = { page: string; rows: ImportRow[] };

/** Daha önce elle yapılmış eşleşme. productId "" ise bilerek boş bırakılmış. */
export type SavedMatch = { key: string; productId: string };

/**
 * Sözlük anahtarı: Excel'deki ham addan üretilir. Ebat da anahtarın
 * parçası — aynı desenin 60x120'si ile 60x60'ı farklı ürün.
 */
export function matchKey(rawName: string): string {
  const size = sizeFromName(rawName);
  return `${size}|${tokens(rawName).join(" ")}`;
}

export type ImportResult = {
  pages: ImportPage[];
  counts: {
    kesin: number;
    hatirlanan: number;
    baskaEbat: number;
    belirsiz: number;
    yok: number;
    toplam: number;
  };
  /** Başlık satırında bulunamayan sütunlar. */
  missingColumns: string[];
};

/* ----------------------------- normalizasyon ----------------------------- */

/** Renk/desen adlarını tek dile indirir. İki taraf da buradan geçer. */
const SYNONYMS: Record<string, string> = {
  anthracite: "antrasit",
  anthrazit: "antrasit",
  antracite: "antrasit",
  white: "beyaz",
  blanc: "beyaz",
  blanche: "beyaz",
  bianco: "beyaz",
  blanco: "beyaz",
  black: "siyah",
  nero: "siyah",
  noir: "siyah",
  negro: "siyah",
  grey: "gri",
  gray: "gri",
  gris: "gri",
  grigio: "gri",
  gra: "gri",
  beige: "bej",
  bone: "kemik",
  ivory: "fildisi",
  avorio: "fildisi",
  cream: "krem",
  crema: "krem",
  sand: "kum",
  silver: "gumus",
  argento: "gumus",
  gold: "altin",
  oro: "altin",
  brown: "kahve",
  marron: "kahve",
  offwhite: "kirikbeyaz",
  light: "acik",
  dark: "koyu",
};

/** Ürün adı taşımayan kelimeler. */
const NOISE = new Set([
  "sg", "exp", "full", "lap", "lappato", "lappatto", "matt", "mat",
  "semi", "lapp", "flp", "rekt", "rektifiye", "rektifiyeli",
  "seramik", "porselen", "fon", "dekor", "karo", "x", "cm", "adet",
]);

export function normalizeText(s: string): string {
  let t = String(s ?? "");
  t = t.replace(/İ/g, "i").replace(/I/g, "i").replace(/ı/g, "i");
  t = t.toLowerCase();
  for (const [a, b] of [["ğ", "g"], ["ü", "u"], ["ş", "s"], ["ö", "o"], ["ç", "c"]]) {
    t = t.split(a).join(b);
  }
  t = t.replace(/[-_/.,]/g, " ");
  return t.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function stripSize(s: string): string {
  // "60 X 120 X 0,7 SG ..." -> "SG ..."
  return s.replace(/^\s*\d+\s*x\s*\d+(\s*x\s*[\d.,]+)?/i, " ");
}

export function tokens(s: string, dropSize = true): string[] {
  let t = normalizeText(s);
  if (dropSize) t = stripSize(t);
  return t
    .split(" ")
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w));
}

export function sizeFromName(raw: string): string {
  const m = /(\d+)\s*[xX*]\s*(\d+)/.exec(String(raw).replace(/İ/g, "I"));
  return m ? `${m[1]}x${m[2]}` : "";
}

function similarity(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter += 1;
  });
  const jac = inter / (A.size + B.size - inter);
  // Biri diğerini tamamen kapsıyorsa güçlü aday — ama YALNIZ küçük taraf en az
  // iki kelimeyse. Aksi hâlde tek ortak renk adı yeterli sayılıyor ve
  // "LAVE BLANCHE" ile "bianco white" ikisi de {beyaz}'a indiği için
  // kesin eşleşme sayılıyordu.
  const subset = inter === A.size || inter === B.size;
  const smaller = Math.min(A.size, B.size);
  return subset && smaller >= 2 ? Math.max(jac, 0.85) : jac;
}

/* ------------------------------ sütun bulma ------------------------------ */

const COLUMN_HINTS = {
  name: ["aciklama", "malzeme", "malz", "urun", "stok adi", "mal adi"],
  surface: ["yuzey"],
  grade: ["kalite"],
  rect: ["rektifiye", "rekt"],
  stock: ["miktar", "kalan", "stok"],
  price: ["fiyat", "birim fiyat"],
  page: ["sayfa"],
  template: ["sablon"],
  override: ["afis urunu", "afis", "katalog", "eslesme", "eslestirme"],
} as const;

type ColKey = keyof typeof COLUMN_HINTS;

function findColumns(header: string[]): Partial<Record<ColKey, number>> {
  const norm = header.map((h) => normalizeText(h));
  const out: Partial<Record<ColKey, number>> = {};
  (Object.keys(COLUMN_HINTS) as ColKey[]).forEach((key) => {
    const hints = COLUMN_HINTS[key];
    const idx = norm.findIndex((h) => h && hints.some((k) => h.includes(k)));
    if (idx >= 0) out[key] = idx;
  });
  // "stok" ipucu fiyat sütununa denk gelmesin
  if (out.stock != null && out.stock === out.price) delete out.stock;
  return out;
}

/** Başlık satırını bulur (ilk 10 satır içinde ad sütununu içeren). */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i += 1) {
    const cols = findColumns(rows[i] ?? []);
    if (cols.name != null && (cols.stock != null || cols.price != null)) return i;
  }
  return 0;
}

/* -------------------------------- sayılar -------------------------------- */

/** "583.20000000000005" -> "583,2" · 1231.2 -> "1.231,2" */
export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  const [i, d] = rounded.toFixed(2).split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = d.replace(/0+$/, "");
  return dec ? `${grouped},${dec}` : grouped;
}

export function parseNumber(v: string): number {
  const t = String(v ?? "").trim();
  if (!t) return 0;
  if (t.includes(",")) return parseFloat(t.replace(/\./g, "").replace(",", ".")) || 0;
  const dots = (t.match(/\./g) || []).length;
  if (dots === 1) {
    const dec = t.split(".")[1] ?? "";
    return parseFloat(dec.length === 3 ? t.replace(".", "") : t) || 0;
  }
  return parseFloat(t.replace(/\./g, "")) || 0;
}

function normalizeSurface(v: string): string {
  const t = normalizeText(v);
  if (!t) return "";
  if (t.includes("semi") || t.includes("lapp")) return "SEMİ LAPP.";
  if (t.includes("flp") || t.includes("full")) return "FLP";
  if (t.includes("mat")) return "MAT";
  return "";
}

function normalizeGrade(v: string): "" | "1." | "END." {
  const t = normalizeText(v);
  if (!t) return "";
  if (t.startsWith("end")) return "END.";
  if (t.startsWith("1")) return "1.";
  return "";
}

/* -------------------------------- eşleme -------------------------------- */

export function buildImport(
  rows: string[][],
  catalog: CatalogProduct[],
  savedMatches: SavedMatch[] = [],
): ImportResult {
  const memory = new Map(savedMatches.map((m) => [m.key, m.productId]));
  const headerIdx = findHeaderRow(rows);
  const cols = findColumns(rows[headerIdx] ?? []);
  const missingColumns: string[] = [];
  if (cols.name == null) missingColumns.push("ürün adı");
  if (cols.stock == null) missingColumns.push("stok miktarı");
  if (cols.price == null) missingColumns.push("fiyat");

  const bySize = new Map<string, CatalogProduct[]>();
  catalog.forEach((p) => {
    const list = bySize.get(p.size) ?? [];
    list.push(p);
    bySize.set(p.size, list);
  });

  const cell = (r: string[], i?: number) => (i == null ? "" : (r[i] ?? "").trim());

  type Acc = ImportRow & { _stockNum: number };
  const acc = new Map<string, Acc>();
  const order: string[] = [];

  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const r = rows[i] ?? [];
    const rawName = cell(r, cols.name);
    if (!rawName) continue;

    const size = sizeFromName(rawName);
    const pool = bySize.get(size) ?? catalog;
    const nameTokens = tokens(rawName);

    const memoryKey = matchKey(rawName);
    type Ranked = { p: CatalogProduct; s: number };
    const rank = (list: CatalogProduct[]): Ranked[] =>
      list
        .map((p) => ({ p, s: similarity(nameTokens, tokens(p.name, false)) }))
        .sort((a, b) => b.s - a.s);
    const confident = (r: Ranked[]): Ranked | null =>
      r[0] && r[0].s >= 0.8 && r[0].s - (r[1]?.s ?? 0) >= 0.1 ? r[0] : null;

    let productId: string | null = null;
    let score = 0;
    let candidates: CatalogProduct[] = [];
    let fromMemory = false;

    // 1) Daha önce elle yapılmış eşleşme — her şeyin önünde gelir.
    //    Ürün katalogdan silinmişse hatırlanan kayıt yok sayılır.
    if (memory.has(memoryKey)) {
      const remembered = memory.get(memoryKey) ?? "";
      if (!remembered) {
        // Bilerek boş bırakılmış: tahmin etmeye çalışma.
        fromMemory = true;
      } else if (catalog.some((p) => p.id === remembered)) {
        productId = remembered;
        score = 1;
        fromMemory = true;
      }
    }

    // 2) istisna sütunu
    const override = cell(r, cols.override);
    if (!fromMemory && override) {
      const ot = tokens(override, false);
      const ranked = pool
        .map((p) => ({ p, s: similarity(ot, tokens(p.name, false)) }))
        .sort((a, b) => b.s - a.s);
      if (ranked[0] && ranked[0].s >= 0.6) {
        productId = ranked[0].p.id;
        score = 1;
      }
      candidates = ranked.slice(0, 6).map((x) => x.p);
    }

    let crossSize = false;

    if (!productId && !fromMemory) {
      const sameSize = rank(pool);
      candidates = sameSize.slice(0, 6).map((x) => x.p);
      const best = confident(sameSize);
      if (best) {
        productId = best.p.id;
        score = best.s;
      } else {
        score = sameSize[0]?.s ?? 0;
        // Aynı ebatta yoksa BAŞKA EBATTA ara: desen aynı, yalnız kesim
        // ölçüsü farklı. Fotoğraf zaten ilan edilen orana kırpıldığı için
        // 120x120 Marfil Rosso'dan doğru oranlı bir 60x120 karo çıkar.
        const others = rank(catalog.filter((p) => p.size !== size));
        const bestOther = confident(others);
        if (bestOther) {
          productId = bestOther.p.id;
          score = bestOther.s;
          crossSize = true;
        }
        // Seçim kutusunda başka ebattaki adaylar da görünsün.
        const extra = others
          .filter((x) => x.s >= 0.5)
          .slice(0, 4)
          .map((x) => x.p);
        const seen = new Set(candidates.map((c) => c.id));
        extra.forEach((c) => {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            candidates.push(c);
          }
        });
      }
    }

    const matchedSize = productId
      ? (catalog.find((p) => p.id === productId)?.size ?? "")
      : "";

    // Sözlükten geldiyse bile seçim kutusu dolu olmalı ki değiştirebilsin.
    if (!candidates.length) {
      candidates = rank(pool).slice(0, 6).map((x) => x.p);
    }

    const status: ImportRow["status"] = productId
      ? crossSize
        ? "baska-ebat"
        : "kesin"
      : score >= 0.45
        ? "belirsiz"
        : "yok";

    const page = cell(r, cols.page) || "1";
    const stockNum = parseNumber(cell(r, cols.stock));
    // Aynı ürünün birden çok lotu tek satırda toplanır.
    const key = `${page}|${productId ?? normalizeText(rawName)}`;

    const existing = acc.get(key);
    if (existing) {
      existing._stockNum += stockNum;
      existing.stock = formatQty(existing._stockNum);
      existing.mergedFrom += 1;
      continue;
    }

    const row: Acc = {
      key,
      rawName,
      cleaned: nameTokens.join(" "),
      fallbackName: stripSize(String(rawName))
        .replace(/\b(SG|EXP\.?|FULL\s*LAP|LAPPATO|X\s*0[,.]7)\b/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/[\s.,;:·-]+$/, "")
        .trim()
        .toLocaleUpperCase("tr-TR"),
      size,
      surface: normalizeSurface(cell(r, cols.surface)),
      grade: normalizeGrade(cell(r, cols.grade)),
      isRec: normalizeText(cell(r, cols.rect)).startsWith("var"),
      stock: formatQty(stockNum),
      price: String(Math.round(parseNumber(cell(r, cols.price)))),
      page,
      productId,
      status,
      matchedSize,
      fromMemory,
      memoryKey,
      score,
      candidates,
      mergedFrom: 1,
      _stockNum: stockNum,
    };
    acc.set(key, row);
    order.push(key);
  }

  const grouped = new Map<string, ImportRow[]>();
  order.forEach((k) => {
    const row = acc.get(k)!;
    const list = grouped.get(row.page) ?? [];
    list.push(row);
    grouped.set(row.page, list);
  });

  const pages: ImportPage[] = Array.from(grouped.entries())
    .sort((a, b) => {
      const na = Number(a[0]);
      const nb = Number(b[0]);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a[0].localeCompare(b[0], "tr");
    })
    .map(([page, list]) => ({ page, rows: list }));

  const all = pages.flatMap((p) => p.rows);
  return {
    pages,
    counts: {
      kesin: all.filter((r) => r.status === "kesin").length,
      hatirlanan: all.filter((r) => r.fromMemory).length,
      baskaEbat: all.filter((r) => r.status === "baska-ebat").length,
      belirsiz: all.filter((r) => r.status === "belirsiz").length,
      yok: all.filter((r) => r.status === "yok").length,
      toplam: all.length,
    },
    missingColumns,
  };
}

export function productLabel(p: CatalogProduct | undefined): string {
  return p ? `${p.name} · ${p.size} · ${p.brand}` : "";
}

export { };
