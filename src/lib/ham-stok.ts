/**
 * Tedarikçiden gelen ham stok dökümünü afiş şablonuna çevirir.
 *
 * Gelen dosyada yalnız üç şey var: malzeme kodu, açıklama, kalan miktar.
 * Ebat, yüzey ve kalite açıklamanın içinde saklı; fiyat ise hiç yok —
 * onu dışarıdan veriyoruz (grup fiyatı + ürün bazlı hafıza).
 *
 * Elle yapılan iş buydu: dosyayı ebat/yüzey/kalite gruplarına bölüp
 * ayrı ayrı şablona dökmek. Burada gruplama önerilir, seçim kullanıcıda
 * kalır — LAPPATO satırlarını bazen FLP ile birlikte alıyor, bazen almıyor.
 */

import { normalizeSize, normalizeText } from "./stok-import";

export type HamSatir = {
  key: string;
  /** Açıklama sütunundaki hâli — afişe de bu ad gider. */
  rawName: string;
  size: string;
  surface: "" | "FLP" | "SEMİ LAPP." | "MAT";
  grade: "" | "1." | "END.";
  isRec: boolean;
  stock: number;
  /** Ürün kimliği: aynı ürünün farklı lotları aynı anahtarı taşır. */
  urunKey: string;
};

export type HamGrup = {
  id: string;
  size: string;
  surface: HamSatir["surface"];
  grade: HamSatir["grade"];
  satirlar: HamSatir[];
  /** Gruptaki farklı ürün sayısı (lotlar birleştirilince kaç karo çıkar). */
  urunSayisi: number;
  toplamStok: number;
};

/* ------------------------------- okuma ------------------------------- */

const AD_IPUCU = ["aciklama", "malzeme", "malz", "urun adi", "urun", "mal adi", "stok adi"];
const STOK_IPUCU = ["kalan", "miktar", "stok"];
const FIYAT_IPUCU = ["fiyat"];
const SAYFA_IPUCU = ["sayfa"];

