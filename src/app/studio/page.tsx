"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toJpeg } from "html-to-image";
import { jsPDF } from "jspdf";
import { readXlsxRows, readDelimitedRows } from "@/src/lib/xlsx-lite";
import {
  buildImport,
  type ImportResult,
  type ImportRow,
} from "@/src/lib/stok-import";

/* ------------------------------------------------------------------ *
 *  KULALILAR · Afiş Stüdyo 2
 *
 *  Mevcut banner-studio yerine değil, yanına gelen ikinci üretim aracı.
 *  Aynı ürün kataloğunu, Cloudinary kütüphanesini, taslak ve satış
 *  uçlarını kullanır; sadece sayfa kurgusu ve tipografi farklıdır.
 *
 *  Tasarım kuralları (kararlaştırıldı):
 *   - Ebat ve görsel en üst öncelik: karo ASLA kırpılmaz, oranı bozulmaz.
 *   - Dikey çekilmiş fotoğraf yatay çerçeveye çevrilerek yerleştirilir.
 *   - Dikdörtgen ebatlar tek sütun, alt alta. Kare ebatlar 2 sütun, en fazla 4.
 *   - Ürün sayısını kullanıcı seçer; ebada göre yalnızca öneri sunulur.
 *   - Zemin nötr orta tondur: hem koyu hem açık karo zeminden ayrışır.
 *   - Vurgu rengi logo mavisidir.
 *   - Kampanya bandı isteğe bağlıdır.
 * ------------------------------------------------------------------ */

const CANVAS_W = 1080;
const CANVAS_H = 1920;

/** Logo mavisi. Gerçek marka hex'i farklıysa tek yerden değiştirilir. */
const BRAND_BLUE = "#0057A6";

/** Yazı ölçeği sınırları (%). */
/** Seçicide bir sayfada çizilen kart sayısı. */
const PICKER_PAGE = 60;

const FONT_MIN = 60;
const FONT_MAX = 160;

/**
 * İki zemin ailesi, aynı beş ton. Saf nötr gri (kroma 0) 2013-18 dilidir;
 * eski kahverengi tonlar ise doğru fikrin yanlış dozuydu (kroma 17-20).
 * Doğru yer arada: ölçülü sıcaklık, kroma 8-12. Siyahlar da nötr değil —
 * gerçek malzemede nötr siyah yoktur.
 *
 * Ölçülen L*: kâğıt 95 · açık 77 · orta 47 · koyu 27 · siyah 13.
 * Orta ton, koyu karo (L*14) ile açık karoyu (L*94) aynı anda ayırır.
 * Siyahta ayrımı ışık havuzu sağlar (bkz. tileShadow).
 */
const GROUND_FAMILIES = [
  { id: "sicak", label: "Sıcak gri" },
  { id: "zeytin", label: "Zeytin-gri" },
] as const;
type GroundFamily = (typeof GROUND_FAMILIES)[number]["id"];

const GROUND_TONES = ["beyaz", "acik", "orta", "koyu", "siyah"] as const;
type GroundTone = (typeof GROUND_TONES)[number];

const TONE_LABEL: Record<GroundTone, string> = {
  beyaz: "kâğıt",
  acik: "açık",
  orta: "orta",
  koyu: "koyu",
  siyah: "siyah",
};

const GROUNDS = [
  { id: "sicak-beyaz", family: "sicak", tone: "beyaz", label: "Sıcak kâğıt", bg: "#F3F0EA", ink: "#151311" },
  { id: "sicak-acik", family: "sicak", tone: "acik", label: "Sıcak açık", bg: "#C2BDB4", ink: "#1A1714" },
  { id: "sicak-orta", family: "sicak", tone: "orta", label: "Sıcak orta", bg: "#757068", ink: "#FFFFFF" },
  { id: "sicak-koyu", family: "sicak", tone: "koyu", label: "Sıcak koyu", bg: "#413C36", ink: "#FFFFFF" },
  { id: "sicak-siyah", family: "sicak", tone: "siyah", label: "Mürekkep siyahı", bg: "#241F1B", ink: "#FFFFFF" },
  { id: "zeytin-beyaz", family: "zeytin", tone: "beyaz", label: "Zeytin kâğıt", bg: "#EFF1EB", ink: "#141614" },
  { id: "zeytin-acik", family: "zeytin", tone: "acik", label: "Zeytin açık", bg: "#BBBFB6", ink: "#171A16" },
  { id: "zeytin-orta", family: "zeytin", tone: "orta", label: "Zeytin orta", bg: "#6D7268", ink: "#FFFFFF" },
  { id: "zeytin-koyu", family: "zeytin", tone: "koyu", label: "Zeytin koyu", bg: "#3B403A", ink: "#FFFFFF" },
  { id: "zeytin-siyah", family: "zeytin", tone: "siyah", label: "Zeytin siyahı", bg: "#1E221F", ink: "#FFFFFF" },
] as const;

/** Eski kayıtlarda zemin "orta", "siyah" gibi tek kelimeydi. */
const LEGACY_GROUNDS: Record<string, string> = {
  orta: "sicak-orta",
  koyu: "sicak-koyu",
  acik: "sicak-acik",
  siyah: "sicak-siyah",
  beyaz: "sicak-beyaz",
};

function groundId(family: GroundFamily, tone: GroundTone): GroundId {
  return `${family}-${tone}` as GroundId;
}

type GroundId = (typeof GROUNDS)[number]["id"];

const SIZES = [
  "5x30", "7.5x15", "7.5x30", "10x20", "10x30", "15x15", "15x60",
  "20x120", "30x60", "30x90", "40x80", "40x120", "45x45", "50x50",
  "60x60", "61x61", "60x120", "80x80", "80x320", "100x100",
  "120x120", "120x180", "120x280", "160x320",
] as const;

const DEPOTS = ["PANCAR DEPO", "SÖKE FABRİKA SEVK"] as const;

const SURFACES = ["", "FLP", "SEMİ LAPP.", "MAT"] as const;
const GRADES = ["", "1.", "END."] as const;

type Product = {
  id: string;
  name: string;
  brand: string;
  size: string;
  image: string;
};

type LibraryItem = {
  publicId: string;
  url: string;
  displayName?: string;
};

type Slot = {
  productId: string | null;
  imageUrl: string | null;
  customName: string;
  surface: (typeof SURFACES)[number];
  grade: (typeof GRADES)[number];
  isRec: boolean;
  stock: string;
  /** Açık = aynı ürünün 1. ve END. kalitesi ayrı stok/fiyatla gösterilir.
   *  Açıkken dualPrice yok sayılır (her kalitenin tek fiyatı olur). */
  dualStock: boolean;
  stockEnd: string;
  priceEnd: string;
  /** Boş = tek fiyat. Dolu = Vadeli/Kart. */
  dualPrice: boolean;
  price: string;
  priceSecond: string;
  priceLabel: string;
  priceSecondLabel: string;
  /** Slot bazında ebat geçersiz kılma (karma sayfa için). Boş = sayfa ebadı. */
  sizeOverride: string;
};

/** PDF kuyruğundaki bir sayfa: o anki sayfa durumunun kopyası. */
type QueueItem = {
  id: string;
  title: string;
  thumb: string | null;
  snapshot: PageState;
};

type PageState = {
  version: 2;
  size: string;
  count: number;
  depot: string;
  brandName: string;
  ground: GroundId;
  accent: string;
  /** "urun" = normal afiş. "kampanya" = yalnız kampanya detayı olan sayfa. */
  pageMode: "urun" | "kampanya";
  campaignOn: boolean;
  /** Vurgunun üstündeki ince satır — "Tamamını alana". */
  campaignLead: string;
  /** Kalın vurgu satırı — "1 palet 10×20 hediye". */
  campaignTitle: string;
  campaignText: string;
  campaignNote: string;
  /** Kampanya sayfasında gösterilecek hediye ürün sayısı (0-3).
   *  Ürünler normal slots dizisinden okunur. */
  giftCount: number;
  footerLeft: string;
  footerRight: string;
  fontScale: number;
  slots: Slot[];
};

/* ----------------------------- yardımcılar ----------------------------- */

function emptySlot(): Slot {
  return {
    productId: null,
    imageUrl: null,
    customName: "",
    surface: "",
    grade: "",
    isRec: false,
    stock: "",
    dualStock: false,
    stockEnd: "",
    priceEnd: "",
    dualPrice: false,
    price: "",
    priceSecond: "",
    priceLabel: "VADELİ",
    priceSecondLabel: "KART",
    sizeOverride: "",
  };
}

/** Bulutta tutulan kayıt listesi satırı (eski stüdyoyla ortak API). */
type DraftSummary = {
  id: string;
  title: string;
  savedAt: string;
  size: string;
  manufacturer: string;
  pageCount: number;
  productNames: string[];
  /** "studio2" = bu stüdyonun kaydı. Yoksa eski stüdyonun kaydıdır. */
  kind?: string;
};

/** Diskten/buluttan gelen kayıt. Şekli garanti değil, doğrulanarak okunur. */
type Studio2Catalog = {
  kind: "studio2";
  version: 2;
  savedAt: string;
  title: string;
  current: PageState;
  queue: QueueItem[];
};

/* --------------------- kayıt doğrulama (savunmacı okuma) --------------------- */

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function pickFrom<T extends readonly string[]>(
  v: unknown,
  list: T,
  fallback: T[number],
): T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v)
    ? (v as T[number])
    : fallback;
}

function normalizeGround(v: unknown): GroundId {
  if (GROUNDS.some((g) => g.id === v)) return v as GroundId;
  const legacy = typeof v === "string" ? LEGACY_GROUNDS[v] : undefined;
  return (legacy as GroundId | undefined) ?? "sicak-orta";
}

function normalizeSlot(raw: unknown): Slot {
  const o = (raw ?? {}) as Record<string, unknown>;
  const base = emptySlot();
  return {
    productId: typeof o.productId === "string" ? o.productId : null,
    imageUrl: typeof o.imageUrl === "string" ? o.imageUrl : null,
    customName: asStr(o.customName),
    surface: pickFrom(o.surface, SURFACES, ""),
    grade: pickFrom(o.grade, GRADES, ""),
    isRec: o.isRec === true,
    stock: asStr(o.stock),
    dualStock: o.dualStock === true,
    stockEnd: asStr(o.stockEnd),
    priceEnd: asStr(o.priceEnd),
    dualPrice: o.dualPrice === true,
    price: asStr(o.price),
    priceSecond: asStr(o.priceSecond),
    priceLabel: asStr(o.priceLabel) || base.priceLabel,
    priceSecondLabel: asStr(o.priceSecondLabel) || base.priceSecondLabel,
    sizeOverride: asStr(o.sizeOverride),
  };
}

/** Geçersizse null döner — bozuk kayıt sayfayı çökertmesin. */
function normalizeState(raw: unknown): PageState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const slotsRaw = Array.isArray(o.slots) ? o.slots : null;
  if (!slotsRaw) return null;
  const rawCount =
    typeof o.count === "number" && Number.isFinite(o.count)
      ? Math.round(o.count)
      : slotsRaw.length;
  const count = Math.min(4, Math.max(1, rawCount || 1));
  const accent = asStr(o.accent);
  const fontScale =
    typeof o.fontScale === "number" && Number.isFinite(o.fontScale)
      ? Math.min(200, Math.max(50, Math.round(o.fontScale)))
      : 100;
  return {
    version: 2,
    size: asStr(o.size) || "60x120",
    count,
    depot: asStr(o.depot) || DEPOTS[0],
    brandName: asStr(o.brandName),
    ground: normalizeGround(o.ground),
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : BRAND_BLUE,
    pageMode: o.pageMode === "kampanya" ? "kampanya" : "urun",
    campaignOn: o.campaignOn === true,
    campaignLead: asStr(o.campaignLead),
    campaignTitle: asStr(o.campaignTitle),
    campaignText: asStr(o.campaignText),
    campaignNote: asStr(o.campaignNote),
    giftCount:
      typeof o.giftCount === "number" && Number.isFinite(o.giftCount)
        ? Math.min(3, Math.max(0, Math.round(o.giftCount)))
        : 0,
    footerLeft: asStr(o.footerLeft),
    footerRight: asStr(o.footerRight),
    fontScale,
    slots: Array.from({ length: count }, (_, i) => normalizeSlot(slotsRaw[i])),
  };
}

function normalizeQueue(raw: unknown): QueueItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QueueItem[] = [];
  raw.forEach((it, i) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const snapshot = normalizeState(o.snapshot);
    if (!snapshot) return;
    out.push({
      id: asStr(o.id) || `sayfa-${i + 1}`,
      title: asStr(o.title) || `Sayfa ${i + 1}`,
      thumb: typeof o.thumb === "string" ? o.thumb : null,
      snapshot,
    });
  });
  return out;
}

