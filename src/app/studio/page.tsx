"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toJpeg } from "html-to-image";
import { jsPDF } from "jspdf";

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
const BRAND_BLUE = "#1C5CA8";

/**
 * Nötr zemin tonları. Orta ton, koyu karo (L≈0.15) ile açık karo (L≈0.70)
 * arasında durduğu için ikisi de zeminden ayrışır — çerçeve/kontur gerekmez.
 */
const GROUNDS = [
  { id: "orta", label: "Nötr orta", bg: "#6A6259", ink: "#FFFFFF" },
  { id: "koyu", label: "Nötr koyu", bg: "#4A453F", ink: "#FFFFFF" },
  { id: "acik", label: "Nötr açık", bg: "#B9B2A8", ink: "#1A1714" },
  { id: "siyah", label: "Siyah", bg: "#131110", ink: "#FFFFFF" },
  { id: "beyaz", label: "Beyaz", bg: "#F4F3F1", ink: "#151311" },
] as const;
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
  campaignOn: boolean;
  campaignText: string;
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
    dualPrice: false,
    price: "",
    priceSecond: "",
    priceLabel: "VADELİ",
    priceSecondLabel: "KART",
    sizeOverride: "",
  };
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

function digits(v: string) {
  return v.replace(/[^\d]/g, "");
}

function groundOf(id: GroundId) {
  return GROUNDS.find((g) => g.id === id) ?? GROUNDS[0];
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
  onNaturalRatio,
}: {
  src: string;
  alt: string;
  ratio: number;
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
      const frameLandscape = ratio >= 1;
      const photoLandscape = img.naturalWidth >= img.naturalHeight;
      if (frameLandscape === photoLandscape) {
        setResolved(src);
        onNaturalRatio?.(img.naturalWidth / img.naturalHeight);
        return;
      }
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalHeight;
        c.height = img.naturalWidth;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("2d yok");
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        setResolved(c.toDataURL("image/jpeg", 0.94));
        onNaturalRatio?.(c.width / c.height);
      } catch {
        // Tuval kirlenirse çevirmeden göster; kırpmaktansa dik göstermek yeğdir.
        setResolved(src);
        onNaturalRatio?.(img.naturalWidth / img.naturalHeight);
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
        maxHeight: "100%",
        width: "auto",
        height: "auto",
        display: "block",
      }}
    />
  );
}

