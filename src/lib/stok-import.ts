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
  /** Çift stok: END. satırının stoğu ve fiyatı. Boşsa çift stok yok. */
  stockEnd: string;
  priceEnd: string;
  dualStock: boolean;
  /** "urun" = normal karo · "hediye" = kampanya sayfasındaki hediye ürün. */
  kind: "urun" | "hediye";
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
  /** Stok boş ya da sıfır — afişte "—" basılır, önizlemede uyarılır. */
  missingStock: boolean;
  /** Fiyat boş ya da sıfır. Hediye satırlarında normal, üründe hata. */
  missingPrice: boolean;
};

/**
 * Sayfa bazlı ayarlar. Hepsi isteğe bağlı: boş bırakılan alan için
 * stüdyoda o an seçili olan değer kullanılır.
 */
export type PageSettings = {
  mode: "urun" | "kampanya";
  /** Sayfada kaç ürün olacağı (ŞABLON / ÜRÜN SAYISI sütunu). 0 = belirtilmemiş. */
  count: number;
  /** "sicak-orta" gibi zemin kimliği ya da "". */
  ground: string;
  brand: string;
  depot: string;
  campaignLead: string;
  campaignTitle: string;
  campaignText: string;
  campaignNote: string;
};

export type ImportPage = {
  page: string;
  rows: ImportRow[];
  settings: PageSettings;
};

/** Daha önce elle yapılmış eşleşme. productId "" ise bilerek boş bırakılmış. */
export type SavedMatch = { key: string; productId: string };

/**
 * Sözlük anahtarı: Excel'deki ham addan üretilir. Ebat da anahtarın
 * parçası — aynı desenin 60x120'si ile 60x60'ı farklı ürün.
 */
export function matchKey(rawName: string, size?: string): string {
  const s = size ?? sizeFromName(rawName);
  return `${s}|${tokens(rawName).join(" ")}`;
}