/** "7,5X30" -> {short:7.5, long:30}. Çözülemezse null. */
function parseSize(text: string): { short: number; long: number } | null {
  const m = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/,/g, ".")
    .match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return { short: Math.min(a, b), long: Math.max(a, b) };
}

/** Karonun yatay yerleşimdeki en/boy oranı. Kare -> 1. */
function frameRatioForSize(text: string): number {
  const d = parseSize(text);
  if (!d) return 2;
  return d.long / d.short;
}

function isSquareSize(text: string): boolean {
  const d = parseSize(text);
  if (!d) return false;
  return d.long / d.short < 1.1;
}

/** Ebada göre önerilen ürün sayısı. Kullanıcı yine de serbestçe değiştirir. */
function suggestedCount(text: string): number {
  const d = parseSize(text);
  if (!d) return 3;
  if (isSquareSize(text)) return 4;
  const ratio = d.long / d.short;
  if (ratio >= 4) return 4; // ince çubuklar (20x120, 5x30 ...)
  if (d.long <= 90) return 4; // 30x60, 30x90, 40x80 ...
  return 3; // 60x120, 40x120, 120x280 ...
}

function countOptionsFor(text: string): number[] {
  return isSquareSize(text) ? [1, 2, 3, 4] : [1, 2, 3, 4];
}

function displayName(p: Product | undefined, s: Slot): string {
  const manual = s.customName.trim();
  if (manual) return manual.toUpperCase();
  if (!p) return "";
  return `${p.name} ${s.surface}`.trim().toUpperCase();
}

function gradeLabel(s: Slot): string {
  if (!s.grade) return "";
  const base = s.grade === "1." ? "1. KALİTE" : "END.";
  return s.isRec ? `REC ${base}` : base;
}

/** Türkçe biçimli sayıyı çözer: "1.240" -> 1240, "12,5" -> 12.5.
 *  Tek nokta üç haneli bir kuyruk getiriyorsa binlik ayracı sayılır,
 *  aksi hâlde ondalık nokta kabul edilir ("12.5" -> 12.5). */
function parseTrNumber(v: string): number {
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

/** Cloudinary görselini küçük önizlemeye çevirir. Seçicide tam boy
 *  orijinalleri (her biri MB'larca) çekmek tarayıcıyı kilitliyordu. */
function thumbUrl(url: string, w = 320): string {
  const u = String(url ?? "");
  if (!u.includes("res.cloudinary.com") || !u.includes("/upload/")) return u;
  if (/\/upload\/(c_|w_|h_|q_|f_)/.test(u)) return u;
  return u.replace("/upload/", `/upload/w_${w},c_limit,q_auto,f_auto/`);
}

/** Karoyu zeminden kaldıran derinlik. Karo boyutuna göre ölçeklenir.
 *
 *  Açık zeminde düz gölge yeter. Koyu zeminde siyahın daha koyusu olmadığı
 *  için gölge okunmaz; oraya ÜÇ katman birden gider:
 *    1. üst kenarda ince ışık — karo ışığı yakalıyormuş gibi,
 *    2. altta sıkı temas gölgesi,
 *    3. karonun çevresine geniş, çok soluk bir ışık havuzu — zemin karonun
 *       etrafında hafifçe aydınlanır, gölge artık siyahın değil bu
 *       aydınlığın üstüne düşer. Yumuşak siyahta koyu karoyu ayıran şey bu.
 */
function tileShadow(darkGround: boolean, h: number): string {
  const blur = Math.max(18, Math.min(58, Math.round(h * 0.11)));
  const y = Math.round(blur * 0.46);
  const nearBlur = Math.round(blur * 0.3);
  const nearY = Math.max(2, Math.round(y * 0.26));
  if (!darkGround) {
    return `0 ${y}px ${blur}px rgba(0,0,0,.22), 0 ${nearY}px ${nearBlur}px rgba(0,0,0,.13)`;
  }
  const pool = Math.round(blur * 2.7);
  const spread = Math.round(blur * 0.55);
  return [
    "0 -1px 0 rgba(255,255,255,.30)",
    `0 ${y}px ${blur}px rgba(0,0,0,.80)`,
    `0 ${nearY}px ${nearBlur}px rgba(0,0,0,.62)`,
    `0 0 ${pool}px ${spread}px rgba(255,255,255,.085)`,
  ].join(", ");
}

function digits(v: string) {
  return v.replace(/[^\d]/g, "");
}

function groundOf(id: GroundId) {
  return (
    GROUNDS.find((g) => g.id === id) ??
    GROUNDS.find((g) => g.id === LEGACY_GROUNDS[id as string]) ??
    GROUNDS[2]
  );
}

/* --------------------------- karo görseli --------------------------- */

/**
 * Karoyu kendi oranıyla, kırpmadan yerleştirir.
 *
 * Fotoğraf dikey çekilmişse ve çerçeve yataysa görsel bir kez tuvale
 * çevrilerek yeniden üretilir; böylece <img> etiketinin doğal oranı zaten
 * doğru olur. Bunun iki faydası var: object-cover ile karonun üçte ikisi
 * kesilmez, ve boyutlandırmayı CSS'in aspect-ratio davranışına bırakmak
 * yerine tarayıcının kendi "sığdır" mantığına bırakırız — max-width/
 * max-height + auto ile oran hiçbir koşulda ezilmez.
 */
function TileImage({
  src,
  alt,
  ratio,
  maxHeight,
  shadow,
  onNaturalRatio,
}: {
  src: string;
  alt: string;
  ratio: number;
  /** Tuval pikseli cinsinden tavan. Ölçülmediyse kapsayıcının %100'ü. */
  maxHeight?: number;
  /** Karoyu zeminden kaldıran gölge (box-shadow değeri). */
  shadow?: string;
  onNaturalRatio?: (r: number) => void;
}) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setResolved(null);
    if (!src) return;

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (dead) return;
      onNaturalRatio?.(img.naturalWidth / img.naturalHeight);

      const frameLandscape = ratio >= 1;
      const photoLandscape = img.naturalWidth >= img.naturalHeight;
      const mustRotate = frameLandscape !== photoLandscape;
      // Çevirdikten sonraki kaynak ölçüleri.
      const srcW = mustRotate ? img.naturalHeight : img.naturalWidth;
      const srcH = mustRotate ? img.naturalWidth : img.naturalHeight;
      const srcRatio = srcW / srcH;
      const needsCrop = Math.abs(srcRatio - ratio) / ratio > 0.01;

      if (!mustRotate && !needsCrop) {
        setResolved(src);
        return;
      }

      try {
        // Ebadın oranına ORTADAN kırp: karo afişte her zaman gerçek
        // oranında görünür (30x90 = 1:3), foto oranı ne olursa olsun.
        let cropW = srcW;
        let cropH = srcH;
        if (srcRatio > ratio) cropW = srcH * ratio;
        else cropH = srcW / ratio;

        // Bellek için uzun kenarı sınırla.
        const MAX = 2400;
        const k = Math.min(1, MAX / Math.max(cropW, cropH));
        const outW = Math.max(1, Math.round(cropW * k));
        const outH = Math.max(1, Math.round(cropH * k));

        const c = document.createElement("canvas");
        c.width = outW;
        c.height = outH;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("2d yok");
        ctx.imageSmoothingQuality = "high";
        ctx.translate(outW / 2, outH / 2);
        if (mustRotate) ctx.rotate(Math.PI / 2);
        // Çevirdikten sonra kaynak eksenleri yer değiştirir.
        const drawW = mustRotate ? outH : outW;
        const drawH = mustRotate ? outW : outH;
        const sw = mustRotate ? cropH : cropW;
        const sh = mustRotate ? cropW : cropH;
        const sx = (img.naturalWidth - sw) / 2;
        const sy = (img.naturalHeight - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
        setResolved(c.toDataURL("image/jpeg", 0.94));
      } catch {
        // Tuval kirlenirse (CORS) kırpamayız; bozmaktansa olduğu gibi göster.
        setResolved(src);
      }
    };
    img.onerror = () => {
      if (!dead) setResolved(src);
    };
    img.src = src;
    return () => {
      dead = true;
    };
  }, [src, ratio, onNaturalRatio]);

  if (!resolved) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolved}
      alt={alt}
      crossOrigin="anonymous"
      style={{
        maxWidth: "100%",
        maxHeight: maxHeight ? `${maxHeight}px` : "100%",
        width: "auto",
        height: "auto",
        display: "block",
        boxShadow: shadow,
      }}
    />
  );
}

/** Seçicideki kart görseli. Tembel yüklenir, yüklenemezse kart çökmez —
 *  eskiden bozuk görseller listeyi ince şeritlere çeviriyordu. */