function sutunBul(header: string[], ipuclari: string[]): number {
  const norm = header.map((h) => normalizeText(h));
  let best = -1;
  let bestLen = 0;
  norm.forEach((h, i) => {
    if (!h) return;
    const hit = ipuclari
      .filter((k) => h.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    if (hit && hit.length > bestLen) {
      best = i;
      bestLen = hit.length;
    }
  });
  return best;
}

function baslikSatiri(rows: string[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i += 1) {
    const r = rows[i] ?? [];
    if (sutunBul(r, AD_IPUCU) >= 0 && sutunBul(r, STOK_IPUCU) >= 0) return i;
  }
  return 0;
}

/**
 * Dosya ham döküm mü, yoksa doldurulmuş afiş şablonu mu?
 * Ayırt edici: şablonda FİYAT ve SAYFA sütunları var, ham dökümde yok.
 */
export function hamDosyaMi(rows: string[][]): boolean {
  const idx = baslikSatiri(rows);
  const header = rows[idx] ?? [];
  if (sutunBul(header, AD_IPUCU) < 0) return false;
  if (sutunBul(header, STOK_IPUCU) < 0) return false;
  const fiyat = sutunBul(header, FIYAT_IPUCU) >= 0;
  const sayfa = sutunBul(header, SAYFA_IPUCU) >= 0;
  return !fiyat && !sayfa;
}

function yuzeyOku(ad: string): HamSatir["surface"] {
  const t = normalizeText(ad);
  // "FULL LAP" ve dosyada rastlanan "FUL LAP" yazımı aynı yüzey.
  if (/\bful+\s*lap/.test(t)) return "FLP";
  if (/\bflp\b/.test(t)) return "FLP";
  if (/\blappato\b|\blapp\b|\bsemi\b/.test(t)) return "SEMİ LAPP.";
  if (/\bmat+\b/.test(t)) return "MAT";
  return "";
}

function kaliteOku(ad: string): HamSatir["grade"] {
  const t = ` ${normalizeText(ad)} `;
  if (/ (exp|export|end|endustriyel) /.test(t)) return "END.";
  if (/ 1 $/.test(t)) return "1.";
  return "";
}

function recOku(ad: string): boolean {
  return / (rec|rekt|rektifiye|rektifiyeli) /.test(` ${normalizeText(ad)} `);
}

/** Türkçe/İngilizce ondalık: "3369.2" ve "3.369,2" ikisi de okunur. */
function sayi(v: string): number {
  const t = String(v ?? "").trim();
  if (!t) return 0;
  if (t.includes(",")) return parseFloat(t.replace(/\./g, "").replace(",", ".")) || 0;
  return parseFloat(t) || 0;
}

/**
 * Ürün kimliği. Kalite ve rektifiye kimliğe girmez: aynı karonun
 * 1. kalitesi ile END.'i tek üründür, afişte çift stok olurlar.
 */
function urunAnahtari(ad: string, size: string, surface: string): string {
  const kelimeler = normalizeText(ad)
    .replace(/^\s*\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?(\s*x\s*[\d.,]+)?\s*(cm)?/i, " ")
    .split(" ")
    .filter(
      (w) =>
        w &&
        !/^\d+$/.test(w) &&
        !["sg", "cm", "x", "exp", "export", "end", "rec", "rekt", "rektifiye",
          "full", "ful", "lap", "lappato", "lapp", "semi", "flp", "mat"].includes(w),
    );
  return `${size}|${surface}|${kelimeler.join(" ")}`;
}

export function hamOku(rows: string[][]): HamSatir[] {
  const idx = baslikSatiri(rows);
  const header = rows[idx] ?? [];
  const adIdx = sutunBul(header, AD_IPUCU);
  const stokIdx = sutunBul(header, STOK_IPUCU);
  if (adIdx < 0 || stokIdx < 0) return [];

  const out: HamSatir[] = [];
  for (let i = idx + 1; i < rows.length; i += 1) {
    const r = rows[i] ?? [];
    const rawName = (r[adIdx] ?? "").trim();
    if (!rawName) continue;
    const stock = sayi(r[stokIdx] ?? "");
    // Stoğu olmayan satır afişe girmez; ham dökümde bunlar çoğunluktadır.
    if (stock <= 0) continue;
    const size = normalizeSize(rawName);
    const surface = yuzeyOku(rawName);
    out.push({
      key: `${i}`,
      rawName,
      size,
      surface,
      grade: kaliteOku(rawName),
      isRec: recOku(rawName),
      stock,
      urunKey: urunAnahtari(rawName, size, surface),
    });
  }
  return out;
}

/* ------------------------------ gruplama ------------------------------ */

const YUZEY_SIRA: Record<string, number> = {
  FLP: 0,
  "SEMİ LAPP.": 1,
  MAT: 2,
  "": 3,
};

export function grupEtiketi(g: HamGrup): string {
  return [
    g.size || "ebat?",
    g.surface || "yüzey yok",
    g.grade === "END." ? "END." : g.grade === "1." ? "1. KALİTE" : "kalite yok",
  ].join(" · ");
}

export function hamGrupla(satirlar: HamSatir[]): HamGrup[] {
  const m = new Map<string, HamGrup>();
  satirlar.forEach((s) => {
    const id = `${s.size}|${s.surface}|${s.grade}`;
    let g = m.get(id);
    if (!g) {
      g = {
        id,
        size: s.size,
        surface: s.surface,
        grade: s.grade,
        satirlar: [],
        urunSayisi: 0,
        toplamStok: 0,
      };
      m.set(id, g);
    }
    g.satirlar.push(s);
    g.toplamStok += s.stock;
  });
  m.forEach((g) => {
    g.urunSayisi = new Set(g.satirlar.map((s) => s.urunKey)).size;
  });

  // Büyük ebat ve FLP önce: afişe en çok bunlar giriyor.
  return Array.from(m.values()).sort((a, b) => {
    const alan = (s: string) => {
      const mm = /(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/.exec(s);
      return mm ? Number(mm[1]) * Number(mm[2]) : 0;
    };
    const fa = alan(b.size) - alan(a.size);
    if (fa) return fa;
    const fy = (YUZEY_SIRA[a.surface] ?? 9) - (YUZEY_SIRA[b.surface] ?? 9);
    if (fy) return fy;
    return a.grade.localeCompare(b.grade, "tr");
  });
}

/** Gruptaki farklı ürünler — fiyat kutuları bunlar için açılır. */
export type HamUrun = {
  urunKey: string;
  ad: string;
  lotSayisi: number;
  stok: number;
};

export function grupUrunleri(g: HamGrup): HamUrun[] {
  const m = new Map<string, HamUrun>();
  g.satirlar.forEach((s) => {
    const u = m.get(s.urunKey);
    if (u) {
      u.lotSayisi += 1;
      u.stok += s.stock;
    } else {
      m.set(s.urunKey, {
        urunKey: s.urunKey,
        ad: s.rawName,
        lotSayisi: 1,
        stok: s.stock,
      });
    }
  });
  return Array.from(m.values());
}

/* --------------------------- şablona dökme --------------------------- */

export const SABLON_BASLIK = [
  "SAYFA", "TİP", "ÜRÜN ADI", "EBAT", "YÜZEY", "KALİTE", "REC", "STOK",
  "FİYAT", "STOK 2", "FİYAT 2", "AFİŞ ÜRÜNÜ", "ÜRÜN SAYISI", "ZEMİN",
  "MARKA", "SEVK YERİ", "KAMPANYA ÜST", "KAMPANYA BAŞLIK", "KAMPANYA METİN",
  "KAMPANYA NOT",
];

export type HazirlaAyar = {
  /** Sayfa başına kaç farklı ürün. */
  sayfaBasinaUrun: number;
  zemin: string;
  marka: string;
  sevkYeri: string;
  /** urunKey -> fiyat (metin). Boşsa grup fiyatı kullanılır. */
  urunFiyat: Record<string, string>;
  /** grup id -> fiyat (metin). */
  grupFiyat: Record<string, string>;
};

/**
 * Seçilen grupları şablon satırlarına çevirir.
 *
 * Sayfa numarası ÜRÜN bazında ilerler, satır bazında değil: aynı ürünün
 * lotları bölünmez. Her grup 1. sayfadan başlamaz — numaralar dosya
 * boyunca artar, böylece tek içe aktarmada hepsi ayrı sayfa olur.
 */
export function sablonSatirlari(
  gruplar: HamGrup[],
  ayar: HazirlaAyar,
): string[][] {
  const perPage = Math.min(4, Math.max(1, Math.round(ayar.sayfaBasinaUrun) || 3));
  const rows: string[][] = [SABLON_BASLIK.slice()];
  let sayfa = 0;

  gruplar.forEach((g) => {
    const urunler = grupUrunleri(g);
    const sayfaOf = new Map<string, number>();
    urunler.forEach((u, i) => {
      if (i % perPage === 0) sayfa += 1;
      sayfaOf.set(u.urunKey, sayfa);
    });

    g.satirlar.forEach((s) => {
      const fiyat =
        (ayar.urunFiyat[s.urunKey] ?? "").trim() ||
        (ayar.grupFiyat[g.id] ?? "").trim();
      rows.push([
        String(sayfaOf.get(s.urunKey) ?? 1),
        "",
        s.rawName,
        s.size,
        s.surface,
        s.grade,
        s.isRec ? "E" : "",
        String(s.stock),
        fiyat,
        "", "", "",
        String(perPage),
        ayar.zemin,
        ayar.marka,
        ayar.sevkYeri,
        "", "", "", "",
      ]);
    });
  });

  return rows;
}

export { };