export type ImportResult = {
  pages: ImportPage[];
  counts: {
    kesin: number;
    hatirlanan: number;
    baskaEbat: number;
    belirsiz: number;
    yok: number;
    /** Stoğu ya da fiyatı boş satır sayısı — afişe eksik basılır. */
    eksikVeri: number;
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
  // Türkçe I/İ önce: NFD "İ"yi I + nokta yapar, sonra i'ye dönüşmez.
  t = t.replace(/İ/g, "i").replace(/I/g, "i").replace(/ı/g, "i");
  t = t.toLowerCase();
  for (const [a, b] of [["ğ", "g"], ["ü", "u"], ["ş", "s"], ["ö", "o"], ["ç", "c"]]) {
    t = t.split(a).join(b);
  }
  // Kalan aksanlar ("kâğıt", "café") harfe indirilsin — yoksa aksanlı harf
  // boşluğa dönüp kelimeyi ortadan ikiye bölüyor.
  t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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

/** "60 X 120", "7,5x30", "60X120" -> "60x120" / "7.5x30" */
export function normalizeSize(raw: string): string {
  const m = /(\d+(?:[.,]\d+)?)\s*[xX*]\s*(\d+(?:[.,]\d+)?)/.exec(
    String(raw ?? "").replace(/İ/g, "I"),
  );
  if (!m) return "";
  const f = (v: string) => v.replace(",", ".").replace(/\.0+$/, "");
  return `${f(m[1])}x${f(m[2])}`;
}

/** Ad içindeki ebat. Ayrı EBAT sütunu yoksa buna düşülür. */
export function sizeFromName(raw: string): string {
  return normalizeSize(raw);
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

/**
 * Sütun adları. İlk sıradakiler KULALILAR şablonunun kendi adları,
 * sonrakiler ERP çıktısının adları — eski dosyalar da okunmaya devam etsin.
 *
 * Bir başlık birden çok anahtara uyarsa EN UZUN ipucu kazanır: "Sevk Kalan
 * Miktar" hem depoya ("sevk") hem stoğa ("kalan") benziyor; "sevk yeri"
 * ipucu ona uymadığı için stok kazanır.
 */
const COLUMN_HINTS = {
  page: ["sayfa"],
  kind: ["tip"],
  name: ["urun adi", "aciklama", "malzeme", "malz", "mal adi", "stok adi", "urun"],
  size: ["ebat", "olcu", "boyut"],
  surface: ["yuzey"],
  grade: ["kalite"],
  rect: ["rec", "rektifiye", "rekt"],
  stock: ["stok", "miktar", "kalan"],
  price: ["fiyat"],
  stock2: ["stok 2", "stok2", "end stok", "ikinci stok"],
  price2: ["fiyat 2", "fiyat2", "end fiyat", "ikinci fiyat"],
  override: ["afis urunu", "afis", "katalog", "eslesme", "eslestirme"],
  count: ["urun sayisi", "sablon", "adet"],
  ground: ["zemin", "renk"],
  brand: ["marka"],
  depot: ["sevk yeri", "depo"],
  campLead: ["kampanya ust"],
  campTitle: ["kampanya baslik"],
  campText: ["kampanya metin"],
  campNote: ["kampanya not"],
} as const;

type ColKey = keyof typeof COLUMN_HINTS;

function findColumns(header: string[]): Partial<Record<ColKey, number>> {
  const norm = header.map((h) => normalizeText(h));

  // Tüm (anahtar, sütun) adaylarını çıkar, sonra en güçlüden başlayarak
  // eşle. Böylece bir sütunu kaptıran anahtar diğerini aç bırakmıyor:
  // kaybeden anahtar kendi ikinci sütununa yerleşebiliyor.
  const cands: { key: ColKey; idx: number; len: number }[] = [];
  (Object.keys(COLUMN_HINTS) as ColKey[]).forEach((key) => {
    const hints = COLUMN_HINTS[key] as readonly string[];
    norm.forEach((h, idx) => {
      if (!h) return;
      const hit = hints
        .filter((k) => h.includes(k))
        .sort((a, b) => b.length - a.length)[0];
      if (hit) cands.push({ key, idx, len: hit.length });
    });
  });

  cands.sort((a, b) => b.len - a.len || a.idx - b.idx);

  const out: Partial<Record<ColKey, number>> = {};
  const takenCol = new Set<number>();
  cands.forEach((c) => {
    if (out[c.key] != null || takenCol.has(c.idx)) return;
    out[c.key] = c.idx;
    takenCol.add(c.idx);
  });
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

/** REC sütunu: E / EVET / VAR / X / 1 hepsi "rektifiyeli" demek. */
function truthy(v: string): boolean {
  const t = normalizeText(v);
  if (!t) return false;
  return /^(e|evet|var|x|1|rec|rekt|rektifiye|rektifiyeli|yes|true)$/.test(t);
}

/**
 * ZEMİN sütununu zemin kimliğine çevirir: "sıcak orta" -> "sicak-orta".
 * Aile yazılmamışsa sıcak gri varsayılır (eski kayıtlarla aynı davranış).
 * Tanınmayan değer "" döner ve stüdyodaki seçim korunur.
 */
export function normalizeGround(v: string): string {
  const t = normalizeText(v);
  if (!t) return "";
  const family = /zeytin|olive|yesil/.test(t) ? "zeytin" : "sicak";
  const tone = /siyah|black|murekkep/.test(t)
    ? "siyah"
    : /koyu|dark/.test(t)
      ? "koyu"
      : /orta|mid|medium/.test(t)
        ? "orta"
        : /acik|light/.test(t)
          ? "acik"
          : /beyaz|kagit|kirik|white|paper/.test(t)
            ? "beyaz"
            : "";
  return tone ? `${family}-${tone}` : "";
}

/** TİP sütunu. Boş = ürün satırı. */
function rowKind(v: string): "urun" | "hediye" | "kampanya" {
  const t = normalizeText(v);
  if (t.startsWith("kampanya")) return "kampanya";
  if (t.startsWith("hediye")) return "hediye";
  return "urun";
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

  type Acc = ImportRow & { _stockNum: number; _stockEndNum: number };
  const acc = new Map<string, Acc>();
  const order: string[] = [];

  /* Sayfa ayarları: bir sayfanın herhangi bir satırında yazan değer o
   * sayfanın tamamı için geçerli. İlk yazan kazanır — aynı sayfada iki
   * farklı marka yazmak zaten anlamsız. */
  const settings = new Map<string, PageSettings>();
  const settingsOf = (page: string): PageSettings => {
    let st = settings.get(page);
    if (!st) {
      st = {
        mode: "urun",
        count: 0,
        ground: "",
        brand: "",
        depot: "",
        campaignLead: "",
        campaignTitle: "",
        campaignText: "",
        campaignNote: "",
      };
      settings.set(page, st);
    }
    return st;
  };
  const fill = (st: PageSettings, k: keyof PageSettings, v: string) => {
    if (v && !st[k]) (st as unknown as Record<string, string>)[k] = v;
  };

  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const r = rows[i] ?? [];
    const rawName = cell(r, cols.name);
    const kind = rowKind(cell(r, cols.kind));
    const page = cell(r, cols.page) || "1";

    // Sayfa ayarları her satırdan toplanır; ürün satırı olmasa bile.
    // Şablondaki örnek satırlar silinmeden gönderilirse afişe girmesin.
    if (normalizeText(page).startsWith("ornek")) continue;

    const st = settingsOf(page);
    fill(st, "ground", normalizeGround(cell(r, cols.ground)));
    fill(st, "brand", cell(r, cols.brand));
    fill(st, "depot", cell(r, cols.depot));
    fill(st, "campaignLead", cell(r, cols.campLead));
    fill(st, "campaignTitle", cell(r, cols.campTitle));
    fill(st, "campaignText", cell(r, cols.campText));
    fill(st, "campaignNote", cell(r, cols.campNote));
    if (!st.count) {
      const n = Math.round(parseNumber(cell(r, cols.count)));
      if (n >= 1 && n <= 4) st.count = n;
    }
    if (kind === "kampanya") st.mode = "kampanya";

    // Kampanya satırı yalnız metin taşıyabilir; ürün adı aramayız.
    if (kind === "kampanya" && !rawName) continue;
    if (!rawName) continue;

    // Ebat: ayrı sütun varsa o kesin. Yoksa addan okunur — ERP çıktısında
    // ebat adın başında duruyor.
    const size = normalizeSize(cell(r, cols.size)) || sizeFromName(rawName);
    const pool = bySize.get(size) ?? catalog;
    const nameTokens = tokens(rawName);

    const memoryKey = matchKey(rawName, size);
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

    const stockNum = parseNumber(cell(r, cols.stock));
    const stockEndNum = parseNumber(cell(r, cols.stock2));
    const priceEndNum = parseNumber(cell(r, cols.price2));
    const priceEnd = priceEndNum > 0 ? String(Math.round(priceEndNum)) : "";
    const dualStock = stockEndNum > 0 || priceEndNum > 0;
    const priceNum = parseNumber(cell(r, cols.price));
    // Aynı ürünün birden çok lotu tek satırda toplanır.
    const key = `${page}|${kind}|${productId ?? normalizeText(rawName)}`;

    const existing = acc.get(key);
    if (existing) {
      existing._stockNum += stockNum;
      existing.stock = existing._stockNum > 0 ? formatQty(existing._stockNum) : "";
      existing.missingStock = kind !== "hediye" && existing._stockNum <= 0;
      existing._stockEndNum += stockEndNum;
      if (existing.dualStock) existing.stockEnd = formatQty(existing._stockEndNum);
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
      isRec: truthy(cell(r, cols.rect)),
      // Boş hücre "0" olarak yazılmasın: afişte "0 m²" yerine hiç basılmaz
      // ve önizlemede eksik olarak uyarılır.
      stock: stockNum > 0 ? formatQty(stockNum) : "",
      price: priceNum > 0 ? String(Math.round(priceNum)) : "",
      stockEnd: dualStock && stockEndNum > 0 ? formatQty(stockEndNum) : "",
      priceEnd: dualStock ? priceEnd : "",
      missingStock: kind !== "hediye" && stockNum <= 0,
      missingPrice: kind !== "hediye" && priceNum <= 0,
      dualStock,
      kind: kind === "hediye" ? "hediye" : "urun",
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
      _stockEndNum: stockEndNum,
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
  // Yalnız kampanya metni taşıyan sayfada ürün satırı yok — yine de sayfa.
  settings.forEach((st, page) => {
    if (!grouped.has(page) && st.mode === "kampanya") grouped.set(page, []);
  });

  const pages: ImportPage[] = Array.from(grouped.entries())
    .sort((a, b) => {
      const na = Number(a[0]);
      const nb = Number(b[0]);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a[0].localeCompare(b[0], "tr");
    })
    .map(([page, list]) => ({ page, rows: list, settings: settingsOf(page) }));

  const all = pages.flatMap((p) => p.rows);
  return {
    pages,
    counts: {
      kesin: all.filter((r) => r.status === "kesin").length,
      hatirlanan: all.filter((r) => r.fromMemory).length,
      baskaEbat: all.filter((r) => r.status === "baska-ebat").length,
      belirsiz: all.filter((r) => r.status === "belirsiz").length,
      yok: all.filter((r) => r.status === "yok").length,
      eksikVeri: all.filter((r) => r.missingStock || r.missingPrice).length,
      toplam: all.length,
    },
    missingColumns,
  };
}

export function productLabel(p: CatalogProduct | undefined): string {
  return p ? `${p.name} · ${p.size} · ${p.brand}` : "";
}

export { };