function PickerThumb({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative w-full bg-zinc-100" style={{ aspectRatio: "3 / 2" }}>
      {failed || !src ? (
        <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-zinc-400">
          görsel yok
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

/** Ürün seçilmemiş slot için, ebadın oranını koruyan yer tutucu. */
function TilePlaceholder({
  ratio,
  color,
  maxHeight,
}: {
  ratio: number;
  color: string;
  maxHeight?: number;
}) {
  const w = Math.round(ratio * 100);
  return (
    <svg
      viewBox={`0 0 ${w} 100`}
      style={{
        maxWidth: "100%",
        maxHeight: maxHeight ? `${maxHeight}px` : "100%",
        width: "auto",
        height: "auto",
        display: "block",
      }}
      aria-hidden="true"
    >
      <rect
        x="1"
        y="1"
        width={w - 2}
        height="98"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
    </svg>
  );
}

/* ------------------------------ rozetler ------------------------------ */

function GradeChip({
  text,
  accent,
  ink,
  bg,
  scale,
}: {
  text: string;
  accent: string;
  ink: string;
  /** Sayfa zemini. "1." rozetinin yazı rengi bu — zemin ink ile zaten
   *  kontrastlı olduğu için rozet her zeminde okunur kalır. */
  bg: string;
  scale: number;
}) {
  if (!text) return null;
  const primary = text.includes("1.");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: primary ? ink : accent,
        color: primary ? bg : "#FFFFFF",
        fontSize: Math.round(21 * scale),
        fontWeight: 850,
        letterSpacing: ".06em",
        padding: `${Math.round(7 * scale)}px ${Math.round(13 * scale)}px`,
        borderRadius: Math.round(8 * scale),
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function GiftIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
      <path d="M12 8v13" />
      <path d="M12 8S10 2.8 7.4 4.4C5.4 5.6 7 8 12 8z" />
      <path d="M12 8s2-5.2 4.6-3.6C18.6 5.6 17 8 12 8z" />
    </svg>
  );
}

/* ------------------------------ bilgi bloğu ------------------------------ */

function PriceBlock({
  slot,
  scale,
  muted,
}: {
  slot: Slot;
  scale: number;
  muted: string;
}) {
  const dash = "—";
  const unit = (
    <div
      style={{
        fontSize: Math.round(18 * scale),
        fontWeight: 600,
        letterSpacing: ".11em",
        color: muted,
        marginTop: Math.round(6 * scale),
      }}
    >
      + KDV / m²
    </div>
  );

  // Tek ve çift fiyat aynı yüksekliği kaplar; aksi hâlde satırlar kayıyor.
  const boxHeight = Math.round(108 * scale);

  if (slot.dualPrice) {
    const line = (label: string, value: string, big: boolean) => {
      const fs = Math.round((big ? 42 : 36) * scale);
      return (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "flex-end",
            gap: Math.round(12 * scale),
          }}
        >
          <span
            style={{
              fontSize: Math.round(18 * scale),
              fontWeight: 700,
              letterSpacing: ".12em",
              color: muted,
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: fs,
              fontWeight: 820,
              letterSpacing: "-.02em",
              lineHeight: 1,
            }}
          >
            {value.trim() || dash}
            <span style={{ fontSize: Math.round(fs * 0.5), fontWeight: 700 }}> ₺</span>
          </span>
        </div>
      );
    };
    return (
      <div
        style={{
          height: boxHeight,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
      >
        {line(slot.priceLabel || "VADELİ", slot.price, true)}
        <div style={{ height: Math.round(5 * scale) }} />
        {line(slot.priceSecondLabel || "KART", slot.priceSecond, false)}
        {unit}
      </div>
    );
  }

  const fs = Math.round(56 * scale);
  return (
    <div
      style={{
        height: boxHeight,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{
          fontSize: fs,
          fontWeight: 820,
          lineHeight: 0.92,
          letterSpacing: "-.02em",
        }}
      >
        {slot.price.trim() || dash}
        <span style={{ fontSize: Math.round(fs * 0.52), fontWeight: 700 }}> ₺</span>
      </div>
      {unit}
    </div>
  );
}

function StockLine({
  value,
  scale,
  muted,
  ink,
}: {
  value: string;
  scale: number;
  muted: string;
  ink: string;
}) {
  return (
    // Stok, müşterinin uzaktan okuyacağı bilgi — fiyatla aynı ağırlıkta.
    <div style={{ display: "flex", alignItems: "baseline", gap: Math.round(10 * scale) }}>
      <span
        style={{
          fontSize: Math.round(19 * scale),
          fontWeight: 700,
          letterSpacing: ".14em",
          color: muted,
        }}
      >
        STOK
      </span>
      <span
        style={{
          fontSize: Math.round(52 * scale),
          fontWeight: 850,
          letterSpacing: "-.02em",
          lineHeight: 1,
          color: ink,
        }}
      >
        {value.trim() || "—"}
      </span>
      <span style={{ fontSize: Math.round(26 * scale), fontWeight: 750, color: ink }}>
        m²
      </span>
    </div>
  );
}

/** Çift stok satırlarında kullanılan sade fiyat. Sabit yükseklik yok;
 *  satırın kendi hizasına oturur. */
function PriceValue({
  value,
  scale,
  muted,
}: {
  value: string;
  scale: number;
  muted: string;
}) {
  const fs = Math.round(46 * scale);
  return (
    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
      <div style={{ fontSize: fs, fontWeight: 820, lineHeight: 0.95, letterSpacing: "-.02em" }}>
        {value.trim() || "—"}
        <span style={{ fontSize: Math.round(fs * 0.52), fontWeight: 700 }}> ₺</span>
      </div>
      <div
        style={{
          fontSize: Math.round(17 * scale),
          fontWeight: 600,
          letterSpacing: ".11em",
          color: muted,
          marginTop: Math.round(4 * scale),
        }}
      >
        + KDV / m²
      </div>
    </div>
  );
}

/* ================================ SAYFA ================================ */

export default function Studio2Page() {
  const [products, setProducts] = useState<Product[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [pickerTab, setPickerTab] = useState<"katalog" | "kutuphane">("katalog");
  const [libLoading, setLibLoading] = useState(false);
  const [libError, setLibError] = useState<string | null>(null);
  const [libLoaded, setLibLoaded] = useState(false);
  /** Seçicide bir seferde çizilen kart sayısı. Tümünü basmak kasıyordu. */
  const [showCount, setShowCount] = useState(PICKER_PAGE);

  /* kayıtlı afişler */
  const [docTitle, setDocTitle] = useState("");
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<DraftSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedSearch, setSavedSearch] = useState("");
  const jsonRef = useRef<HTMLInputElement | null>(null);
  const xlsxRef = useRef<HTMLInputElement | null>(null);

  /* Excel'den kuyruk */
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  /** Satır anahtarı -> kullanıcının seçtiği ürün kimliği ("" = eşleşme yok). */
  const [importPick, setImportPick] = useState<Record<string, string>>({});

  /** Yüklenen görsellerin kendi en/boy oranı (url -> oran). Ebatla
   *  uyuşmayan görseli panelde uyarmak için. */
  const [photoRatio, setPhotoRatio] = useState<Record<string, number>>({});

  /** Ürün alanının tuval pikseli cinsinden yüksekliği (ölçülür). */
  const [productAreaH, setProductAreaH] = useState(0);
  const areaRef = useRef<HTMLDivElement | null>(null);

  /** Yazı ölçeği kutusunun ham metni. Sayıya bağlanırsa "1" yazarken 60'a
   *  yapışıyor, silmek imkânsız hâle geliyor. */
  const [fontScaleText, setFontScaleText] = useState("100");
  const [lastFontScale, setLastFontScale] = useState(100);

  const [state, setState] = useState<PageState>(() => ({
    version: 2,
    size: "60x120",
    count: 3,
    depot: DEPOTS[0],
    brandName: "GÜRAL SERAMİK",
    ground: "sicak-orta" as const,
    accent: BRAND_BLUE,
    pageMode: "urun" as const,
    campaignOn: false,
    campaignLead: "Tamamını alana",
    campaignTitle: "1 palet 10×20 hediye",
    campaignText: "",
    campaignNote: "Bir palet 96 m² · Kampanya stoklarla sınırlıdır",
    giftCount: 0,
    footerLeft: "FİYATLAR KDV HARİÇTİR",
    footerRight: "STOKLARLA SINIRLIDIR",
    fontScale: 100,
    slots: [emptySlot(), emptySlot(), emptySlot()],
  }));

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadTarget = useRef<number | null>(null);

  const ground = groundOf(state.ground);
  const scale = state.fontScale / 100;

  // Ölçek dışarıdan değişirse (kayıt açma, kuyruk sayfası) kutuyu eşitle.
  if (lastFontScale !== state.fontScale) {
    setLastFontScale(state.fontScale);
    setFontScaleText(String(state.fontScale));
  }
  const muted =
    ground.ink === "#FFFFFF" ? "rgba(255,255,255,.62)" : "rgba(0,0,0,.55)";

  const productsById = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  useEffect(() => {
    let dead = false;
    fetch("/api/products", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!dead && Array.isArray(d)) setProducts(d as Product[]);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, []);

  const loadLibrary = useCallback(() => {
    setLibLoading(true);
    setLibError(null);
    fetch("/api/uploads", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Kütüphane alınamadı (${r.status})`);
        return r.json();
      })
      .then((d) => {
        const items = Array.isArray(d?.items) ? (d.items as LibraryItem[]) : [];
        // url'siz kayıtlar seçicide görünmez ince şeritler bırakıyordu.
        setLibrary(items.filter((it) => it && typeof it.url === "string" && it.url));
      })
      .catch((e: unknown) => setLibError((e as Error)?.message ?? "Kütüphane alınamadı"))
      .finally(() => setLibLoading(false));
  }, []);

  /* ---------------------------- state yardımcıları ---------------------------- */

  function patch(p: Partial<PageState>) {
    setState((s) => ({ ...s, ...p }));
  }

  function patchSlot(i: number, p: Partial<Slot>) {
    setState((s) => ({
      ...s,
      slots: s.slots.map((sl, idx) => (idx === i ? { ...sl, ...p } : sl)),
    }));
  }

  function setCount(n: number) {
    setState((s) => {
      const slots = Array.from({ length: n }, (_, i) => s.slots[i] ?? emptySlot());
      return { ...s, count: n, slots };
    });
  }

  function setGiftCount(n: number) {
    setState((st) => {
      const need = Math.max(st.count, n);
      const slots = Array.from({ length: need }, (_, i) => st.slots[i] ?? emptySlot());
      return { ...st, giftCount: n, slots };
    });
  }

  function setSize(size: string) {
    setState((s) => {
      const n = Math.min(
        isSquareSize(size) ? 4 : 4,
        s.count || suggestedCount(size),
      );
      const slots = Array.from({ length: n }, (_, i) => s.slots[i] ?? emptySlot());
      return { ...s, size, count: n, slots };
    });
  }

  function clearSlot(i: number) {
    patchSlot(i, emptySlot());
  }

  function moveSlot(i: number, dir: -1 | 1) {
    setState((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.slots.length) return s;
      const slots = s.slots.slice();
      [slots[i], slots[j]] = [slots[j], slots[i]];
      return { ...s, slots };
    });
  }

  /* ------------------------------- görsel seçimi ------------------------------- */

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const bySize = products.filter(
      (p) => p.size.toLowerCase() === state.size.toLowerCase(),
    );
    const pool = bySize.length ? bySize : products;
    if (!q) return pool;
    return pool.filter(
      (p) =>
        p.name.toLocaleLowerCase("tr").includes(q) ||
        p.brand.toLocaleLowerCase("tr").includes(q),
    );
  }, [products, query, state.size]);

  /** Kütüphanede de arama çalışsın — eskiden sorgu yalnızca kataloğa
   *  uygulanıyordu, kütüphane sekmesinde yazmak hiçbir şey yapmıyordu. */
  const libraryFiltered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    if (!q) return library;
    return library.filter((it) => {
      const hay = `${it.displayName ?? ""} ${it.publicId}`.toLocaleLowerCase("tr");
      return hay.includes(q);
    });
  }, [library, query]);

  function pickProduct(i: number, p: Product) {
    patchSlot(i, { productId: p.id, imageUrl: p.image, customName: "" });
    setPickerFor(null);
  }

  function pickLibrary(i: number, item: LibraryItem) {
    patchSlot(i, { productId: null, imageUrl: item.url });
    setPickerFor(null);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const idx = uploadTarget.current;
    e.target.value = "";
    if (!file || idx == null) return;
    try {
      setBusy("Görsel yükleniyor…");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { url?: string };
      if (d?.url) patchSlot(idx, { productId: null, imageUrl: d.url });
      // Yeni görsel kütüphanede görünsün; kütüphane hiç açılmadıysa boşuna çekme.
      if (libLoaded) loadLibrary();
      setMsg("Görsel yüklendi ✓");
    } catch {
      setMsg("Görsel yüklenemedi");
    } finally {
      setBusy(null);
      uploadTarget.current = null;
    }
  }

  /* --------------------------------- dışa aktarım --------------------------------- */

  const fileBase = useMemo(() => {
    if (state.pageMode === "kampanya") {
      const t = state.campaignTitle.trim() || state.campaignLead.trim() || "kampanya";
      return t.replace(/[\\/:*?"<>|]/g, "-");
    }
    const parts = [state.brandName, state.size, state.depot]
      .map((x) => (x || "").trim())
      .filter(Boolean)
      .join(" ");
    return (parts || "afis").replace(/[\\/:*?"<>|]/g, "-");
  }, [
    state.pageMode,
    state.campaignLead,
    state.campaignTitle,
    state.brandName,
    state.size,
    state.depot,
  ]);

  /** Kanvastaki tüm görseller yüklenene kadar bekler. Kuyruk dışa aktarımında
   *  sayfa değiştikten sonra ekran görüntüsü almadan önce şart. */
  /** Kanvas beklenen sayfayı gösterip tüm görselleri yükleyene kadar bekler.
   *  expectedSnap verilirse önce DOM'un o sayfaya geçmesi beklenir. */
  async function waitForCanvas(
    expectedImages: number,
    expectedSnap?: string,
    timeout = 12000,
  ) {
    const start = Date.now();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (Date.now() - start < timeout) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const node = document.getElementById("afis-kanvas");
      const committed =
        !expectedSnap || node?.getAttribute("data-snap") === expectedSnap;
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>("#afis-kanvas img"),
      );
      // "complete" hem yüklenen hem HATA VEREN görsel için true olur. Eskiden
      // naturalWidth>0 şartı vardı; katalogda fotoğrafı eksik tek bir ürün
      // bütün dışa aktarımı sayfa başına 12 saniye bekletiyordu.
      const ready =
        committed &&
        imgs.length >= expectedImages &&
        imgs.every((i) => i.complete);
      if (ready) {
        // Bir kare daha: son yerleşim boyansın.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await sleep(140);
        return;
      }
      await sleep(60);
    }
  }

  function snapKey(st: PageState) {
    return JSON.stringify(st);
  }

  function expectedImageCount(st: PageState) {
    // kampanya sayfası: logo + hediye ürün görselleri
    if (st.pageMode === "kampanya") {
      return st.slots.slice(0, st.giftCount).filter((x) => x.imageUrl).length + 1;
    }
    // slot görselleri + logo
    return st.slots.slice(0, st.count).filter((x) => x.imageUrl).length + 1;
  }

  /** bg verilmezse o anki zemin kullanılır. Kuyruk dışa aktarımında MUTLAKA
   *  o sayfanın kendi zemini geçilmeli: bu fonksiyon döngü boyunca aynı
   *  render kapanışında kaldığı için `ground` güncellenmiyor ve bütün
   *  sayfalar butona basıldığı andaki zemin rengiyle basılıyordu (siyah
   *  zeminde koyu yazı, beyaz zeminde beyaz yazı). */
  async function renderJpeg(bg?: string): Promise<string | null> {
    const node = canvasRef.current;
    if (!node) return null;
    const backgroundColor = bg ?? ground.bg;
    // İki geçiş: ilk geçişte fontlar/görseller yerleşiyor.
    await toJpeg(node, { quality: 0.96, width: CANVAS_W, height: CANVAS_H });
    return toJpeg(node, {
      quality: 0.96,
      width: CANVAS_W,
      height: CANVAS_H,
      pixelRatio: 1,
      backgroundColor,
    });
  }

  async function downloadJpg() {
    try {
      setBusy("JPG hazırlanıyor…");
      const url = await renderJpeg();
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBase}.jpg`;
      a.click();
      setMsg("JPG indirildi ✓");
    } catch {
      setMsg("JPG oluşturulamadı");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    try {
      setBusy("PDF hazırlanıyor…");
      const url = await renderJpeg();
      if (!url) return;
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [CANVAS_W, CANVAS_H],
      });
      pdf.addImage(url, "JPEG", 0, 0, CANVAS_W, CANVAS_H);
      pdf.save(`${fileBase}.pdf`);
      setMsg("PDF indirildi ✓");
    } catch {
      setMsg("PDF oluşturulamadı");
    } finally {
      setBusy(null);
    }
  }

  /* --------------------------------- kuyruk --------------------------------- */

  function snapshotTitle(st: PageState) {
    if (st.pageMode === "kampanya") {
      return `KAMPANYA · ${st.campaignTitle.trim() || st.campaignLead.trim() || "başlıksız"}`;
    }
    const names = st.slots
      .slice(0, st.count)
      .map((sl) => {
        const p = sl.productId ? productsById.get(sl.productId) : undefined;
        return displayName(p, sl);
      })
      .filter(Boolean);
    return `${st.size} · ${names[0] ?? "boş"}${names.length > 1 ? ` +${names.length - 1}` : ""}`;
  }

  /** Kanvasın o anki hâlinden küçük önizleme üretir. */
  async function captureThumb(): Promise<string | null> {
    try {
      const node = canvasRef.current;
      if (!node) return null;
      return await toJpeg(node, {
        quality: 0.6,
        width: CANVAS_W,
        height: CANVAS_H,
        canvasWidth: 216,
        canvasHeight: 384,
        backgroundColor: ground.bg,
      });
    } catch {
      return null;
    }
  }

  async function addToQueue() {
    try {
      setBusy("Sayfa kuyruğa ekleniyor…");
      await waitForCanvas(expectedImageCount(state), snapKey(state));
      const thumb = await captureThumb();
      const item: QueueItem = {
        id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        title: snapshotTitle(state),
        thumb,
        snapshot: JSON.parse(JSON.stringify(state)) as PageState,
      };
      setQueue((q) => [...q, item]);
      setMsg(`Kuyruğa eklendi (${queue.length + 1} sayfa) ✓`);
    } catch {
      setMsg("Sayfa kuyruğa eklenemedi");
    } finally {
      setBusy(null);
    }
  }

  function loadFromQueue(id: string) {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    setState(JSON.parse(JSON.stringify(item.snapshot)) as PageState);
    setMsg("Sayfa düzenlemeye alındı");
  }

  /** Kuyruktaki sayfayı ekrandaki hâliyle değiştirir. Küçük önizleme de
   *  yeniden üretilir; eskiden yalnız snapshot değişiyor, kuyrukta hep ilk
   *  hâlin resmi görünüyordu. */
  async function replaceInQueue(id: string) {
    try {
      setBusy("Sayfa güncelleniyor…");
      await waitForCanvas(expectedImageCount(state), snapKey(state));
      const thumb = await captureThumb();
      const title = snapshotTitle(state);
      const snapshot = JSON.parse(JSON.stringify(state)) as PageState;
      setQueue((q) =>
        q.map((it) => (it.id === id ? { ...it, title, thumb, snapshot } : it)),
      );
      setMsg("Kuyruktaki sayfa güncellendi ✓");
    } catch {
      setMsg("Sayfa güncellenemedi");
    } finally {
      setBusy(null);
    }
  }

  function removeFromQueue(id: string) {
    setQueue((q) => q.filter((it) => it.id !== id));
  }

  function moveInQueue(id: string, dir: -1 | 1) {
    setQueue((q) => {
      const i = q.findIndex((it) => it.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= q.length) return q;
      const next = q.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /** Kuyruktaki her sayfayı sırayla kanvasa basıp tek PDF'e ekler. */
  async function downloadQueuePdf() {
    if (!queue.length) {
      setMsg("Kuyruk boş");
      return;
    }
    const saved = JSON.parse(JSON.stringify(state)) as PageState;
    try {
      setBusy("Çok sayfalı PDF hazırlanıyor…");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [CANVAS_W, CANVAS_H],
      });
      for (let i = 0; i < queue.length; i += 1) {
        const item = queue[i];
        setProgress(`${i + 1} / ${queue.length}`);
        setState(item.snapshot);
        await waitForCanvas(
          expectedImageCount(item.snapshot),
          snapKey(item.snapshot),
        );
        const url = await renderJpeg(groundOf(item.snapshot.ground).bg);
        if (!url) continue;
        if (i > 0) pdf.addPage([CANVAS_W, CANVAS_H], "portrait");
        pdf.addImage(url, "JPEG", 0, 0, CANVAS_W, CANVAS_H);
      }
      pdf.save(`${fileBase} (${queue.length} sayfa).pdf`);
      setMsg(`${queue.length} sayfalık PDF indirildi ✓`);
    } catch {
      setMsg("PDF oluşturulamadı");
    } finally {
      setState(saved);
      setProgress(null);
      setBusy(null);
    }
  }

  /* --------------------------- Excel'den kuyruk --------------------------- */

  async function onImportFile(file: File) {
    try {
      setBusy("Excel okunuyor…");
      setImportError(null);
      const rows = /\.(csv|txt|tsv)$/i.test(file.name)
        ? readDelimitedRows(await file.text())
        : await readXlsxRows(await file.arrayBuffer());
      const res = buildImport(rows, products);
      if (!res.counts.toplam) {
        throw new Error("Dosyada ürün satırı bulunamadı");
      }
      // Kullanıcı seçimlerini otomatik eşleşmelerle doldur.
      const pick: Record<string, string> = {};
      res.pages.forEach((pg) =>
        pg.rows.forEach((r) => {
          pick[r.key] = r.productId ?? "";
        }),
      );
      setImportResult(res);
      setImportPick(pick);
      setImportOpen(true);
      setMsg(null);
    } catch (e) {
      setImportError((e as Error)?.message ?? "Dosya okunamadı");
      setImportResult(null);
      setImportOpen(true);
    } finally {
      setBusy(null);
    }
  }

  function slotFromRow(r: ImportRow, productId: string): Slot {
    const p = productId ? productsById.get(productId) : undefined;
    const sl = emptySlot();
    sl.productId = p ? p.id : null;
    sl.imageUrl = p ? p.image : null;
    // Eşleşme varsa ad otomatik gelsin; yoksa Excel'deki temizlenmiş ad yazılsın.
    sl.customName = p ? "" : r.fallbackName;
    sl.surface = (SURFACES as readonly string[]).includes(r.surface)
      ? (r.surface as Slot["surface"])
      : "";
    sl.grade = r.grade;
    sl.isRec = r.isRec;
    sl.stock = r.stock;
    sl.price = r.price;
    return sl;
  }

  /** Önizlemedeki sayfaları PageState listesine çevirir. Bir sayfada 4'ten
   *  fazla ürün varsa 4'erli bölünür — düzen en fazla 4 taşıyor. */
  function pagesFromImport(res: ImportResult): PageState[] {
    const out: PageState[] = [];
    res.pages.forEach((pg) => {
      for (let i = 0; i < pg.rows.length; i += 4) {
        const chunk = pg.rows.slice(i, i + 4);
        const size =
          chunk.map((r) => r.size).find(Boolean) || state.size;
        out.push({
          ...state,
          pageMode: "urun",
          campaignOn: false,
          size,
          count: chunk.length,
          slots: chunk.map((r) => slotFromRow(r, importPick[r.key] ?? "")),
        });
      }
    });
    return out;
  }

  /** Sayfaları kuyruğa ekler ve her biri için küçük önizleme üretir. */
  async function applyImport() {
    if (!importResult) return;
    const pages = pagesFromImport(importResult);
    if (!pages.length) return;
    const saved = JSON.parse(JSON.stringify(state)) as PageState;
    setImportOpen(false);
    try {
      setBusy("Sayfalar hazırlanıyor…");
      const items: QueueItem[] = [];
      for (let i = 0; i < pages.length; i += 1) {
        const snapshot = pages[i];
        setProgress(`${i + 1} / ${pages.length}`);
        setState(snapshot);
        await waitForCanvas(expectedImageCount(snapshot), snapKey(snapshot));
        const thumb = await captureThumb();
        items.push({
          id: `xls-${i}-${snapshot.size}-${snapshot.count}`,
          title: snapshotTitle(snapshot),
          thumb,
          snapshot,
        });
      }
      setQueue((q) => [...q, ...items]);
      setMsg(`${items.length} sayfa kuyruğa eklendi ✓`);
    } catch {
      setMsg("Sayfalar oluşturulamadı");
    } finally {
      setState(saved);
      setProgress(null);
      setBusy(null);
    }
  }

  /* ---------------------------------- taslak ---------------------------------- */

  /* Görsellerin gerçek oranını ölç (uyarı için). */
  const slotImageKey = state.slots
    .slice(0, state.count)
    .map((sl) => sl.imageUrl ?? "")
    .join("|");

  useEffect(() => {
    let dead = false;
    const urls = slotImageKey.split("|").filter(Boolean);
    for (const url of urls) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (dead || !img.naturalHeight) return;
        const r = img.naturalWidth / img.naturalHeight;
        setPhotoRatio((prev) => (prev[url] != null ? prev : { ...prev, [url]: r }));
      };
      img.src = url;
    }
    return () => {
      dead = true;
    };
  }, [slotImageKey]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    // offsetHeight, kanvasın CSS ölçeğinden etkilenmez — tuval pikseli verir.
    const read = () => {
      const h = el.offsetHeight;
      setProductAreaH((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  });

  /** Görselin oranı seçilen ebattan belirgin farklıysa uyarı metni. */
  function ratioWarning(slot: Slot): string | null {
    if (!slot.imageUrl) return null;
    const nat = photoRatio[slot.imageUrl];
    if (!nat || !Number.isFinite(nat)) return null;
    const size = slot.sizeOverride || state.size;
    const declared = frameRatioForSize(size);
    // Fotoğraf dik çekilmişse çevriliyor; karşılaştırmayı yatık oran üzerinden yap.
    const natL = nat >= 1 ? nat : 1 / nat;
    if (Math.abs(natL - declared) / declared <= 0.08) return null;
    const f = (x: number) => x.toFixed(1).replace(".", ",");
    return `Görselin oranı ${f(natL)}:1 · ${size} ebadı ${f(declared)}:1 — görsel ebada göre ortadan kırpılıyor. Yanlış ürünün fotoğrafı olabilir.`;
  }

  /** Kayıt başlığı: kullanıcı yazdıysa o, yoksa sayfadan türetilen ad. */
  const saveTitle = useMemo(
    () => (docTitle.trim() || fileBase).slice(0, 120),
    [docTitle, fileBase],
  );

  function productNamesOf(st: PageState): string[] {
    return st.slots
      .slice(0, st.count)
      .map((sl) =>
        displayName(sl.productId ? productsById.get(sl.productId) : undefined, sl),
      )
      .filter(Boolean);
  }

  function buildCatalog(): Studio2Catalog {
    return {
      kind: "studio2",
      version: 2,
      savedAt: new Date().toISOString(),
      title: saveTitle,
      current: JSON.parse(JSON.stringify(state)) as PageState,
      queue: JSON.parse(JSON.stringify(queue)) as QueueItem[],
    };
  }

  /** Buluta kaydeder. Aynı başlık varsa üzerine yazar (eski stüdyodaki gibi). */
  async function saveDraft() {
    try {
      setBusy("Kaydediliyor…");
      const names = new Set<string>();
      productNamesOf(state).forEach((n) => names.add(n));
      queue.forEach((it) => productNamesOf(it.snapshot).forEach((n) => names.add(n)));

      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: saveTitle,
          kind: "studio2",
          size: state.size,
          manufacturer: state.brandName,
          pageCount: Math.max(1, queue.length),
          productNames: Array.from(names),
          catalog: buildCatalog(),
        }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ? ` – ${body.error}` : "";
        } catch {}
        throw new Error(`Kaydedilemedi (${res.status})${detail}`);
      }
      const data = (await res.json()) as {
        items?: DraftSummary[];
        overwritten?: boolean;
      };
      if (Array.isArray(data.items)) setSavedItems(data.items);
      setMsg(
        `“${saveTitle}” ${data.overwritten ? "güncellendi" : "kaydedildi"} (${Math.max(1, queue.length)} sayfa) ✓`,
      );
    } catch (e) {
      setMsg((e as Error)?.message ?? "Kaydedilemedi");
    } finally {
      setBusy(null);
    }
  }

  async function refreshSaved() {
    try {
      setSavedLoading(true);
      setSavedError(null);
      const res = await fetch("/api/drafts", { cache: "no-store" });
      if (!res.ok) throw new Error(`Liste alınamadı (${res.status})`);
      const data = (await res.json()) as { items?: DraftSummary[] };
      setSavedItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setSavedError((e as Error)?.message ?? "Liste alınamadı");
    } finally {
      setSavedLoading(false);
    }
  }

  function openSavedModal() {
    setSavedError(null);
    setSavedSearch("");
    setSavedOpen(true);
    void refreshSaved();
  }

  /** Kaydı açar: hem sayfayı hem sayfa kuyruğunu geri yükler. */
  async function openSavedDraft(id: string) {
    try {
      setSavedError(null);
      const res = await fetch(`/api/drafts?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Açılamadı (${res.status})`);
      const data = (await res.json()) as { catalog?: unknown };
      const cat = (data?.catalog ?? {}) as Record<string, unknown>;
      const nextQueue = normalizeQueue(cat.queue);
      // cat.studio2: ilk sürümde kaydedilmiş biçim — geriye dönük uyum.
      const current =
        normalizeState(cat.current) ??
        normalizeState(cat.studio2) ??
        nextQueue[0]?.snapshot ??
        null;
      if (!current) throw new Error("Bu kayıt Stüdyo 2 biçiminde değil");
      setQueue(nextQueue);
      setState(current);
      setDocTitle(asStr(cat.title));
      setSavedOpen(false);
      setMsg(
        `Kayıt açıldı${nextQueue.length ? ` · ${nextQueue.length} sayfa` : ""} ✓`,
      );
    } catch (e) {
      setSavedError((e as Error)?.message ?? "Açılamadı");
    }
  }

  async function deleteSavedDraft(id: string, title: string) {
    if (!window.confirm(`“${title}” silinsin mi?`)) return;
    try {
      setSavedError(null);
      const res = await fetch(`/api/drafts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Silinemedi (${res.status})`);
      const data = (await res.json()) as { items?: DraftSummary[] };
      setSavedItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setSavedError((e as Error)?.message ?? "Silinemedi");
    }
  }

  /* ------------------------- yerel yedek (.json) ------------------------- */

  function exportJson() {
    const blob = new Blob([JSON.stringify(buildCatalog(), null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${saveTitle}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setMsg("Yerel yedek indirildi ✓");
  }

  async function importJson(file: File) {
    try {
      const cat = JSON.parse(await file.text()) as Record<string, unknown>;
      const nextQueue = normalizeQueue(cat.queue);
      const current =
        normalizeState(cat.current) ??
        normalizeState(cat.studio2) ??
        nextQueue[0]?.snapshot ??
        null;
      if (!current) throw new Error("Dosya Stüdyo 2 biçiminde değil");
      setQueue(nextQueue);
      setState(current);
      setDocTitle(asStr(cat.title));
      setMsg("Yedek yüklendi ✓");
    } catch (e) {
      setMsg((e as Error)?.message ?? "Yedek okunamadı");
    }
  }

  /** Listede yalnızca Stüdyo 2 kayıtları — eski stüdyonunkiler burada açılamaz. */
  const savedFiltered = useMemo(() => {
    const q = savedSearch.trim().toLocaleLowerCase("tr");
    return savedItems
      .filter((it) => it.kind === "studio2" || it.title.startsWith("STUDIO2"))
      .filter((it) => {
        if (!q) return true;
        const hay = [it.title, it.size, it.manufacturer, ...(it.productNames ?? [])]
          .join(" ")
          .toLocaleLowerCase("tr");
        return hay.includes(q);
      });
  }, [savedItems, savedSearch]);

  /* ---------------------------------- satış ---------------------------------- */

  async function recordSales() {
    if (state.pageMode === "kampanya") {
      setMsg("Kampanya sayfasında satılacak ürün yok");
      return;
    }
    const today = new Date().toISOString().slice(0, 10);

    // Çift stokta iki ayrı satır çıkar (1. KALİTE ve END.). Studio 1'de END.
    // satırının düşmemesi bir hataydı; burada baştan iki satır yazılıyor.
    const items = state.slots.slice(0, state.count).flatMap((s) => {
      const p = s.productId ? productsById.get(s.productId) : undefined;
      const name = displayName(p, s);
      if (!name) return [];
      const base = {
        date: today,
        brand: p?.brand ?? state.brandName,
        size: s.sizeOverride || state.size,
        customer: "",
        note: state.depot,
        source: "banner" as const,
      };
      const rows: Array<typeof base & {
        productName: string;
        quantity: number;
        unitPrice: number;
      }> = [];
      const push = (suffix: string, stock: string, price: string) => {
        const quantity = parseTrNumber(stock);
        const unitPrice = parseTrNumber(price);
        if (!quantity || !unitPrice) return;
        rows.push({
          ...base,
          productName: suffix ? `${name} ${suffix}` : name,
          quantity,
          unitPrice,
        });
      };
      if (s.dualStock) {
        push(s.isRec ? "REC 1. KALİTE" : "1. KALİTE", s.stock, s.price);
        push(s.isRec ? "REC END." : "END.", s.stockEnd, s.priceEnd);
      } else {
        push(gradeLabel(s), s.stock, s.price);
      }
      return rows;
    });
    if (!items.length) {
      setMsg("Kaydedilecek satır yok (stok ve fiyat gerekli)");
      return;
    }
    try {
      setBusy("Satış kaydediliyor…");
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMsg(`${items.length} satış kaydedildi ✓`);
    } catch {
      setMsg("Satış kaydedilemedi");
    } finally {
      setBusy(null);
    }
  }

  /* --------------------------------- önizleme --------------------------------- */

  const square = isSquareSize(state.size);
  // İki sütun ancak iki SIRA dolduğunda anlamlı (3 ve 4 kare). 2 karede tek
  // sıra dibe yapışıp sayfanın üstünü boş bırakıyordu; onlar alt alta.
  const cols = square && state.count >= 3 ? 2 : 1;
  const cellScale = cols === 2 ? 0.82 : 1;
  const s = scale * cellScale;

  // Bilgi bloğunun yüksekliği SAYFADA TEK olmalı. Slotların bilgi alanı
  // farklı yükseklikte olursa görsele kalan yer de farklı oluyor ve aynı
  // ebattaki karolar farklı boyutta çiziliyordu (çift stoklu slot bunu
  // bozuyordu). En yüksek ihtiyacı hesaplayıp hepsine uyguluyoruz.
  // Ürün alanının gerçek yüksekliği. Karoya ayrılan tavanı buradan
  // hesaplıyoruz ki yazı görselin hemen altında dursun.
  const areaH = productAreaH;
  const darkGround = ground.ink === "#FFFFFF";
  const anyDualStock = state.slots
    .slice(0, state.count)
    .some((sl) => sl.dualStock);
  const infoHeight = Math.round(
    (cols === 1 ? (anyDualStock ? 200 : 132) : anyDualStock ? 182 : 150) * s,
  );

  const slotGap = Math.round(14 * s);
  const rows = cols === 1 ? Math.max(1, state.count) : 2;
  const rowGap = cols === 1 ? 28 : 30;
  const slotH =
    areaH > 0 ? (areaH - 44 - rowGap * (rows - 1)) / rows : 0;
  /** Karonun tuval pikseli cinsinden yükseklik tavanı. 0 = henüz ölçülmedi. */
  const tileMaxH =
    slotH > 0 ? Math.max(60, Math.round(slotH - infoHeight - slotGap)) : 0;

  function SlotView({ index }: { index: number }) {
    const slot = state.slots[index];
    if (!slot) return null;
    const p = slot.productId ? productsById.get(slot.productId) : undefined;
    const size = slot.sizeOverride || state.size;
    const ratio = frameRatioForSize(size);
    const name = displayName(p, slot);
    const chip = gradeLabel(slot);

    /** Çift stok: aynı ürünün 1. ve END. kalitesi, her biri kendi stok ve
     *  fiyatıyla alt alta. Studio 1'deki dualStock davranışının karşılığı. */
    const dualStockRow = (
      label: string,
      stockValue: string,
      priceValue: string,
      primary: boolean,
    ) => (
      <div
        key={label}
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: Math.round(20 * s),
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: Math.round(13 * s), minWidth: 0 }}
        >
          <GradeChip
            text={label}
            accent={state.accent}
            ink={ground.ink}
            bg={ground.bg}
            scale={s * 0.92}
          />
          <StockLine value={stockValue} scale={s * 0.86} muted={muted} ink={ground.ink} />
        </div>
        <PriceValue value={priceValue} scale={s * (primary ? 1 : 0.92)} muted={muted} />
      </div>
    );

    const info = slot.dualStock ? (
      <div
        style={{
          flexShrink: 0,
          height: infoHeight,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          gap: Math.round((cols === 1 ? 14 : 8) * s),
          paddingBottom: Math.round(6 * s),
        }}
      >
        <div
          style={{
            fontSize: Math.round((cols === 1 ? 32 : 27) * s),
            fontWeight: 750,
            lineHeight: 1.05,
          }}
        >
          {name || "—"}
        </div>
        {dualStockRow(slot.isRec ? "REC 1. KALİTE" : "1. KALİTE", slot.stock, slot.price, true)}
        {dualStockRow(slot.isRec ? "REC END." : "END.", slot.stockEnd, slot.priceEnd, false)}
      </div>
    ) : cols === 1 ? (
        <div
          style={{
            flexShrink: 0,
            height: infoHeight,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: Math.round(26 * s),
            paddingBottom: Math.round(6 * s),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(15 * s), minWidth: 0 }}>
            <GradeChip
              text={chip}
              accent={state.accent}
              ink={ground.ink}
              bg={ground.bg}
              scale={s}
            />
            <div>
              <div style={{ fontSize: Math.round(32 * s), fontWeight: 750, lineHeight: 1.05 }}>
                {name || "—"}
              </div>
              <div style={{ marginTop: Math.round(9 * s) }}>
                <StockLine value={slot.stock} scale={s} muted={muted} ink={ground.ink} />
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <PriceBlock slot={slot} scale={s} muted={muted} />
          </div>
        </div>
      ) : (
        <div
          style={{
            flexShrink: 0,
            height: infoHeight,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: Math.round(10 * s),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(10 * s), minWidth: 0 }}>
            <GradeChip
              text={chip}
              accent={state.accent}
              ink={ground.ink}
              bg={ground.bg}
              scale={s}
            />
            <div style={{ fontSize: Math.round(27 * s), fontWeight: 750, lineHeight: 1.05 }}>
              {name || "—"}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: Math.round(14 * s),
            }}
          >
            <StockLine value={slot.stock} scale={s} muted={muted} ink={ground.ink} />
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <PriceBlock slot={slot} scale={s} muted={muted} />
            </div>
          </div>
        </div>
      );

    // 3 karede son ürün alt sırayı tek başına kaplar, ortalanmış durur.
    const spanRow = cols === 2 && state.count === 3 && index === 2;

    return (
      <div
        style={{
          flex: cols === 1 ? 1 : undefined,
          gridColumn: spanRow ? "1 / -1" : undefined,
          // Tek başına kalan ürün, diğerleriyle aynı genişlikte ve ortalanmış
          // olsun — yazıları sayfanın soluna savrulmasın.
          width: spanRow ? "calc(50% - 13px)" : undefined,
          marginInline: spanRow ? "auto" : undefined,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          // Görsel + yazı tek blok olarak dikeyde ortalanır; yazı artık
          // sayfanın dibine değil, karonun hemen altına oturuyor.
          justifyContent: "center",
          gap: slotGap,
        }}
      >
        <div
          style={{
            // Ölçüm gelene kadar eski davranış (esnek kutu) sürer.
            flex: tileMaxH ? "0 1 auto" : 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {slot.imageUrl ? (
            <TileImage
              src={slot.imageUrl}
              alt={name}
              ratio={ratio}
              maxHeight={tileMaxH || undefined}
              shadow={tileShadow(darkGround, tileMaxH || 400)}
            />
          ) : (
            <TilePlaceholder
              ratio={ratio}
              color={muted}
              maxHeight={tileMaxH || undefined}
            />
          )}
        </div>
        {info}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onUpload}
      />
      <input
        ref={xlsxRef}
        type="file"
        accept=".xlsx,.xls,.csv,.tsv,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void onImportFile(f);
        }}
      />
      <input
        ref={jsonRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (f) void importJson(f);
        }}
      />

      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1700px] items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="text-base font-extrabold tracking-tight">
              Afiş Stüdyo <span className="text-zinc-400">2</span>
            </div>
            <Link
              href="/"
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
            >
              Eski stüdyoya dön
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {msg ? (
              <span className="mr-1 text-xs font-semibold text-emerald-700">{msg}</span>
            ) : null}
            {busy ? (
              <span className="mr-1 text-xs font-semibold text-zinc-500">{busy}</span>
            ) : null}
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={Boolean(busy)}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              title="Sayfayı ve tüm sayfa kuyruğunu buluta kaydet — aynı isim üzerine yazar"
            >
              Kaydet
            </button>
            <button
              type="button"
              onClick={() => xlsxRef.current?.click()}
              disabled={Boolean(busy)}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              title="Stok Excel'inden sayfa kuyruğu oluştur"
            >
              Excel&apos;den Kuyruk
            </button>
            <button
              type="button"
              onClick={openSavedModal}
              disabled={Boolean(busy)}
              className="rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
              title="Kayıtlı afişleri aç / ürün ismiyle ara"
            >
              Kayıtlı Afişler
            </button>
            <button
              type="button"
              onClick={() => void recordSales()}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
            >
              Satış Kaydet
            </button>
            <button
              type="button"
              onClick={() => void downloadJpg()}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
            >
              JPG
            </button>
            <button
              type="button"
              onClick={() => void downloadPdf()}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
            >
              Bu Sayfa PDF
            </button>
            <button
              type="button"
              onClick={() => void addToQueue()}
              className="rounded-lg border border-zinc-900 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
            >
              + Kuyruğa Ekle
            </button>
            <button
              type="button"
              onClick={() => void downloadQueuePdf()}
              disabled={!queue.length}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-300"
            >
              PDF İndir{queue.length ? ` (${queue.length} sayfa)` : ""}
              {progress ? ` · ${progress}` : ""}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1700px] grid-cols-1 gap-6 p-5 lg:grid-cols-[420px_minmax(0,1fr)]">
        {/* ------------------------------ SOL PANEL ------------------------------ */}
        <div className="space-y-4">
          <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <div className="mb-3 text-sm font-bold">Sayfa</div>

            <div className="mb-3">
              <div className="mb-1 text-xs font-semibold text-zinc-600">
                Sayfa türü
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["urun", "Ürün afişi"],
                    ["kampanya", "Kampanya sayfası"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      patch(
                        // Kampanya düzeni kâğıt hissi için açık zemine göre
                        // kuruldu; koyu zeminden geliyorsa beyaza alıyoruz.
                        mode === "kampanya" && ground.ink === "#FFFFFF"
                          ? { pageMode: mode, ground: groundId(ground.family, "beyaz") }
                          : { pageMode: mode },
                      )
                    }
                    className={[
                      "rounded-lg px-3 py-2 text-sm font-semibold",
                      state.pageMode === mode
                        ? "bg-zinc-900 text-white"
                        : "border border-zinc-200 bg-white hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {state.pageMode === "kampanya" ? (
                <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                  Ürün afişi düzeni yok; kampanya metni ve istersen hediye
                  ürünler basılır. Kuyruğa ekleyip diğer sayfalarla aynı PDF
                  içine koyabilirsin.
                </div>
              ) : null}
            </div>

            {state.pageMode === "urun" ? (
              <>
            <label className="mb-3 block space-y-1">
              <div className="text-xs font-semibold text-zinc-600">Ebat</div>
              <select
                value={state.size}
                onChange={(e) => setSize(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                {SIZES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              <div className="pt-1 text-[11px] text-zinc-500">
                {square ? "Kare — 2 sütun, en fazla 4 ürün" : "Dikdörtgen — tek sütun, alt alta"}
                {" · "}önerilen: {suggestedCount(state.size)} ürün
              </div>
            </label>

            <div className="mb-3 space-y-1">
              <div className="text-xs font-semibold text-zinc-600">Ürün sayısı</div>
              <div className="flex gap-2">
                {countOptionsFor(state.size).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={[
                      "h-9 flex-1 rounded-lg border text-sm font-bold",
                      state.count === n
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
              </>
            ) : null}

            <div className="mb-3 grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <div className="text-xs font-semibold text-zinc-600">Sevk yeri</div>
                <input
                  list="depots"
                  value={state.depot}
                  onChange={(e) => patch({ depot: e.target.value.toUpperCase() })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
                <datalist id="depots">
                  {DEPOTS.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
              </label>
              <label className="space-y-1">
                <div className="text-xs font-semibold text-zinc-600">Marka</div>
                <input
                  value={state.brandName}
                  onChange={(e) => patch({ brandName: e.target.value.toUpperCase() })}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mb-3 space-y-1">
              <div className="text-xs font-semibold text-zinc-600">Zemin</div>
              <div className="mb-2 flex gap-2">
                {GROUND_FAMILIES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => patch({ ground: groundId(f.id, ground.tone) })}
                    className={[
                      "h-8 flex-1 rounded-lg border text-xs font-semibold",
                      ground.family === f.id
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {GROUND_TONES.map((t) => {
                  const g = groundOf(groundId(ground.family, t));
                  return (
                    <button
                      key={t}
                      type="button"
                      title={g.label}
                      onClick={() => patch({ ground: g.id })}
                      className={[
                        "h-9 flex-1 rounded-lg border text-[11px] font-bold",
                        state.ground === g.id
                          ? "border-zinc-900 ring-2 ring-zinc-900"
                          : "border-zinc-200",
                      ].join(" ")}
                      style={{ background: g.bg, color: g.ink }}
                    >
                      {TONE_LABEL[t]}
                    </button>
                  );
                })}
              </div>
              <div className="pt-1 text-[11px] text-zinc-500">
                Orta ton hem koyu hem açık karoyu ayırır. Siyahta ayrımı
                karonun etrafındaki ışık havuzu sağlar.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <div className="text-xs font-semibold text-zinc-600">Vurgu rengi</div>
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    value={state.accent}
                    onChange={(e) => patch({ accent: e.target.value.toUpperCase() })}
                    className="h-[38px] w-10 shrink-0 rounded-lg border border-zinc-200 bg-white"
                  />
                  <input
                    value={state.accent}
                    onChange={(e) => patch({ accent: e.target.value })}
                    className="w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
                  />
                </div>
              </label>
              <label className="space-y-1">
                <div className="text-xs font-semibold text-zinc-600">Yazı ölçeği (%)</div>
                <input
                  value={fontScaleText}
                  onChange={(e) => {
                    // Yazarken sınırlama yok: "" ve "1" gibi ara adımlar
                    // serbest. Aksi hâlde her tuşta 60'a yapışıyordu.
                    const raw = digits(e.target.value).slice(0, 3);
                    setFontScaleText(raw);
                    const n = Number(raw);
                    if (raw && n >= FONT_MIN && n <= FONT_MAX) patch({ fontScale: n });
                  }}
                  onBlur={() => {
                    // Alandan çıkarken sınıra çek ve kutuyu gerçek değere eşitle.
                    const n = Number(fontScaleText);
                    const next = fontScaleText
                      ? Math.min(FONT_MAX, Math.max(FONT_MIN, n))
                      : state.fontScale;
                    setFontScaleText(String(next));
                    if (next !== state.fontScale) patch({ fontScale: next });
                  }}
                  inputMode="numeric"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
                <div className="text-[10px] text-zinc-400">
                  {FONT_MIN}–{FONT_MAX} arası. Boş bırakırsan eski değere döner.
                </div>
              </label>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            {state.pageMode === "kampanya" ? (
              <div className="space-y-3">
                <div className="text-sm font-bold">Kampanya sayfası</div>
                <label className="block space-y-1">
                  <div className="text-xs font-semibold text-zinc-600">
                    Üst satır (ince)
                  </div>
                  <input
                    value={state.campaignLead}
                    onChange={(e) => patch({ campaignLead: e.target.value })}
                    placeholder="örn. Tamamını alana"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <div className="text-xs font-semibold text-zinc-600">
                    Vurgu satırı (kalın)
                  </div>
                  <textarea
                    value={state.campaignTitle}
                    onChange={(e) => patch({ campaignTitle: e.target.value })}
                    rows={2}
                    placeholder={"örn. 1 palet 10×20 hediye"}
                    className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                  />
                  <div className="text-[10px] leading-relaxed text-zinc-500">
                    Küçük harf yaz — sayfa tümü büyük harf değil, karışık
                    dizilecek şekilde tasarlandı.
                  </div>
                </label>
                <label className="block space-y-1">
                  <div className="text-xs font-semibold text-zinc-600">
                    Ek satırlar (isteğe bağlı)
                  </div>
                  <textarea
                    value={state.campaignText}
                    onChange={(e) => patch({ campaignText: e.target.value })}
                    rows={2}
                    placeholder="örn. Söke fabrika sevkinde geçerlidir"
                    className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <div className="text-xs font-semibold text-zinc-600">
                    Alt not (küçük yazı)
                  </div>
                  <textarea
                    value={state.campaignNote}
                    onChange={(e) => patch({ campaignNote: e.target.value })}
                    rows={2}
                    placeholder="örn. Kampanya stoklarla sınırlıdır."
                    className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                  />
                </label>

                <div className="border-t border-zinc-100 pt-3">
                  <div className="mb-1 text-xs font-semibold text-zinc-600">
                    Hediye ürün sayısı
                  </div>
                  <div className="flex gap-2">
                    {[0, 1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setGiftCount(n)}
                        className={[
                          "h-9 flex-1 rounded-lg border text-sm font-bold",
                          state.giftCount === n
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-white hover:bg-zinc-50",
                        ].join(" ")}
                      >
                        {n === 0 ? "Yok" : n}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                    Hediye edilen karonun görseli kampanya metninin altında,
                    adı ve ebadıyla basılır.
                  </div>
                </div>

                {state.slots.slice(0, state.giftCount).map((sl, i) => {
                  const pr = sl.productId ? productsById.get(sl.productId) : undefined;
                  return (
                    <div
                      key={i}
                      className="rounded-xl border border-zinc-200 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-bold">Hediye {i + 1}</div>
                        <button
                          type="button"
                          onClick={() => clearSlot(i)}
                          className="rounded border border-zinc-200 px-2 py-1 text-[10px] font-semibold hover:bg-zinc-50"
                        >
                          Temizle
                        </button>
                      </div>
                      <div className="mb-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPickerFor(i);
                            setPickerTab("katalog");
                            setShowCount(PICKER_PAGE);
                          }}
                          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                        >
                          {sl.imageUrl ? "Değiştir" : "Ürün Seç"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            uploadTarget.current = i;
                            fileRef.current?.click();
                          }}
                          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                        >
                          Yükle
                        </button>
                      </div>
                      {sl.imageUrl ? (
                        <div className="mb-2 truncate text-[11px] text-zinc-500">
                          {pr ? `${pr.brand} · ${pr.size} · ${pr.name}` : "Kütüphane görseli"}
                        </div>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <div className="text-xs font-semibold text-zinc-600">
                            Ad (boşsa otomatik)
                          </div>
                          <input
                            value={sl.customName}
                            onChange={(e) => patchSlot(i, { customName: e.target.value })}
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="space-y-1">
                          <div className="text-xs font-semibold text-zinc-600">Ebat</div>
                          <select
                            value={sl.sizeOverride}
                            onChange={(e) => patchSlot(i, { sizeOverride: e.target.value })}
                            className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
                          >
                            <option value="">
                              Ürünün kendi ebadı{pr?.size ? ` (${pr.size})` : ""}
                            </option>
                            {SIZES.map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.campaignOn}
                onChange={(e) => patch({ campaignOn: e.target.checked })}
                className="h-4 w-4 accent-zinc-900"
              />
              <span className="font-bold">Kampanya bandı</span>
            </label>
            {state.campaignOn ? (
              <textarea
                value={state.campaignText}
                onChange={(e) => patch({ campaignText: e.target.value })}
                rows={2}
                className="mt-2 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
              />
            ) : null}
              </>
            )}
          </section>

          <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold">
                Sayfa kuyruğu{" "}
                <span className="text-zinc-400">({queue.length})</span>
              </div>
              {queue.length ? (
                <button
                  type="button"
                  onClick={() => setQueue([])}
                  className="rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-semibold hover:bg-zinc-50"
                >
                  Kuyruğu boşalt
                </button>
              ) : null}
            </div>
            {queue.length === 0 ? (
              <div className="text-[11px] leading-relaxed text-zinc-500">
                Sayfayı hazırlayıp üstteki <b>+ Kuyruğa Ekle</b> ile biriktir,
                sonra hepsini tek PDF olarak indir. Kuyruk, <b>Kaydet</b> ile
                birlikte saklanır.
              </div>
            ) : (
              <div className="space-y-2">
                {queue.map((it, i) => (
                  <div
                    key={it.id}
                    className="flex items-center gap-2 rounded-xl border border-zinc-200 p-2"
                  >
                    <div className="w-6 shrink-0 text-center text-xs font-bold text-zinc-400">
                      {i + 1}
                    </div>
                    {it.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.thumb}
                        alt=""
                        className="h-14 w-8 shrink-0 rounded object-cover ring-1 ring-zinc-200"
                      />
                    ) : (
                      <div className="h-14 w-8 shrink-0 rounded bg-zinc-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-semibold">{it.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => loadFromQueue(it.id)}
                          className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-zinc-50"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => void replaceInQueue(it.id)}
                          className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-zinc-50"
                        >
                          Üzerine yaz
                        </button>
                        <button
                          type="button"
                          onClick={() => moveInQueue(it.id, -1)}
                          className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-zinc-50"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveInQueue(it.id, 1)}
                          className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-zinc-50"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromQueue(it.id)}
                          className="rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-zinc-50"
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-zinc-100 pt-3">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                Kayıt adı
              </label>
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder={fileBase}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
              <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                Aynı adla tekrar kaydedersen eski kaydın üzerine yazılır.
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={exportJson}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                  title="Sayfa + kuyruğu bilgisayara .json olarak indir"
                >
                  Yedeği İndir
                </button>
                <button
                  type="button"
                  onClick={() => jsonRef.current?.click()}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                  title=".json yedeği geri yükle"
                >
                  Yedek Yükle
                </button>
              </div>
            </div>
          </section>

          <section
            className="space-y-3"
            hidden={state.pageMode === "kampanya"}
          >
            {state.slots.map((slot, i) => {
              const p = slot.productId ? productsById.get(slot.productId) : undefined;
              return (
                <div key={i} className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-bold">Ürün {i + 1}</div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveSlot(i, -1)}
                        className="h-8 w-8 rounded-lg border border-zinc-200 text-xs font-bold hover:bg-zinc-50"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveSlot(i, 1)}
                        className="h-8 w-8 rounded-lg border border-zinc-200 text-xs font-bold hover:bg-zinc-50"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => clearSlot(i)}
                        className="h-8 rounded-lg border border-zinc-200 px-2 text-xs font-bold hover:bg-zinc-50"
                      >
                        Temizle
                      </button>
                    </div>
                  </div>

                  <div className="mb-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerFor(i);
                        setPickerTab("katalog");
                      }}
                      className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                    >
                      {slot.imageUrl ? "Değiştir" : "Ürün Seç"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        uploadTarget.current = i;
                        fileRef.current?.click();
                      }}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                    >
                      Yükle
                    </button>
                  </div>

                  {slot.imageUrl ? (
                    <div className="mb-2 truncate text-[11px] text-zinc-500">
                      {p ? `${p.brand} · ${p.size} · ${p.name}` : "Kütüphane görseli"}
                    </div>
                  ) : null}

                  {(() => {
                    const warn = ratioWarning(slot);
                    if (!warn) return null;
                    return (
                      <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
                        {warn}
                      </div>
                    );
                  })()}

                  <label className="mb-2 block space-y-1">
                    <div className="text-xs font-semibold text-zinc-600">Ürün adı (boşsa otomatik)</div>
                    <input
                      value={slot.customName}
                      onChange={(e) => patchSlot(i, { customName: e.target.value })}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                    />
                  </label>

                  <div className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-zinc-600">Yüzey</div>
                      <select
                        value={slot.surface}
                        onChange={(e) =>
                          patchSlot(i, { surface: e.target.value as Slot["surface"] })
                        }
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
                      >
                        {SURFACES.map((x) => (
                          <option key={x} value={x}>
                            {x || "Boş"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-zinc-600">
                        Kalite{slot.dualStock ? " (çift stokta ikisi de basılır)" : ""}
                      </div>
                      <select
                        value={slot.grade}
                        disabled={slot.dualStock}
                        onChange={(e) => patchSlot(i, { grade: e.target.value as Slot["grade"] })}
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm disabled:bg-zinc-100 disabled:text-zinc-400"
                      >
                        {GRADES.map((x) => (
                          <option key={x} value={x}>
                            {x || "Boş"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-end gap-1 pb-2 text-xs font-semibold">
                      <input
                        type="checkbox"
                        checked={slot.isRec}
                        onChange={(e) => patchSlot(i, { isRec: e.target.checked })}
                        className="h-4 w-4 accent-zinc-900"
                      />
                      REC
                    </label>
                  </div>

                  <label className="mb-2 block space-y-1">
                    <div className="text-xs font-semibold text-zinc-600">
                      Bu ürünün ebadı (boşsa sayfa ebadı)
                    </div>
                    <select
                      value={slot.sizeOverride}
                      onChange={(e) => patchSlot(i, { sizeOverride: e.target.value })}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
                    >
                      <option value="">Sayfa ile aynı ({state.size})</option>
                      {SIZES.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-zinc-600">
                        {slot.dualStock ? "1. KALİTE stok (m²)" : "Stok (m²)"}
                      </div>
                      <input
                        value={slot.stock}
                        onChange={(e) => patchSlot(i, { stock: e.target.value })}
                        placeholder="örn. 363"
                        inputMode="decimal"
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs font-semibold text-zinc-600">
                        {slot.dualStock
                          ? "1. KALİTE fiyatı"
                          : slot.dualPrice
                            ? `${slot.priceLabel} fiyatı`
                            : "Fiyat"}
                      </div>
                      <input
                        value={slot.price}
                        onChange={(e) => patchSlot(i, { price: digits(e.target.value) })}
                        placeholder="örn. 370"
                        inputMode="numeric"
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={slot.dualStock}
                      onChange={(e) => patchSlot(i, { dualStock: e.target.checked })}
                      className="h-4 w-4 accent-zinc-900"
                    />
                    <span className="font-semibold">Çift stok (1. KALİTE + END.)</span>
                  </label>

                  {slot.dualStock ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <div className="text-xs font-semibold text-zinc-600">
                          END. stok (m²)
                        </div>
                        <input
                          value={slot.stockEnd}
                          onChange={(e) => patchSlot(i, { stockEnd: e.target.value })}
                          placeholder="örn. 85"
                          inputMode="decimal"
                          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs font-semibold text-zinc-600">END. fiyatı</div>
                        <input
                          value={slot.priceEnd}
                          onChange={(e) => patchSlot(i, { priceEnd: digits(e.target.value) })}
                          placeholder="örn. 290"
                          inputMode="numeric"
                          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  ) : null}

                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={slot.dualPrice}
                      disabled={slot.dualStock}
                      onChange={(e) => patchSlot(i, { dualPrice: e.target.checked })}
                      className="h-4 w-4 accent-zinc-900 disabled:opacity-40"
                    />
                    <span
                      className={
                        slot.dualStock ? "font-semibold text-zinc-400" : "font-semibold"
                      }
                    >
                      Çift fiyat (Vadeli + Kart)
                    </span>
                  </label>
                  {slot.dualStock ? (
                    <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                      Çift stokta her kalitenin kendi fiyatı var; Vadeli/Kart ayrımı
                      aynı anda kullanılamaz.
                    </div>
                  ) : null}

                  {slot.dualPrice && !slot.dualStock ? (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="space-y-1">
                        <div className="text-xs font-semibold text-zinc-600">1. etiket</div>
                        <input
                          value={slot.priceLabel}
                          onChange={(e) => patchSlot(i, { priceLabel: e.target.value.toUpperCase() })}
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs font-semibold text-zinc-600">2. etiket</div>
                        <input
                          value={slot.priceSecondLabel}
                          onChange={(e) =>
                            patchSlot(i, { priceSecondLabel: e.target.value.toUpperCase() })
                          }
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
                        />
                      </label>
                      <label className="space-y-1">
                        <div className="text-xs font-semibold text-zinc-600">2. fiyat</div>
                        <input
                          value={slot.priceSecond}
                          onChange={(e) => patchSlot(i, { priceSecond: digits(e.target.value) })}
                          inputMode="numeric"
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        </div>

        {/* ------------------------------ ÖNİZLEME ------------------------------ */}
        <div>
          <div className="sticky top-[68px]">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-500">
              <span>
                {CANVAS_W}×{CANVAS_H} · {state.size} · {state.count} ürün
              </span>
              <span>Karo her zaman gerçek ebat oranında çizilir</span>
            </div>
            <div
              className="overflow-hidden rounded-2xl ring-1 ring-zinc-200"
              style={{ width: CANVAS_W * 0.42, height: CANVAS_H * 0.42 }}
            >
              <div
                style={{
                  width: CANVAS_W,
                  height: CANVAS_H,
                  transform: "scale(0.42)",
                  transformOrigin: "top left",
                }}
              >
                <div
                  ref={canvasRef}
                  id="afis-kanvas"
                  // Kuyruk dışa aktarımında DOM'un GERÇEKTEN hangi sayfayı
                  // gösterdiğini bilmek için imza. Görsel sayısına bakmak
                  // yetmiyordu; iki sayfada sayı aynıysa React daha commit
                  // etmeden ekran görüntüsü alınıp önceki sayfa basılıyordu.
                  data-snap={snapKey(state)}
                  style={{
                    width: CANVAS_W,
                    height: CANVAS_H,
                    background: ground.bg,
                    color: ground.ink,
                    boxSizing: "border-box",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    fontFamily:
                      "'Helvetica Neue', Inter, system-ui, -apple-system, sans-serif",
                    WebkitFontSmoothing: "antialiased",
                  }}
                >
                  {/* başlık */}
                  <div style={{ flexShrink: 0, padding: "46px 62px 0" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 24,
                      }}
                    >
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={
                            ground.ink === "#FFFFFF"
                              ? "/images/logos/kulalilar-mark-light.png"
                              : "/images/logos/kulalilar-mark-dark.png"
                          }
                          alt="KULALILAR"
                          crossOrigin="anonymous"
                          style={{
                            height: 112,
                            width: "auto",
                            display: "block",
                          }}
                        />
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <span
                          style={{
                            display: "inline-block",
                            background: state.accent,
                            color: "#FFFFFF",
                            fontSize: 26,
                            fontWeight: 850,
                            letterSpacing: ".10em",
                            padding: "9px 19px",
                            borderRadius: 10,
                          }}
                        >
                          {state.depot}
                        </span>
                        <div style={{ fontSize: 34, fontWeight: 800, marginTop: 11 }}>
                          {state.brandName}
                        </div>
                      </div>
                    </div>
                    {state.pageMode === "urun" ? (
                      <div
                        style={{
                          height: 2,
                          background:
                            ground.ink === "#FFFFFF"
                              ? "rgba(255,255,255,.22)"
                              : "rgba(0,0,0,.18)",
                          marginTop: 24,
                        }}
                      />
                    ) : null}
                    {state.pageMode === "urun" ? (
                      <div style={{ marginTop: 20 }}>
                        <span
                          style={{
                            display: "inline-block",
                            background: ground.ink,
                            color: ground.bg,
                            fontSize: 30,
                            fontWeight: 850,
                            letterSpacing: ".06em",
                            padding: "9px 21px",
                            borderRadius: 12,
                          }}
                        >
                          {state.size.replace("x", " × ")}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* ürünler / kampanya sayfası */}
                  {state.pageMode === "kampanya" ? (
                    <div
                      style={{
                        flex: 1,
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        padding: "0 84px",
                        gap: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 26,
                          fontWeight: 750,
                          letterSpacing: ".26em",
                          color: state.accent,
                        }}
                      >
                        KAMPANYA
                      </div>

                      <div
                        style={{
                          marginTop: 26,
                          fontSize: 112,
                          lineHeight: 0.96,
                          letterSpacing: "-.04em",
                        }}
                      >
                        {state.campaignLead.trim() ? (
                          <div style={{ fontWeight: 300, whiteSpace: "pre-line" }}>
                            {state.campaignLead}
                          </div>
                        ) : null}
                        {state.campaignTitle.trim() ? (
                          <div style={{ fontWeight: 780, whiteSpace: "pre-line" }}>
                            {state.campaignTitle}
                          </div>
                        ) : null}
                      </div>

                      {state.campaignText.trim() ? (
                        <div
                          style={{
                            marginTop: 30,
                            fontSize: 44,
                            fontWeight: 400,
                            lineHeight: 1.28,
                            letterSpacing: "-.01em",
                            whiteSpace: "pre-line",
                          }}
                        >
                          {state.campaignText}
                        </div>
                      ) : null}

                      {state.giftCount > 0 ? (
                        <div
                          style={{
                            marginTop: 64,
                            display: "flex",
                            alignItems: "flex-end",
                            gap: state.giftCount > 1 ? 34 : 40,
                          }}
                        >
                          {state.slots.slice(0, state.giftCount).map((sl, i) => {
                            const pr = sl.productId
                              ? productsById.get(sl.productId)
                              : undefined;
                            const gSize = sl.sizeOverride || pr?.size || state.size;
                            const gName = displayName(pr, sl);
                            const gRatio = frameRatioForSize(gSize);
                            const gMaxH =
                              state.giftCount === 1 ? 300 : state.giftCount === 2 ? 250 : 200;
                            const tile = sl.imageUrl ? (
                              <TileImage
                                src={sl.imageUrl}
                                alt={gName}
                                ratio={gRatio}
                                maxHeight={gMaxH}
                                shadow={tileShadow(darkGround, gMaxH)}
                              />
                            ) : (
                              <TilePlaceholder
                                ratio={gRatio}
                                color={muted}
                                maxHeight={gMaxH}
                              />
                            );
                            const label = (
                              <div>
                                <div
                                  style={{
                                    fontSize: state.giftCount === 1 ? 32 : 27,
                                    fontWeight: 750,
                                    lineHeight: 1.25,
                                  }}
                                >
                                  {gName || "—"}
                                </div>
                                <div
                                  style={{
                                    marginTop: 10,
                                    fontSize: state.giftCount === 1 ? 26 : 22,
                                    fontWeight: 650,
                                    letterSpacing: ".06em",
                                    color: muted,
                                  }}
                                >
                                  {gSize.replace("x", " × ")}
                                </div>
                              </div>
                            );
                            // Tek hediyede ad karonun yanında, çoklu hediyede altında.
                            return state.giftCount === 1 ? (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-end",
                                  gap: 40,
                                  minWidth: 0,
                                }}
                              >
                                {tile}
                                <div style={{ paddingBottom: 6, maxWidth: 300 }}>{label}</div>
                              </div>
                            ) : (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 16,
                                  minWidth: 0,
                                }}
                              >
                                {tile}
                                {label}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : cols === 1 ? (
                    <div
                      ref={areaRef}
                      style={{
                        flex: 1,
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 28,
                        padding: "20px 62px 24px",
                      }}
                    >
                      {state.slots.map((_, i) => (
                        <SlotView key={i} index={i} />
                      ))}
                    </div>
                  ) : (
                    <div
                      ref={areaRef}
                      style={{
                        flex: 1,
                        minHeight: 0,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gridTemplateRows: "1fr 1fr",
                        gap: "30px 26px",
                        padding: "20px 62px 24px",
                      }}
                    >
                      {state.slots.map((_, i) => (
                        <SlotView key={i} index={i} />
                      ))}
                    </div>
                  )}

                  {/* kampanya */}
                  {state.pageMode === "urun" &&
                  state.campaignOn &&
                  state.campaignText.trim() ? (
                    <div
                      style={{
                        flexShrink: 0,
                        background: state.accent,
                        color: "#FFFFFF",
                        padding: "24px 62px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 20,
                      }}
                    >
                      <GiftIcon size={52} />
                      <div
                        style={{
                          fontSize: 40,
                          fontWeight: 850,
                          letterSpacing: "-.01em",
                          lineHeight: 1.1,
                          textAlign: "center",
                          whiteSpace: "pre-line",
                        }}
                      >
                        {state.campaignText}
                      </div>
                    </div>
                  ) : null}

                  {state.pageMode === "kampanya" && state.campaignNote.trim() ? (
                    <div
                      style={{
                        flexShrink: 0,
                        padding: "0 84px 10px",
                        fontSize: 24,
                        fontWeight: 600,
                        lineHeight: 1.4,
                        color: muted,
                        whiteSpace: "pre-line",
                      }}
                    >
                      {state.campaignNote}
                    </div>
                  ) : null}

                  {/* alt bilgi */}
                  <div
                    style={{
                      flexShrink: 0,
                      padding: "16px 62px 22px",
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 17,
                      fontWeight: 600,
                      letterSpacing: ".10em",
                      color: muted,
                    }}
                  >
                    <div>{state.footerLeft}</div>
                    <div>{state.footerRight}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------ SEÇİCİ ------------------------------ */}
      {pickerFor !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center gap-2 border-b border-zinc-100 p-3">
              <button
                type="button"
                onClick={() => {
                  setPickerTab("katalog");
                  setShowCount(PICKER_PAGE);
                }}
                className={[
                  "rounded-lg px-3 py-2 text-sm font-semibold",
                  pickerTab === "katalog" ? "bg-zinc-900 text-white" : "hover:bg-zinc-50",
                ].join(" ")}
              >
                Katalog
              </button>
              <button
                type="button"
                onClick={() => {
                  setPickerTab("kutuphane");
                  setShowCount(PICKER_PAGE);
                  // Kütüphane yalnızca ilk açılışta çekilir; her sekme
                  // tıklamasında yeniden çekmek gereksiz bekleme yaratıyordu.
                  if (!libLoaded) {
                    setLibLoaded(true);
                    loadLibrary();
                  }
                }}
                className={[
                  "rounded-lg px-3 py-2 text-sm font-semibold",
                  pickerTab === "kutuphane" ? "bg-zinc-900 text-white" : "hover:bg-zinc-50",
                ].join(" ")}
              >
                Kütüphane
              </button>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowCount(PICKER_PAGE);
                }}
                placeholder={
                  pickerTab === "katalog"
                    ? "Ürün veya marka ara…"
                    : "Dosya adı ara…"
                }
                className="ml-2 flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => setPickerFor(null)}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
              >
                Kapat
              </button>
            </div>
            {(() => {
              const isKat = pickerTab === "katalog";
              const total = isKat ? filtered.length : libraryFiltered.length;
              const shown = Math.min(showCount, total);

              if (!isKat && libLoading) {
                return (
                  <div className="flex-1 p-8 text-center text-sm text-zinc-500">
                    Kütüphane yükleniyor…
                  </div>
                );
              }
              if (!isKat && libError) {
                return (
                  <div className="flex-1 p-8 text-center text-sm">
                    <div className="font-semibold text-red-600">{libError}</div>
                    <button
                      type="button"
                      onClick={loadLibrary}
                      className="mt-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                    >
                      Tekrar dene
                    </button>
                  </div>
                );
              }
              if (total === 0) {
                return (
                  <div className="flex-1 p-8 text-center text-sm text-zinc-500">
                    {query.trim()
                      ? `“${query.trim()}” ile eşleşen görsel yok.`
                      : isKat
                        ? "Katalogda ürün yok."
                        : "Kütüphanede görsel yok. Slottaki Yükle ile ekleyebilirsin."}
                  </div>
                );
              }

              return (
                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
                    {isKat
                      ? filtered.slice(0, shown).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => pickProduct(pickerFor, p)}
                            className="overflow-hidden rounded-xl border border-zinc-200 text-left hover:border-zinc-400"
                          >
                            <PickerThumb src={p.image} alt={p.name} />
                            <div className="p-2">
                              <div className="truncate text-[11px] font-semibold">{p.name}</div>
                              <div className="truncate text-[10px] text-zinc-500">
                                {p.brand} · {p.size}
                              </div>
                            </div>
                          </button>
                        ))
                      : libraryFiltered.slice(0, shown).map((it) => (
                          <button
                            key={it.publicId}
                            type="button"
                            onClick={() => pickLibrary(pickerFor, it)}
                            className="overflow-hidden rounded-xl border border-zinc-200 text-left hover:border-zinc-400"
                          >
                            <PickerThumb src={thumbUrl(it.url)} alt="" />
                            <div className="truncate p-2 text-[11px] font-semibold">
                              {it.displayName || it.publicId.split("/").pop() || "görsel"}
                            </div>
                          </button>
                        ))}
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 pb-4 pt-1">
                    <div className="text-[11px] text-zinc-500">
                      {shown} / {total} görsel
                    </div>
                    {shown < total ? (
                      <button
                        type="button"
                        onClick={() => setShowCount((n) => n + PICKER_PAGE)}
                        className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold hover:bg-zinc-50"
                      >
                        Daha fazla göster
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}

      {/* --------------------- EXCEL İÇE AKTARMA ÖNİZLEMESİ --------------------- */}
      {importOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-zinc-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">Excel&apos;den kuyruk</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                    Sayfa düzeni Excel&apos;deki <b>SAYFA</b> sütunundan geliyor.
                    Sevk yeri, marka, zemin ve yazı ölçeği şu anki sayfa
                    ayarlarından alınır.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setImportOpen(false)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                >
                  Kapat
                </button>
              </div>
              {importError ? (
                <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] font-semibold text-red-700">
                  {importError}
                </div>
              ) : null}
              {importResult ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">
                    {importResult.counts.kesin} eşleşti
                  </span>
                  {importResult.counts.belirsiz ? (
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">
                      {importResult.counts.belirsiz} şüpheli
                    </span>
                  ) : null}
                  {importResult.counts.yok ? (
                    <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">
                      {importResult.counts.yok} bulunamadı
                    </span>
                  ) : null}
                  <span className="text-zinc-500">
                    · {importResult.pages.length} sayfa · {importResult.counts.toplam} ürün
                  </span>
                  {importResult.missingColumns.length ? (
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">
                      eksik sütun: {importResult.missingColumns.join(", ")}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {importResult?.pages.map((pg) => (
                <div key={pg.page} className="mb-4">
                  <div className="mb-1.5 text-xs font-bold text-zinc-500">
                    SAYFA {pg.page}
                    <span className="ml-2 font-semibold text-zinc-400">
                      {pg.rows.length} ürün
                      {pg.rows.length > 4 ? " · 4'erli bölünecek" : ""}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {pg.rows.map((r) => {
                      const picked = importPick[r.key] ?? "";
                      const chosen = picked ? productsById.get(picked) : undefined;
                      const tone = !picked
                        ? "border-red-300 bg-red-50"
                        : r.status === "kesin"
                          ? "border-zinc-200 bg-white"
                          : "border-amber-300 bg-amber-50";
                      return (
                        <div
                          key={r.key}
                          className={`flex items-center gap-3 rounded-xl border p-2.5 ${tone}`}
                        >
                          {chosen ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={chosen.image}
                              alt=""
                              loading="lazy"
                              className="h-11 w-16 shrink-0 rounded object-cover ring-1 ring-black/10"
                            />
                          ) : (
                            <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded bg-zinc-100 text-[9px] font-semibold text-zinc-400">
                              görsel yok
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-semibold">
                              {r.rawName}
                            </div>
                            <div className="mt-0.5 text-[10px] text-zinc-500">
                              {r.size || "ebat?"} · stok {r.stock} m² · {r.price} ₺
                              {r.surface ? ` · ${r.surface}` : ""}
                              {r.grade ? ` · ${r.grade}` : ""}
                              {r.mergedFrom > 1 ? ` · ${r.mergedFrom} lot toplandı` : ""}
                            </div>
                          </div>
                          <select
                            value={picked}
                            onChange={(e) =>
                              setImportPick((prev) => ({
                                ...prev,
                                [r.key]: e.target.value,
                              }))
                            }
                            className="w-64 shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-[11px]"
                          >
                            <option value="">— eşleşme yok (görselsiz) —</option>
                            {(chosen && !r.candidates.some((c) => c.id === chosen.id)
                              ? [chosen, ...r.candidates]
                              : r.candidates
                            ).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} · {c.size}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {importResult ? (
              <div className="flex items-center justify-between gap-3 border-t border-zinc-100 p-4">
                <div className="text-[11px] text-zinc-500">
                  Eşleşmeyen ürünler ada, stoğa ve fiyata sahip olarak eklenir —
                  yalnız görselleri boş kalır.
                </div>
                <button
                  type="button"
                  onClick={() => void applyImport()}
                  className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
                >
                  Kuyruğa Ekle ({pagesFromImport(importResult).length} sayfa)
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* -------------------------- KAYITLI AFİŞLER -------------------------- */}
      {savedOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white">
            <div className="border-b border-zinc-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold">Kayıtlı Afişler</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    Stüdyo 2 kayıtları (tüm sayfalarıyla). Ürün ismiyle arayın,
                    açmak için tıklayın.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSavedOpen(false)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                >
                  Kapat
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={savedSearch}
                  onChange={(e) => setSavedSearch(e.target.value)}
                  placeholder="Kayıt adı, ebat veya ürün ismi ara…"
                  aria-label="Kayıtlı afişlerde ara"
                  className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void refreshSaved()}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
                >
                  Yenile
                </button>
              </div>
              {savedError ? (
                <div className="mt-2 text-[11px] font-semibold text-red-600">
                  {savedError}
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {savedLoading ? (
                <div className="text-sm text-zinc-500">Yükleniyor…</div>
              ) : savedFiltered.length === 0 ? (
                <div className="text-sm text-zinc-500">
                  {savedItems.length
                    ? "Stüdyo 2 kaydı bulunamadı. (Eski stüdyonun kayıtları burada listelenmez.)"
                    : "Henüz kayıt yok. Sayfayı hazırlayıp üstteki Kaydet'e bas."}
                </div>
              ) : (
                <div className="space-y-2">
                  {savedFiltered.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3"
                    >
                      <button
                        type="button"
                        onClick={() => void openSavedDraft(it.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-semibold">
                          {it.title}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                          {[
                            it.size,
                            it.manufacturer,
                            `${it.pageCount} sayfa`,
                            it.savedAt
                              ? new Date(it.savedAt).toLocaleString("tr-TR")
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                        {it.productNames?.length ? (
                          <div className="mt-1 truncate text-[10px] text-zinc-400">
                            {it.productNames.slice(0, 6).join(", ")}
                            {it.productNames.length > 6
                              ? ` +${it.productNames.length - 6}`
                              : ""}
                          </div>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openSavedDraft(it.id)}
                        className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
                      >
                        Aç
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSavedDraft(it.id, it.title)}
                        className="shrink-0 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        Sil
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