/** Ürün seçilmemiş slot için, ebadın oranını koruyan yer tutucu. */
function TilePlaceholder({ ratio, color }: { ratio: number; color: string }) {
  const w = Math.round(ratio * 100);
  return (
    <svg
      viewBox={`0 0 ${w} 100`}
      style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }}
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
  scale,
}: {
  text: string;
  accent: string;
  ink: string;
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
        color: primary ? "#141210" : "#FFFFFF",
        fontSize: Math.round(21 * scale),
        fontWeight: 850,
        letterSpacing: ".06em",
        padding: `${Math.round(7 * scale)}px ${Math.round(13 * scale)}px`,
        borderRadius: 4,
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
  slot,
  scale,
  muted,
  ink,
}: {
  slot: Slot;
  scale: number;
  muted: string;
  ink: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: Math.round(9 * scale) }}>
      <span
        style={{
          fontSize: Math.round(17 * scale),
          fontWeight: 700,
          letterSpacing: ".14em",
          color: muted,
        }}
      >
        STOK
      </span>
      <span
        style={{
          fontSize: Math.round(34 * scale),
          fontWeight: 850,
          lineHeight: 1,
          color: ink,
        }}
      >
        {slot.stock.trim() || "—"}
      </span>
      <span style={{ fontSize: Math.round(20 * scale), fontWeight: 700, color: muted }}>
        m²
      </span>
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

  const [state, setState] = useState<PageState>(() => ({
    version: 2,
    size: "60x120",
    count: 3,
    depot: DEPOTS[0],
    brandName: "GÜRAL SERAMİK",
    ground: "orta",
    accent: BRAND_BLUE,
    campaignOn: false,
    campaignText: "5 PALET ALANA 1 PALET 10×20 HEDİYE",
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
    fetch("/api/uploads", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.items)) setLibrary(d.items as LibraryItem[]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

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
    if (!q) return pool.slice(0, 200);
    return pool
      .filter(
        (p) =>
          p.name.toLocaleLowerCase("tr").includes(q) ||
          p.brand.toLocaleLowerCase("tr").includes(q),
      )
      .slice(0, 200);
  }, [products, query, state.size]);

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
      loadLibrary();
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
    const parts = [state.brandName, state.size, state.depot]
      .map((x) => (x || "").trim())
      .filter(Boolean)
      .join(" ");
    return (parts || "afis").replace(/[\\/:*?"<>|]/g, "-");
  }, [state.brandName, state.size, state.depot]);

  /** Kanvastaki tüm görseller yüklenene kadar bekler. Kuyruk dışa aktarımında
   *  sayfa değiştikten sonra ekran görüntüsü almadan önce şart. */
  async function waitForCanvas(expectedImages: number, timeout = 9000) {
    const start = Date.now();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (Date.now() - start < timeout) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>("#afis-kanvas img"),
      );
      const ready =
        imgs.length >= expectedImages &&
        imgs.every((i) => i.complete && i.naturalWidth > 0);
      if (ready) {
        await sleep(140);
        return;
      }
      await sleep(90);
    }
  }

  function expectedImageCount(st: PageState) {
    // slot görselleri + logo
    return st.slots.slice(0, st.count).filter((x) => x.imageUrl).length + 1;
  }

  async function renderJpeg(): Promise<string | null> {
    const node = canvasRef.current;
    if (!node) return null;
    // İki geçiş: ilk geçişte fontlar/görseller yerleşiyor.
    await toJpeg(node, { quality: 0.96, width: CANVAS_W, height: CANVAS_H });
    return toJpeg(node, {
      quality: 0.96,
      width: CANVAS_W,
      height: CANVAS_H,
      pixelRatio: 1,
      backgroundColor: ground.bg,
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
    const names = st.slots
      .slice(0, st.count)
      .map((sl) => {
        const p = sl.productId ? productsById.get(sl.productId) : undefined;
        return displayName(p, sl);
      })
      .filter(Boolean);
    return `${st.size} · ${names[0] ?? "boş"}${names.length > 1 ? ` +${names.length - 1}` : ""}`;
  }

  async function addToQueue() {
    try {
      setBusy("Sayfa kuyruğa ekleniyor…");
      await waitForCanvas(expectedImageCount(state));
      let thumb: string | null = null;
      try {
        const node = canvasRef.current;
        if (node) {
          thumb = await toJpeg(node, {
            quality: 0.6,
            width: CANVAS_W,
            height: CANVAS_H,
            canvasWidth: 216,
            canvasHeight: 384,
            backgroundColor: ground.bg,
          });
        }
      } catch {
        thumb = null;
      }
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

  function replaceInQueue(id: string) {
    setQueue((q) =>
      q.map((it) =>
        it.id === id
          ? {
              ...it,
              title: snapshotTitle(state),
              snapshot: JSON.parse(JSON.stringify(state)) as PageState,
            }
          : it,
      ),
    );
    setMsg("Kuyruktaki sayfa güncellendi ✓");
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
        await waitForCanvas(expectedImageCount(item.snapshot));
        const url = await renderJpeg();
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

  /* ---------------------------------- taslak ---------------------------------- */

  async function saveDraft() {
    try {
      setBusy("Taslak kaydediliyor…");
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `STUDIO2 · ${fileBase}`,
          catalog: { studio2: state, queue },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMsg("Taslak kaydedildi ✓");
    } catch {
      setMsg("Taslak kaydedilemedi");
    } finally {
      setBusy(null);
    }
  }

  /* ---------------------------------- satış ---------------------------------- */

  async function recordSales() {
    const items = state.slots
      .map((s) => {
        const p = s.productId ? productsById.get(s.productId) : undefined;
        const name = displayName(p, s);
        if (!name) return null;
        const qty = parseFloat(s.stock.replace(",", ".")) || 0;
        const unit = parseFloat(s.price.replace(/\./g, "").replace(",", ".")) || 0;
        if (!qty || !unit) return null;
        return {
          date: new Date().toISOString().slice(0, 10),
          productName: name,
          brand: p?.brand ?? state.brandName,
          size: s.sizeOverride || state.size,
          quantity: qty,
          unitPrice: unit,
          customer: "",
          note: state.depot,
          source: "banner" as const,
        };
      })
      .filter(Boolean);
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
  const cols = square && state.count > 1 ? 2 : 1;
  const cellScale = cols === 2 ? (state.count > 2 ? 0.8 : 0.9) : 1;
  const s = scale * cellScale;

  function SlotView({ index }: { index: number }) {
    const slot = state.slots[index];
    if (!slot) return null;
    const p = slot.productId ? productsById.get(slot.productId) : undefined;
    const size = slot.sizeOverride || state.size;
    const ratio = frameRatioForSize(size);
    const name = displayName(p, slot);
    const chip = gradeLabel(slot);

    const info =
      cols === 1 ? (
        <div
          style={{
            flexShrink: 0,
            height: Math.round(132 * s),
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: Math.round(26 * s),
            paddingBottom: Math.round(6 * s),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(15 * s), minWidth: 0 }}>
            <GradeChip text={chip} accent={state.accent} ink={ground.ink} scale={s} />
            <div>
              <div style={{ fontSize: Math.round(32 * s), fontWeight: 750, lineHeight: 1.05 }}>
                {name || "—"}
              </div>
              <div style={{ marginTop: Math.round(9 * s) }}>
                <StockLine slot={slot} scale={s} muted={muted} ink={ground.ink} />
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
            display: "flex",
            flexDirection: "column",
            gap: Math.round(10 * s),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: Math.round(10 * s), minWidth: 0 }}>
            <GradeChip text={chip} accent={state.accent} ink={ground.ink} scale={s} />
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
            <StockLine slot={slot} scale={s} muted={muted} ink={ground.ink} />
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <PriceBlock slot={slot} scale={s} muted={muted} />
            </div>
          </div>
        </div>
      );

    return (
      <div
        style={{
          flex: cols === 1 ? 1 : undefined,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: Math.round(14 * s),
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: cols === 1 ? "center" : "flex-end",
            justifyContent: "center",
          }}
        >
          {slot.imageUrl ? (
            <TileImage src={slot.imageUrl} alt={name} ratio={ratio} />
          ) : (
            <TilePlaceholder ratio={ratio} color={muted} />
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
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
            >
              Taslağı Kaydet
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
              <div className="flex gap-2">
                {GROUNDS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    title={g.label}
                    onClick={() => patch({ ground: g.id })}
                    className={[
                      "h-9 flex-1 rounded-lg border text-[11px] font-bold",
                      state.ground === g.id ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200",
                    ].join(" ")}
                    style={{ background: g.bg, color: g.ink }}
                  >
                    {g.label.replace("Nötr ", "")}
                  </button>
                ))}
              </div>
              <div className="pt-1 text-[11px] text-zinc-500">
                Nötr tonlar hem koyu hem açık karoyu zeminden ayırır.
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
                  value={String(state.fontScale)}
                  onChange={(e) =>
                    patch({ fontScale: Math.min(160, Math.max(60, Number(digits(e.target.value)) || 100)) })
                  }
                  inputMode="numeric"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4 ring-1 ring-zinc-200">
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
                sonra hepsini tek PDF olarak indir. Kuyruk taslakla birlikte
                kaydedilir.
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
                          onClick={() => replaceInQueue(it.id)}
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
          </section>

          <section className="space-y-3">
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
                      <div className="text-xs font-semibold text-zinc-600">Kalite</div>
                      <select
                        value={slot.grade}
                        onChange={(e) => patchSlot(i, { grade: e.target.value as Slot["grade"] })}
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm"
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
                      <div className="text-xs font-semibold text-zinc-600">Stok (m²)</div>
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
                        {slot.dualPrice ? `${slot.priceLabel} fiyatı` : "Fiyat"}
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
                      checked={slot.dualPrice}
                      onChange={(e) => patchSlot(i, { dualPrice: e.target.checked })}
                      className="h-4 w-4 accent-zinc-900"
                    />
                    <span className="font-semibold">Çift fiyat (Vadeli + Kart)</span>
                  </label>

                  {slot.dualPrice ? (
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
              <span>Karo kırpılmaz, oranı korunur</span>
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
                              ? "/images/logos/kulalilar-light.png"
                              : "/images/logos/kulalilar-dark.png"
                          }
                          alt="KULALILAR"
                          crossOrigin="anonymous"
                          style={{ height: 96, width: "auto", display: "block" }}
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
                            borderRadius: 4,
                          }}
                        >
                          {state.depot}
                        </span>
                        <div style={{ fontSize: 34, fontWeight: 800, marginTop: 11 }}>
                          {state.brandName}
                        </div>
                      </div>
                    </div>
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
                          borderRadius: 3,
                        }}
                      >
                        {state.size.replace("x", " × ")}
                      </span>
                    </div>
                  </div>

                  {/* ürünler */}
                  {cols === 1 ? (
                    <div
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
                      style={{
                        flex: 1,
                        minHeight: 0,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gridTemplateRows:
                          state.count > 2 ? "1fr 1fr" : "1fr",
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
                  {state.campaignOn && state.campaignText.trim() ? (
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
                onClick={() => setPickerTab("katalog")}
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
                  loadLibrary();
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
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ara…"
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
            <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-4">
              {pickerTab === "katalog"
                ? filtered.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => pickProduct(pickerFor, p)}
                      className="overflow-hidden rounded-xl border border-zinc-200 text-left hover:border-zinc-400"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.image} alt={p.name} className="aspect-[3/2] w-full object-cover" />
                      <div className="p-2">
                        <div className="truncate text-[11px] font-semibold">{p.name}</div>
                        <div className="truncate text-[10px] text-zinc-500">
                          {p.brand} · {p.size}
                        </div>
                      </div>
                    </button>
                  ))
                : library.map((it) => (
                    <button
                      key={it.publicId}
                      type="button"
                      onClick={() => pickLibrary(pickerFor, it)}
                      className="overflow-hidden rounded-xl border border-zinc-200 text-left hover:border-zinc-400"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.url} alt="" className="aspect-[3/2] w-full object-cover" />
                      <div className="truncate p-2 text-[11px] font-semibold">
                        {it.displayName || it.publicId.split("/").pop()}
                      </div>
                    </button>
                  ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
