"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toJpeg } from "html-to-image";
import Link from "next/link";
import { jsPDF } from "jspdf";
import {
  ChevronDown,
  ChevronUp,
  Images,
  RotateCcw,
  Search,
  Upload,
} from "lucide-react";

type TemplateCount = 1 | 2 | 3 | 4 | 5 | 6 | 8;
type ProductImageAspect =
  | "square"
  | "threeTwo"
  | "video"
  | "parquet"
  | "oneThree"
  | "oneFour";

type DraftSummary = {
  id: string;
  title: string;
  savedAt: string;
  size: string;
  manufacturer: string;
  pageCount: number;
  productNames: string[];
};

type CatalogV1 = {
  version: 1;
  queue: PdfQueueItemV1[];
  current: DraftV1;
};

type SellRow = {
  rowKey: string;
  slotIndex: number;
  /** Çift stoklu slotlarda hangi stoktan düşüleceğini belirler. */
  part: "primary" | "end";
  selected: boolean;
  productName: string;
  brand: string;
  size: string;
  quantity: string;
  unitPrice: string;
  note: string;
};

type Product = {
  id: string;
  name: string;
  size: string;
  brand: string;
  image: string;
};

type UploadLibraryItem = {
  publicId: string;
  url: string;
  originalFilename: string;
  /** Okunabilir etiket (dosya adı veya public_id son segmenti) */
  displayName?: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

function cloudItemLabel(item: UploadLibraryItem): string {
  const d = (item.displayName ?? "").trim();
  if (d) return d;
  const o = (item.originalFilename ?? "").trim();
  if (o) return o;
  const seg = item.publicId.split("/").pop() || item.publicId;
  return seg;
}

type SlotState = {
  productId: string | null;
  stock: string;
  price: string;
  dualStock: boolean;
  primaryStockLabel: string;
  endStockLabel: string;
  endStock: string;
  endStockPrice: string;
  dualPrice: boolean;
  priceLabel: string;
  secondPriceLabel: string;
  secondPrice: string;
  /** Görselin çerçeve içindeki genişliği (%). Boş = ebattan otomatik. */
  imageScale: string;
  /** Slot bazında görsel oranı. "" = sayfanın oranını kullan. */
  imageAspect: "" | ProductImageAspect;
  /** Stok/fiyat satırlarını gizleyip yerine serbest yazı gösterir. */
  hideStockPrice: boolean;
  noteText: string;
  /** Boş = afişin yazı rengini kullan. */
  noteColor: string;
  /** Yazı boyutu yüzdesi. Boş = %120. */
  noteScale: string;
  /** Kutunun solundaki dikkat çekici simge. "" = simge yok. */
  noteIcon: "" | "gift" | "star" | "percent" | "tag";
  darkText: boolean;
  customName: string;
  imageUrlOverride: string | null;
  imagePublicId: string | null;
  surface: "" | "FLP" | "SEMİ LAPP." | "MAT";
  grade: "" | "1." | "END.";
  isRec: boolean;
};

type DraftV1 = {
  version: 1;
  savedAt: string;
  selectedTemplate: TemplateCount;
  productImageAspect: ProductImageAspect;
  globalFontSize: number;
  canvasBgColor: string;
  isDarkBg: boolean;
  selectedTemplateSize: string;
  selectedManufacturer: string;
  headerRightText: string;
  unitName: string;
  fileName: string;
  slots: SlotState[];
};

type PdfQueueItemV1 = {
  id: string;
  title: string;
  thumbnailDataUrl: string | null;
  snapshot: DraftV1;
};

type PdfQueueExportV1 = {
  version: 1;
  savedAt: string;
  items: PdfQueueItemV1[];
};

const TEMPLATES_DEFAULT: TemplateCount[] = [1, 2, 3, 4, 5, 6, 8];
const TEMPLATES_PARQUET: TemplateCount[] = [1, 2, 3, 4, 5];

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const DEFAULT_CANVAS_BG = "#F5F5F5";
const DEFAULT_UNIT_NAME = "m²";
const DEFAULT_GLOBAL_FONT_SIZE = 24;
const PARQUET_DEFAULT_FONT_SIZE = 38;
const SIZE_OPTIONS = [
  "5x30",
  "7.5x15",
  "7.5x30",
  "10x20",
  "10x30",
  "15x15",
  "15x60",
  "20x120",
  "30x60",
  "30x90",
  "40x80",
  "40x120",
  "45x45",
  "50x50",
  "60x60",
  "61x61",
  "60x120",
  "80x80",
  "80x320",
  "100x100",
  "120x120",
  "120x180",
  "120x280",
  "160x320",
] as const;

type SizeOption = (typeof SIZE_OPTIONS)[number];
const BASE_LOGO_HEIGHT_PX = 128;
const FIXED_LOGO_SCALE = 3.85;
const FIXED_HEADER_FONT_SIZE = 38;
const FIXED_HEADER_BORDER_WIDTH = 7;

function emptySlot(): SlotState {
  return {
    productId: null,
    stock: "",
    price: "",
    dualStock: false,
    primaryStockLabel: "1.Stok",
    endStockLabel: "END.Stok",
    endStock: "",
    endStockPrice: "",
    dualPrice: false,
    priceLabel: "Vadeli",
    secondPriceLabel: "Kart",
    secondPrice: "",
    imageScale: "",
    imageAspect: "",
    hideStockPrice: false,
    noteText: "",
    noteColor: "",
    noteScale: "",
    noteIcon: "gift",
    darkText: false,
    customName: "",
    imageUrlOverride: null,
    imagePublicId: null,
    surface: "",
    grade: "",
    isRec: false,
  };
}

function normalizeSlotFromPartial(s: Partial<SlotState> | undefined): SlotState {
  if (!s || typeof s !== "object") return emptySlot();
  return {
    productId: typeof s.productId === "string" ? s.productId : null,
    stock: typeof s.stock === "string" ? s.stock : "",
    price: typeof s.price === "string" ? s.price : "",
    dualStock: typeof s.dualStock === "boolean" ? s.dualStock : false,
    primaryStockLabel:
      typeof s.primaryStockLabel === "string" && s.primaryStockLabel.trim()
        ? s.primaryStockLabel
        : "1.Stok",
    endStockLabel:
      typeof s.endStockLabel === "string" && s.endStockLabel.trim()
        ? s.endStockLabel
        : "END.Stok",
    endStock: typeof s.endStock === "string" ? s.endStock : "",
    endStockPrice: typeof s.endStockPrice === "string" ? s.endStockPrice : "",
    dualPrice: typeof s.dualPrice === "boolean" ? s.dualPrice : false,
    priceLabel:
      typeof s.priceLabel === "string" && s.priceLabel.trim()
        ? s.priceLabel
        : "Vadeli",
    secondPriceLabel:
      typeof s.secondPriceLabel === "string" && s.secondPriceLabel.trim()
        ? s.secondPriceLabel
        : "Kart",
    secondPrice: typeof s.secondPrice === "string" ? s.secondPrice : "",
    imageScale: typeof s.imageScale === "string" ? s.imageScale : "",
    imageAspect:
      s.imageAspect === "square" ||
      s.imageAspect === "threeTwo" ||
      s.imageAspect === "video" ||
      s.imageAspect === "parquet" ||
      s.imageAspect === "oneThree" ||
      s.imageAspect === "oneFour"
        ? s.imageAspect
        : "",
    hideStockPrice:
      typeof s.hideStockPrice === "boolean" ? s.hideStockPrice : false,
    noteText: typeof s.noteText === "string" ? s.noteText : "",
    noteColor: typeof s.noteColor === "string" ? s.noteColor : "",
    noteScale: typeof s.noteScale === "string" ? s.noteScale : "",
    noteIcon:
      s.noteIcon === "gift" ||
      s.noteIcon === "star" ||
      s.noteIcon === "percent" ||
      s.noteIcon === "tag"
        ? s.noteIcon
        : "",
    darkText: typeof s.darkText === "boolean" ? s.darkText : false,
    customName: typeof s.customName === "string" ? s.customName : "",
    imageUrlOverride:
      typeof s.imageUrlOverride === "string" || s.imageUrlOverride === null
        ? s.imageUrlOverride
        : null,
    imagePublicId:
      typeof s.imagePublicId === "string" || s.imagePublicId === null
        ? s.imagePublicId
        : null,
    surface:
      s.surface === "" ||
      s.surface === "FLP" ||
      s.surface === "SEMİ LAPP." ||
      s.surface === "MAT"
        ? s.surface
        : "",
    grade: s.grade === "" || s.grade === "1." || s.grade === "END." ? s.grade : "",
    isRec: typeof s.isRec === "boolean" ? s.isRec : false,
  };
}

function buildSlots(count: TemplateCount, prev?: SlotState[]): SlotState[] {
  const base: SlotState[] = Array.from({ length: count }, (_, idx) => {
    const existing = prev?.[idx];
    if (!existing) return emptySlot();
    return {
      ...existing,
      dualStock: typeof existing.dualStock === "boolean" ? existing.dualStock : false,
      primaryStockLabel:
        typeof existing.primaryStockLabel === "string" && existing.primaryStockLabel.trim()
          ? existing.primaryStockLabel
          : "1.Stok",
      endStockLabel:
        typeof existing.endStockLabel === "string" && existing.endStockLabel.trim()
          ? existing.endStockLabel
          : "END.Stok",
      endStock: typeof existing.endStock === "string" ? existing.endStock : "",
      endStockPrice:
        typeof existing.endStockPrice === "string" ? existing.endStockPrice : "",
      dualPrice: typeof existing.dualPrice === "boolean" ? existing.dualPrice : false,
      priceLabel:
        typeof existing.priceLabel === "string" && existing.priceLabel.trim()
          ? existing.priceLabel
          : "Vadeli",
      secondPriceLabel:
        typeof existing.secondPriceLabel === "string" && existing.secondPriceLabel.trim()
          ? existing.secondPriceLabel
          : "Kart",
      secondPrice:
        typeof existing.secondPrice === "string" ? existing.secondPrice : "",
      imageScale:
        typeof existing.imageScale === "string" ? existing.imageScale : "",
      imageAspect: existing.imageAspect ?? "",
      hideStockPrice:
        typeof existing.hideStockPrice === "boolean"
          ? existing.hideStockPrice
          : false,
      noteText: typeof existing.noteText === "string" ? existing.noteText : "",
      noteColor: typeof existing.noteColor === "string" ? existing.noteColor : "",
      noteScale: typeof existing.noteScale === "string" ? existing.noteScale : "",
      noteIcon: existing.noteIcon ?? "",
      customName: typeof existing.customName === "string" ? existing.customName : "",
      imageUrlOverride:
        typeof existing.imageUrlOverride === "string" || existing.imageUrlOverride === null
          ? existing.imageUrlOverride
          : null,
      imagePublicId:
        typeof existing.imagePublicId === "string" || existing.imagePublicId === null
          ? existing.imagePublicId
          : null,
      surface: existing.surface ?? "",
      grade: existing.grade ?? "",
      isRec: typeof existing.isRec === "boolean" ? existing.isRec : false,
    };
  });
  return base;
}

function formatSlotGrade(slot?: SlotState | null) {
  const grade = slot?.grade ?? "";
  if (!grade) return "";
  return slot?.isRec ? `REC ${grade}` : grade;
}

function displayNameForSlot(p: Product | undefined, slot?: SlotState | null) {
  const manual = (slot?.customName ?? "").trim();
  if (manual) return manual;
  if (!p) return "—";
  return `${p.name} ${slot?.surface ?? ""} ${formatSlotGrade(slot)}`
    .trim()
    .toUpperCase();
}

function imageSrcForSlot(p: Product | undefined, slot?: SlotState | null) {
  const override = slot?.imageUrlOverride;
  if (typeof override === "string" && override.trim()) return override;
  return p?.image ?? "";
}

function slotHasAssignableMedia(s: SlotState | undefined) {
  return Boolean(
    s?.productId || (s?.imageUrlOverride && s.imageUrlOverride.trim()),
  );
}

function SlotStockPriceDisplay({
  slot,
  unitName,
  fontSize,
  stockLineClassName = "font-bold leading-snug text-center",
  priceLineClassName,
}: {
  slot?: SlotState | null;
  unitName: string;
  fontSize: number;
  stockLineClassName?: string;
  priceLineClassName?: string;
}) {
  const unit = unitName?.trim() || "m²";
  const priceClass = priceLineClassName ?? stockLineClassName;

  // Kampanya notu: stok/fiyat yerine, çerçeveli ve vurgulu serbest yazı.
  if (slot?.hideStockPrice) {
    const note = (slot.noteText ?? "").trim();
    if (!note) return null;
    const fill = (slot.noteColor ?? "").trim() || NOTE_DEFAULT_FILL;
    const textColor = readableTextOn(fill);
    const pct = parseInt((slot.noteScale ?? "").trim(), 10);
    const noteScale =
      Number.isFinite(pct) && pct > 0 ? Math.min(300, Math.max(50, pct)) : 120;
    const noteFontSize = Math.round(fontSize * (noteScale / 100));
    return (
      <div
        className="flex w-full justify-center"
        style={{ marginTop: Math.round(noteFontSize * 0.55) }}
      >
        <div
          className="flex items-center justify-center gap-3 whitespace-pre-line text-center font-extrabold leading-tight"
          style={{
            fontSize: noteFontSize,
            background: fill,
            color: textColor,
            borderRadius: 9999,
            letterSpacing: "-0.01em",
            paddingLeft: Math.round(noteFontSize * 0.95),
            paddingRight: Math.round(noteFontSize * 0.95),
            paddingTop: Math.round(noteFontSize * 0.42),
            paddingBottom: Math.round(noteFontSize * 0.42),
          }}
        >
          {slot.noteIcon ? (
            <NoteIcon
              name={slot.noteIcon}
              size={Math.round(noteFontSize * 1.35)}
            />
          ) : null}
          <span>{note}</span>
        </div>
      </div>
    );
  }
  const priceValue = (value?: string) =>
    value?.trim() ? value.trim() : "—";

  if (slot?.dualStock) {
    const primaryLabel = slot.primaryStockLabel?.trim() || "1.Stok";
    const endLabel = slot.endStockLabel?.trim() || "END.Stok";
    return (
      <div className="w-full">
        <div className="grid grid-cols-2 gap-x-2">
          <div className={stockLineClassName} style={{ fontSize }}>
            {primaryLabel}:{" "}
            <span className="tabular-nums font-extrabold">
              {priceValue(slot.stock)}
            </span>{" "}
            <span className="font-extrabold">{unit}</span>
          </div>
          <div className={stockLineClassName} style={{ fontSize }}>
            {endLabel}:{" "}
            <span className="tabular-nums font-extrabold">
              {priceValue(slot.endStock)}
            </span>{" "}
            <span className="font-extrabold">{unit}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-2">
          <div className={priceClass} style={{ fontSize }}>
            <span className="tabular-nums font-extrabold">
              {priceValue(slot.price)}
            </span>{" "}
            <span className="font-extrabold">+ KDV</span>
          </div>
          <div className={priceClass} style={{ fontSize }}>
            <span className="tabular-nums font-extrabold">
              {priceValue(slot.endStockPrice)}
            </span>{" "}
            <span className="font-extrabold">+ KDV</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={stockLineClassName} style={{ fontSize }}>
        Stok{" "}
        <span className="tabular-nums font-extrabold">
          {priceValue(slot?.stock)}
        </span>{" "}
        <span className="font-extrabold">{unit}</span>
      </div>
      {slot?.dualPrice ? (
        <div className="grid w-full grid-cols-2 gap-x-2">
          <div className={priceClass} style={{ fontSize }}>
            {(slot.priceLabel?.trim() || "Vadeli")}:{" "}
            <span className="tabular-nums font-extrabold">
              {priceValue(slot.price)}
            </span>{" "}
            <span className="font-extrabold">+ KDV</span>
          </div>
          <div className={priceClass} style={{ fontSize }}>
            {(slot.secondPriceLabel?.trim() || "Kart")}:{" "}
            <span className="tabular-nums font-extrabold">
              {priceValue(slot.secondPrice)}
            </span>{" "}
            <span className="font-extrabold">+ KDV</span>
          </div>
        </div>
      ) : (
        <div className={priceClass} style={{ fontSize }}>
          <span className="tabular-nums font-extrabold">
            {priceValue(slot?.price)}
          </span>{" "}
          <span className="font-extrabold">+ KDV</span>
        </div>
      )}
    </>
  );
}

/**
 * Slot görseli.
 *
 * `imageScale` ile karo, çerçevenin içinde gerçek ölçüsüne göre küçültülüp
 * ortalanır; böylece 7,5x30 gibi küçük ebatlar 60x120 gibi büyük formatların
 * yanında gözle görülür şekilde küçük durur.
 */
/** Kampanya kutusundaki simge. Emoji yerine inline SVG: dışa aktarımda
 *  (html-to-image) her ortamda aynı çiziliyor. */
const NOTE_DEFAULT_FILL = "#F5D64E";

/** Zemin rengine göre okunur yazı rengi seçer (koyu zemin -> beyaz). */
function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "#151312";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // ITU-R BT.601 parlaklık
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#151312" : "#FFFFFF";
}

function NoteIcon({
  name,
  size,
}: {
  name: Exclude<SlotState["noteIcon"], "">;
  size: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    style: { flexShrink: 0 },
  };
  if (name === "gift") {
    return (
      <svg {...common}>
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
        <path d="M12 8v13" />
        <path d="M12 8S10 2.8 7.4 4.4C5.4 5.6 7 8 12 8z" />
        <path d="M12 8s2-5.2 4.6-3.6C18.6 5.6 17 8 12 8z" />
      </svg>
    );
  }
  if (name === "star") {
    return (
      <svg {...common}>
        <path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z" />
      </svg>
    );
  }
  if (name === "percent") {
    return (
      <svg {...common}>
        <path d="M19 5L5 19" />
        <circle cx="7.5" cy="7.5" r="2.5" />
        <circle cx="16.5" cy="16.5" r="2.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}

function SlotImage({
  src,
  alt,
  slot,
  sizeText,
  frameRatio = 2,
  hasError,
  onError,
  onLoad,
}: {
  src: string;
  alt: string;
  slot?: SlotState | null;
  sizeText: string;
  /** Çerçevenin genişlik/yükseklik oranı (1:4 -> 4). */
  frameRatio?: number;
  hasError: boolean;
  onError: () => void;
  onLoad: () => void;
}) {
  if (!src || hasError) return <div className="h-full w-full" />;

  const scale = resolveImageScale(sizeText, slot?.imageScale);

  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      crossOrigin="anonymous"
      className="h-full w-full object-cover object-center"
      onError={onError}
      onLoad={onLoad}
    />
  );

  if (scale >= 100) return image;

  // Küçültmede çerçeve aspect sınıfı kaldırıldığı için yüksekliği burada
  // belirliyoruz: genişlik %scale, oran çerçevenin oranı. Böylece görselin
  // altında boş bant kalmıyor.
  return (
    <div className="flex w-full justify-center">
      <div
        style={{
          width: `${scale}%`,
          aspectRatio: `${frameRatio > 0 ? frameRatio : 2}`,
        }}
      >
        {image}
      </div>
    </div>
  );
}

function digitsOnly(input: string) {
  return input.replace(/[^\d]/g, "");
}

function formatThousandsWithDot(digits: string) {
  if (!digits) return "";
  const trimmed = digits.replace(/^0+/, "") || "0";
  return trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function sanitizeFileComponent(input: string) {
  return input.trim().replace(/[\\/:*?"<>|]/g, "-");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function gridForTemplate(template: TemplateCount) {
  switch (template) {
    case 1:
      return { cols: 1, rows: 1 };
    case 2:
      return { cols: 2, rows: 1 };
    case 3:
      return { cols: 1, rows: 3 };
    case 4:
      return { cols: 2, rows: 2 };
    case 5:
      return { cols: 1, rows: 5 };
    case 6:
      return { cols: 2, rows: 3 };
    case 8:
      return { cols: 2, rows: 4 };
  }
}

function normalizeSizeText(input: string): SizeOption {
  // "7,5X15" / "7,5×15" gibi girdileri "7.5x15" biçimine indirger.
  const s = input
    .trim()
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/,/g, ".")
    .replace(/\s+/g, "");
  if ((SIZE_OPTIONS as readonly string[]).includes(s)) return s as SizeOption;
  return "60x60";
}

/** "7.5x15" -> { short: 7.5, long: 15 }. Çözülemezse null. */
function parseSizeCm(sizeText: string): { short: number; long: number } | null {
  const m = String(sizeText ?? "")
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

/**
 * Küçük ebatların çerçeve içinde ne kadar yer kaplayacağını belirler.
 *
 * Referans 60 cm = %100. Yalnızca uzun kenarı SMALL_FORMAT_MAX_CM ve altındaki
 * ebatlar küçültülür; 60x60, 60x120 gibi mevcut ebatlar %100 kalır, yani
 * eski afişlerin çıktısı değişmez.
 */
const IMAGE_SCALE_REFERENCE_CM = 60;
const SMALL_FORMAT_MAX_CM = 30;
const IMAGE_SCALE_MIN_PCT = 30;

function autoImageScale(sizeText: string): number {
  const dims = parseSizeCm(sizeText);
  if (!dims || dims.long > SMALL_FORMAT_MAX_CM) return 100;
  const pct = Math.round((dims.long / IMAGE_SCALE_REFERENCE_CM) * 100);
  return Math.min(100, Math.max(IMAGE_SCALE_MIN_PCT, pct));
}

/** Elle girilen değer varsa onu, yoksa ebattan hesaplananı döndürür. */
function resolveImageScale(sizeText: string, manual?: string): number {
  const n = parseInt((manual ?? "").trim(), 10);
  if (Number.isFinite(n) && n > 0) return Math.min(100, Math.max(5, n));
  return autoImageScale(sizeText);
}


function aspectClassForSize(sizeText: string) {
  // Portrait canvas içinde bile tüm ürün görselleri yatay kalmalı.
  // Boyuta göre değişmez: 60x120 (1:2) yatay oranı.
  void sizeText;
  return "aspect-[2/1]";
}

/** Türkçe biçimli sayıyı çözer: "1.250" -> 1250, "51,2" -> 51.2, "1.250,50" -> 1250.5 */
function parseTrNumber(v: string): number {
  let x = String(v ?? "").trim();
  if (!x) return 0;
  if (x.includes(",")) {
    x = x.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = x.split(".");
    if (parts.length > 2) x = parts.join("");
    else if (parts.length === 2 && parts[1].length === 3) x = parts.join("");
  }
  const n = parseFloat(x.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function aspectClassForProductImage(aspect: ProductImageAspect) {
  if (aspect === "square") return "aspect-square";
  if (aspect === "threeTwo") return "aspect-[3/2]";
  if (aspect === "parquet") return "aspect-[6/1]";
  if (aspect === "oneThree") return "aspect-[3/1]";
  if (aspect === "oneFour") return "aspect-[4/1]";
  // "video" seçeneği: 60x120 (1:2) yatay görsel oranı
  return "aspect-[2/1]";
}

function aspectRatioForProductImage(aspect: ProductImageAspect): number {
  if (aspect === "square") return 1;
  if (aspect === "threeTwo") return 1.5;
  if (aspect === "parquet") return 6;
  if (aspect === "oneThree") return 3;
  if (aspect === "oneFour") return 4;
  return 2;
}

/**
 * Görsel küçültüldüğünde çerçeve de küçülmeli. Aksi hâlde çerçeve tam
 * yükseklikte kalıp altında boş bant bırakıyor ve bu, yazıyla görsel arasında
 * fazladan boşluk gibi görünüyor. Küçültme varsa aspect sınıfı kaldırılır;
 * yüksekliği SlotImage kendi iç oranıyla belirler.
 */
/** Slot kendi oranını seçtiyse onu, seçmediyse sayfanın oranını kullanır. */
function aspectForSlot(
  pageAspect: ProductImageAspect,
  slot?: SlotState | null,
): ProductImageAspect {
  return slot?.imageAspect ? slot.imageAspect : pageAspect;
}

function frameAspectClass(
  aspect: ProductImageAspect,
  slot: SlotState | null | undefined,
  sizeText: string,
): string {
  if (resolveImageScale(sizeText, slot?.imageScale) < 100) return "";
  return aspectClassForProductImage(aspect);
}

function normalizeHexColor(input: string) {
  const s = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]!;
    const g = s[2]!;
    const b = s[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return DEFAULT_CANVAS_BG;
}

function Icon({
  name,
  className,
}: {
  name: "trash" | "copy" | "invert" | "download";
  className?: string;
}) {
  const common = {
    className: className ?? "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M6 6l1 16h10l1-16" />
        <path d="M10 11v7" />
        <path d="M14 11v7" />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M9 9h10v10H9z" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }

  if (name === "invert") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M12 2a9 9 0 1 0 0 18V2z" />
        <path d="M12 2a9 9 0 0 1 0 18" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M5 21h14" />
    </svg>
  );
}

function PdfQueueRow({
  item,
  idx,
  pdfQueue,
  expanded,
  isBuildingPdf,
  productsById,
  onMoveUp,
  onMoveDown,
  onToggleExpand,
  onEdit,
  onDelete,
  onMoveSlot,
}: {
  item: PdfQueueItemV1;
  idx: number;
  pdfQueue: PdfQueueItemV1[];
  expanded: boolean;
  isBuildingPdf: boolean;
  productsById: Map<string, Product>;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveSlot: (slotIdx: number, targetIdx: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex shrink-0 flex-col gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={idx === 0 || isBuildingPdf}
            className="flex h-4 w-5 items-center justify-center rounded border border-zinc-200 bg-white text-[10px] leading-none text-zinc-600 hover:bg-zinc-50 disabled:opacity-30"
            title="Yukarı taşı"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={idx === pdfQueue.length - 1 || isBuildingPdf}
            className="flex h-4 w-5 items-center justify-center rounded border border-zinc-200 bg-white text-[10px] leading-none text-zinc-600 hover:bg-zinc-50 disabled:opacity-30"
            title="Aşağı taşı"
          >
            ▼
          </button>
        </div>
        <div className="h-10 w-10 shrink-0 rounded border border-zinc-200 bg-zinc-50 overflow-hidden">
          {item.thumbnailDataUrl ? (
            <img
              src={item.thumbnailDataUrl}
              alt={item.title}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-zinc-900">
            {idx + 1}. {item.title}
          </div>
          <div className="text-[11px] text-zinc-500">
            Şablon {item.snapshot.selectedTemplate} •{" "}
            {item.snapshot.isDarkBg ? "Koyu" : "Açık"}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          disabled={isBuildingPdf}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
          title="Ürünleri göster / ürün taşı"
        >
          {expanded ? "Ürünler ▲" : "Ürünler ▾"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={isBuildingPdf}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
          title="Düzenle"
        >
          Düzenle
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isBuildingPdf}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
          title="Sil"
        >
          Sil
        </button>
      </div>

      {expanded ? (
        <div className="space-y-1.5 px-3 pb-3 pl-[76px]">
          {item.snapshot.slots.map((slot, slotIdx) => {
            const filled = slotHasAssignableMedia(slot);
            const p =
              slot.productId != null ? productsById.get(slot.productId) : undefined;
            const eligibleTargets = pdfQueue
              .map((it, tIdx) => ({ it, tIdx }))
              .filter(
                ({ it, tIdx }) =>
                  tIdx !== idx &&
                  it.snapshot.slots.some((s) => !slotHasAssignableMedia(s)),
              );

            return (
              <div key={slotIdx} className="flex items-center gap-2 text-[11px]">
                <span
                  className={[
                    "min-w-0 flex-1 truncate",
                    filled ? "text-zinc-700" : "text-zinc-400 italic",
                  ].join(" ")}
                >
                  {filled ? displayNameForSlot(p, slot) : "Boş slot"}
                </span>
                {filled && eligibleTargets.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <span className="text-zinc-400">Taşı:</span>
                    {eligibleTargets.map(({ it, tIdx }) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => onMoveSlot(slotIdx, tIdx)}
                        disabled={isBuildingPdf}
                        className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                        title={`${tIdx + 1}. sayfaya taşı`}
                      >
                        {tIdx + 1}
                      </button>
                    ))}
                  </div>
                ) : filled ? (
                  <span className="shrink-0 text-[10px] text-zinc-400">
                    Boş slotlu sayfa yok
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateCount>(4);
  const [slots, setSlots] = useState<SlotState[]>(() => buildSlots(4));
  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [headerRightText, setHeaderRightText] = useState("SÖKE FABRİKA SEVK");
  const [selectedTemplateSize, setSelectedTemplateSize] = useState("30x60");
  const [selectedManufacturer, setSelectedManufacturer] =
    useState("QUA SERAMİK");
  const [unitName, setUnitName] = useState(DEFAULT_UNIT_NAME);
  const [fileName, setFileName] = useState("");
  const [canvasBgColor, setCanvasBgColor] = useState(DEFAULT_CANVAS_BG);
  const [globalFontSize, setGlobalFontSize] = useState(DEFAULT_GLOBAL_FONT_SIZE);
  const [lastNonParquetFontSize, setLastNonParquetFontSize] = useState(
    DEFAULT_GLOBAL_FONT_SIZE,
  );
  const [parquetSliderTouched, setParquetSliderTouched] = useState(false);
  const [isDarkBg, setIsDarkBg] = useState(false);
  const [productImageAspect, setProductImageAspect] =
    useState<ProductImageAspect>("square");
  const [imageErrorBySlot, setImageErrorBySlot] = useState<
    Record<number, boolean>
  >({});
  const [pdfQueue, setPdfQueue] = useState<PdfQueueItemV1[]>([]);
  const [pdfEditingIndex, setPdfEditingIndex] = useState<number | null>(null);
  const [expandedQueueIds, setExpandedQueueIds] = useState<Set<string>>(
    new Set(),
  );
  const [isBuildingPdf, setIsBuildingPdf] = useState(false);
  const [isUploadLibraryOpen, setIsUploadLibraryOpen] = useState(false);
  const [uploadLibraryItems, setUploadLibraryItems] = useState<UploadLibraryItem[]>([]);
  const [isLoadingUploadLibrary, setIsLoadingUploadLibrary] = useState(false);
  const [uploadLibraryError, setUploadLibraryError] = useState<string | null>(null);
  const [libraryPickerSlotIndex, setLibraryPickerSlotIndex] = useState<
    number | null
  >(null);
  const [libraryFolders, setLibraryFolders] = useState<
    { name: string; path: string }[]
  >([]);
  const [librarySelectedFolder, setLibrarySelectedFolder] = useState<string>(
    "banner-studio/uploads",
  );
  const [librarySearch, setLibrarySearch] = useState("");
  const [uploadingSlotIndex, setUploadingSlotIndex] = useState<number | null>(
    null,
  );
  const [cloudinaryUiError, setCloudinaryUiError] = useState<string | null>(
    null,
  );
  const [isRecordingSale, setIsRecordingSale] = useState(false);
  const [saleRecordMsg, setSaleRecordMsg] = useState<string | null>(null);
  const [isSellModalOpen, setIsSellModalOpen] = useState(false);
  const [sellCustomer, setSellCustomer] = useState("");
  const [sellDate, setSellDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [sellRows, setSellRows] = useState<SellRow[]>([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isSavedOpen, setIsSavedOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<DraftSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedSearch, setSavedSearch] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaveMsg, setDraftSaveMsg] = useState<string | null>(null);
  const slotFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadSlotIndex, setPendingUploadSlotIndex] = useState<
    number | null
  >(null);
  const [productPickerTab, setProductPickerTab] = useState<
    "catalog" | "cloudinary"
  >("catalog");

  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const exportCanvasRef = useRef<HTMLDivElement | null>(null);
  const [studioScale, setStudioScale] = useState(1);

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      return (
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.size.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [products, searchTerm]);

  const filteredUploadLibraryItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return uploadLibraryItems;
    return uploadLibraryItems.filter((item) => {
      const label = cloudItemLabel(item).toLowerCase();
      const pid = (item.publicId || "").toLowerCase();
      return label.includes(q) || pid.includes(q);
    });
  }, [uploadLibraryItems, searchTerm]);

  const libraryModalItems = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return uploadLibraryItems;
    return uploadLibraryItems.filter((item) => {
      const label = cloudItemLabel(item).toLowerCase();
      const pid = (item.publicId || "").toLowerCase();
      return label.includes(q) || pid.includes(q);
    });
  }, [uploadLibraryItems, librarySearch]);

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const grid = gridForTemplate(selectedTemplate);
  const canvasBg = normalizeHexColor(canvasBgColor);
  const canvasTextColor = isDarkBg ? "#FFFFFF" : "#000000";
  const canvasTextColorClass = isDarkBg ? "text-white" : "text-black";
  const productBgColor = isDarkBg ? "#1D1616" : "#F5F5F5";
  const productDetailsTextColorClass = canvasTextColorClass;
  const headerBoxPx = Math.max(10, Math.round(FIXED_HEADER_FONT_SIZE * 0.6));
  const headerBoxPy = Math.max(8, Math.round(FIXED_HEADER_FONT_SIZE * 0.35));
  const selectedLogoSrc = "/images/logos/kulalilar-light.png";
  const logoFilter = isDarkBg ? "invert(1)" : "none";
  const isSixOrEightSquare =
    productImageAspect === "square" &&
    (selectedTemplate === 6 || selectedTemplate === 8);
  const isEightSquare = selectedTemplate === 8 && productImageAspect === "square";

  const eightSquareImageScale = useMemo(() => {
    // Only for (8'li + Kare): keep bottom row within safe area as text grows.
    const delta = Math.max(0, globalFontSize - DEFAULT_GLOBAL_FONT_SIZE);
    const scaled = 0.86 - delta * 0.004; // tiny shrink as text grows
    return Math.max(0.78, Math.min(0.88, scaled));
  }, [globalFontSize]);

  const isParquetMode = productImageAspect === "parquet";
  const isThreeVertical =
    !isParquetMode && selectedTemplate === 3 && productImageAspect === "square";
  const isParquetFour = isParquetMode && selectedTemplate === 4;
  const isParquetSix = isParquetMode && selectedTemplate === 6;
  const isParquetThree = isParquetMode && selectedTemplate === 3;
  const isParquetFive = isParquetMode && selectedTemplate === 5;
  const parquetStackScale = useMemo(() => {
    // Only for (Parke 1:6): keep many items on-page by shrinking whole stack.
    // 1 -> 1.00, 2 -> 0.92, 4 -> 0.78, 6 -> 0.68, 8 -> 0.60
    const base = 1 - (selectedTemplate - 1) * 0.06;
    const fontPenalty = Math.max(0, globalFontSize - DEFAULT_GLOBAL_FONT_SIZE) * 0.003;
    const raw = base - fontPenalty;
    // 5'li Parke: görüntüyü büyüt, ama taşmayı engellemek için font büyüdükçe kıs.
    const fiveBoost = isParquetFive ? 0.12 : 0;
    const fiveExtraFontPenalty = isParquetFive ? fontPenalty * 0.6 : 0;
    return Math.max(0.5, Math.min(1, raw + fiveBoost - fiveExtraFontPenalty));
  }, [globalFontSize, isParquetFive, selectedTemplate]);

  const parquetFiveImageScale = useMemo(() => {
    // 5'li Parke + 38px yazıda taşmayı önlemek için, görseli gerektiğinde küçült.
    if (!isParquetFive) return 1.18;
    const delta = Math.max(0, globalFontSize - PARQUET_DEFAULT_FONT_SIZE);
    const scaled = 1.18 - delta * 0.015;
    return Math.max(1.0, Math.min(1.18, scaled));
  }, [globalFontSize, isParquetFive]);

  const parquetSixGap = useMemo(() => {
    // Dynamic gap for 6'lı + Parke: narrows as text grows.
    // (CSS clamp string; Tailwind doesn't generate dynamic values here)
    if (!isParquetSix) return null;
    return "clamp(10px, 2vh, 34px)";
  }, [isParquetSix]);

  const parquetSixImageHeightPx = useMemo(() => {
    // Keep text readable; shrink image first as font grows.
    // Base: ~150px, then reduce 2px per font step, floor at 80px.
    const delta = Math.max(0, globalFontSize - DEFAULT_GLOBAL_FONT_SIZE);
    const h = 150 - delta * 2;
    return Math.max(80, Math.round(h));
  }, [globalFontSize]);

  function onSelectTemplate(t: TemplateCount) {
    setSelectedTemplate(t);
    setSlots((prev) => buildSlots(t, prev));
    setActiveSlotIndex(0);
    setImageErrorBySlot({});
  }

  useEffect(() => {
    const allowed = isParquetMode ? TEMPLATES_PARQUET : TEMPLATES_DEFAULT;
    if (!allowed.includes(selectedTemplate)) {
      const next = allowed[0] ?? 1;
      setSelectedTemplate(next);
      setSlots((prev) => buildSlots(next, prev));
      setActiveSlotIndex(0);
      setImageErrorBySlot({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParquetMode]);

  useEffect(() => {
    if (isParquetMode) {
      // Parke moduna geçildiği an 38px'e set et (kullanıcı slider oynamadıysa).
      setParquetSliderTouched(false);
      setGlobalFontSize(PARQUET_DEFAULT_FONT_SIZE);
    } else {
      // Parke'den çıkınca son non-parke değerine geri dön.
      setGlobalFontSize(lastNonParquetFontSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParquetMode]);

  useEffect(() => {
    // Zemin modu, katalog zeminiyle beraber export/canvas rengini de senkron tutsun.
    setCanvasBgColor(isDarkBg ? "#1D1616" : "#F5F5F5");
  }, [isDarkBg]);

  useEffect(() => {
    // Parke modunda değilken güncel fontu "geri dönülecek" değer olarak sakla.
    if (!isParquetMode) setLastNonParquetFontSize(globalFontSize);
  }, [globalFontSize, isParquetMode]);

  function clearSlot(index: number) {
    setSlots((prev) =>
      prev.map((s, idx) =>
        idx === index
          ? emptySlot()
          : s,
      ),
    );
    setImageErrorBySlot((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function markSlotImageError(index: number) {
    setImageErrorBySlot((prev) =>
      prev[index] ? prev : { ...prev, [index]: true },
    );
  }

  function clearSlotImageError(index: number) {
    setImageErrorBySlot((prev) => {
      if (!prev[index]) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  /** Slotun gerçek ebadı: ürünün kendi ebadı yoksa afişin seçili ebadı. */
  function sizeTextForSlot(p?: Product): string {
    if (p?.size && p.size !== "katalog") return p.size;
    return selectedTemplateSize;
  }

  function updateSlot(index: number, patch: Partial<SlotState>) {
    setSlots((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, ...patch } : s)),
    );
  }

  function moveSlot(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= slots.length) return;

    setSlots((prev) => {
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });

    setImageErrorBySlot((prev) => {
      const a = Boolean(prev[index]);
      const b = Boolean(prev[target]);
      if (!a && !b) return prev;
      const next = { ...prev };
      if (b) next[index] = true;
      else delete next[index];
      if (a) next[target] = true;
      else delete next[target];
      return next;
    });

    const remapIndex = (i: number | null) => {
      if (i === null) return null;
      if (i === index) return target;
      if (i === target) return index;
      return i;
    };
    setActiveSlotIndex((i) => remapIndex(i) ?? 0);
    setLibraryPickerSlotIndex((i) => remapIndex(i));
    setUploadingSlotIndex((i) => remapIndex(i));
    setPendingUploadSlotIndex((i) => remapIndex(i));
  }

  async function refreshUploadLibrary(prefix?: string) {
    try {
      setIsLoadingUploadLibrary(true);
      setUploadLibraryError(null);
      const p = (prefix ?? librarySelectedFolder ?? "").trim();
      const qs = p ? `?prefix=${encodeURIComponent(p)}` : "";
      const res = await fetch(`/api/uploads${qs}`, { cache: "no-store" });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ? ` – ${body.error}` : "";
        } catch {
          // gövde okunamadı
        }
        throw new Error(`Kütüphane yüklenemedi (${res.status})${detail}`);
      }
      const data = (await res.json()) as { items?: UploadLibraryItem[] };
      setUploadLibraryItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setUploadLibraryError((e as Error)?.message ?? "Upload list failed");
    } finally {
      setIsLoadingUploadLibrary(false);
    }
  }

  async function fetchLibraryFolders() {
    try {
      const res = await fetch("/api/uploads/folders", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        folders?: { name: string; path: string }[];
      };
      setLibraryFolders(Array.isArray(data?.folders) ? data.folders : []);
    } catch {
      // klasör listesi alınamazsa sessizce geç
    }
  }

  async function uploadImageToLibrary(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `Upload failed: ${res.status}`);
    }
    return (await res.json()) as {
      publicId: string;
      url: string;
      originalFilename: string;
      displayName?: string;
    };
  }

  function applyUploadedImageToSlot(
    idx: number,
    uploaded: {
      publicId: string;
      url: string;
      originalFilename?: string;
      displayName?: string;
    },
  ) {
    const rawTitle = (
      uploaded.displayName ||
      uploaded.originalFilename ||
      ""
    ).trim();
    const baseName = rawTitle.replace(/\.[^.]+$/, "") || rawTitle;
    setSlots((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const keepCustom = (s.customName ?? "").trim();
        return {
          ...s,
          imageUrlOverride: uploaded.url,
          imagePublicId: uploaded.publicId,
          customName: keepCustom ? s.customName : baseName || s.customName,
        };
      }),
    );
    setImageErrorBySlot((prev) => {
      if (!prev[idx]) return prev;
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }

  function clearCloudImageForSlot(index: number) {
    updateSlot(index, { imageUrlOverride: null, imagePublicId: null });
    setImageErrorBySlot((prev) => {
      if (!prev[index]) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function openUploadPickerForSlot(idx: number) {
    setCloudinaryUiError(null);
    setPendingUploadSlotIndex(idx);
    slotFileInputRef.current?.click();
  }

  function openLibraryPickerForSlot(idx: number) {
    setCloudinaryUiError(null);
    setUploadLibraryError(null);
    setLibraryPickerSlotIndex(idx);
    setIsUploadLibraryOpen(true);
    setLibrarySearch("");
    void fetchLibraryFolders();
    void refreshUploadLibrary(librarySelectedFolder);
  }

  function closeUploadLibraryModal() {
    setIsUploadLibraryOpen(false);
    setLibraryPickerSlotIndex(null);
  }

  async function onSlotImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const idx = pendingUploadSlotIndex;
    e.target.value = "";
    if (!file || idx === null) {
      setPendingUploadSlotIndex(null);
      return;
    }
    try {
      setCloudinaryUiError(null);
      setUploadingSlotIndex(idx);
      const result = await uploadImageToLibrary(file);
      applyUploadedImageToSlot(idx, result);
      await refreshUploadLibrary();
    } catch (err) {
      setCloudinaryUiError(
        (err as Error)?.message ?? "Görsel yüklenemedi",
      );
    } finally {
      setUploadingSlotIndex(null);
      setPendingUploadSlotIndex(null);
    }
  }

  function openSellFromBannerModal() {
    const rows: SellRow[] = [];
    slots.forEach((slot, idx) => {
      const p =
        slot.productId != null ? productsById.get(slot.productId) : undefined;
      const name = displayNameForSlot(p, slot);
      if (!name || name === "\u2014") return;
      const size =
        p?.size && p.size !== "katalog" ? p.size : selectedTemplateSize;
      const brand = (p?.brand || selectedManufacturer || "").trim();
      const sizeText = String(size || "").trim();

      if (slot.dualStock) {
        // Çift stoklu slot: 1. ve END için ayrı birer satır üret.
        const parts: Array<{
          part: "primary" | "end";
          label: string;
          quantity: string;
          unitPrice: string;
        }> = [
          {
            part: "primary",
            label: slot.primaryStockLabel?.trim() || "1.Stok",
            quantity: slot.stock || "",
            unitPrice: slot.price || "",
          },
          {
            part: "end",
            label: slot.endStockLabel?.trim() || "END.Stok",
            quantity: slot.endStock || "",
            unitPrice: slot.endStockPrice || "",
          },
        ];
        parts.forEach((part) => {
          // Hiç veri girilmemiş tarafı listeye ekleme.
          if (!part.quantity.trim() && !part.unitPrice.trim()) return;
          rows.push({
            rowKey: `${idx}:${part.part}`,
            slotIndex: idx,
            part: part.part,
            selected: true,
            productName: `${name} ${part.label}`.trim(),
            brand,
            size: sizeText,
            quantity: part.quantity,
            unitPrice: part.unitPrice,
            note: "",
          });
        });
        return;
      }

      rows.push({
        rowKey: `${idx}:primary`,
        slotIndex: idx,
        part: "primary",
        // Kampanya yazısı olan slotta stok/fiyat yok; yanlışlıkla 0 tutarlı
        // satış kaydedilmesin diye işaretsiz gelir.
        selected: !slot.hideStockPrice,
        productName: name,
        brand,
        size: sizeText,
        quantity: slot.stock || "",
        unitPrice: slot.price || "",
        note: "",
      });
    });
    if (rows.length === 0) {
      setSaleRecordMsg("Afişte kayıtlı ürün yok.");
      return;
    }
    setSellRows(rows);
    setSellCustomer("");
    setSellDate(new Date().toISOString().slice(0, 10));
    setSaleRecordMsg(null);
    setIsSellModalOpen(true);
  }

  function updateSellRow(rowKey: string, patch: Partial<SellRow>) {
    setSellRows((prev) =>
      prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)),
    );
  }

  async function saveSelectedSales() {
    const chosen = sellRows.filter((r) => r.selected);
    if (chosen.length === 0) {
      setSaleRecordMsg("En az bir ürün seçin.");
      return;
    }
    const records = chosen.map((r) => ({
      date: sellDate || new Date().toISOString().slice(0, 10),
      productName: r.productName,
      brand: r.brand.trim(),
      size: r.size.trim(),
      quantity: parseTrNumber(r.quantity),
      unitPrice: parseTrNumber(r.unitPrice),
      customer: sellCustomer.trim(),
      note: r.note.trim(),
      source: "banner" as const,
    }));
    try {
      setIsRecordingSale(true);
      setSaleRecordMsg(null);
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: records }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ? ` \u2013 ${body.error}` : "";
        } catch {}
        throw new Error(`Kaydedilemedi (${res.status})${detail}`);
      }
      const data = (await res.json()) as { added?: number };

      // Satılan miktarı afiş stok alanından düş (canlı afiş).
      // Çift stoklu slotlarda 1. ve END ayrı ayrı düşülür.
      const soldPrimary = new Map<number, number>();
      const soldEnd = new Map<number, number>();
      for (const r of chosen) {
        const target = r.part === "end" ? soldEnd : soldPrimary;
        target.set(
          r.slotIndex,
          (target.get(r.slotIndex) ?? 0) + parseTrNumber(r.quantity),
        );
      }
      const dropStock = (stock: string, sold: number): string => {
        const next = Math.max(0, Math.round((parseTrNumber(stock) - sold) * 100) / 100);
        return String(next);
      };
      const applySold = (sl: SlotState, idx: number): SlotState => {
        const p = soldPrimary.get(idx);
        const e = soldEnd.get(idx);
        if (p == null && e == null) return sl;
        return {
          ...sl,
          stock: p == null ? sl.stock : dropStock(sl.stock, p),
          endStock: e == null ? sl.endStock : dropStock(sl.endStock, e),
        };
      };
      setSlots((prev) => prev.map((sl, idx) => applySold(sl, idx)));
      // Düzenlenen sayfa kuyruktaysa onu da güncelle ki kaydedince kalıcı olsun.
      if (pdfEditingIndex != null) {
        setPdfQueue((prev) =>
          prev.map((it, idx) => {
            if (idx !== pdfEditingIndex) return it;
            const nextSlots = it.snapshot.slots.map((sl, sIdx) =>
              applySold(sl, sIdx),
            );
            return { ...it, snapshot: { ...it.snapshot, slots: nextSlots } };
          }),
        );
      }

      setIsSellModalOpen(false);
      setSaleRecordMsg(
        `${data.added ?? records.length} satış kaydedildi, stok düştü \u2713 — kalıcı olması için \u201cKaydet\u201d`,
      );
    } catch (e) {
      setSaleRecordMsg((e as Error)?.message ?? "Kaydedilemedi");
    } finally {
      setIsRecordingSale(false);
    }
  }

  function selectProductForActiveSlot(productId: string) {
    const idx = activeSlotIndex;
    updateSlot(idx, {
      productId,
      customName: "",
      imageUrlOverride: null,
      imagePublicId: null,
      surface: "",
      grade: "",
      isRec: false,
    });
    setImageErrorBySlot((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }

  function resetAllSlots() {
    setSlots(Array.from({ length: selectedTemplate }, () => emptySlot()));
    setActiveSlotIndex(0);
    setImageErrorBySlot({});
  }

  function applyPriceToAll(sourceIndex: number) {
    setSlots((prev) => {
      const source = prev[sourceIndex];
      const price = source?.price?.trim() ?? "";
      if (!price) return prev;
      return prev.map((s, idx) => {
        if (idx === sourceIndex) return s;
        if (!slotHasAssignableMedia(s)) return s;
        return { ...s, price };
      });
    });
  }

  /**
   * Bir slottaki görsel genişliğini tüm dolu slotlara uygular.
   * Boş bırakılmış (otomatik) değer de kopyalanabilsin diye trim edilmiş
   * hâli olduğu gibi yazılır.
   */
  function applyImageScaleToAll(sourceIndex: number) {
    setSlots((prev) => {
      const imageScale = (prev[sourceIndex]?.imageScale ?? "").trim();
      return prev.map((s, idx) => {
        if (idx === sourceIndex) return s;
        if (!slotHasAssignableMedia(s)) return s;
        return { ...s, imageScale };
      });
    });
  }

  useEffect(() => {
    const ac = new AbortController();

    async function loadProducts() {
      try {
        setIsLoadingProducts(true);
        setProductsError(null);
        const res = await fetch("/api/products", {
          signal: ac.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Products fetch failed: ${res.status}`);
        const data = (await res.json()) as Product[];
        console.log("Gelen Veri:", data);
        setProducts(Array.isArray(data) ? data : []);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setProducts([]);
        setProductsError("Ürünler yüklenemedi");
      } finally {
        setIsLoadingProducts(false);
      }
    }

    loadProducts();
    return () => ac.abort();
  }, []);

  useEffect(() => {
    console.log("Products state:", products);
  }, [products]);

  useEffect(() => {
    console.log("Filtrelenmiş Veri:", filteredProducts);
  }, [filteredProducts]);

  useEffect(() => {
    function recalcScale() {
      const el = workspaceRef.current;
      const availableH =
        (el?.clientHeight ?? window.innerHeight) - 48; // padding + breathing room
      const availableW = (el?.clientWidth ?? window.innerWidth) - 48;
      const byH = availableH / CANVAS_H;
      const byW = availableW / CANVAS_W;
      const next = Math.max(0.1, Math.min(1, byH, byW));
      setStudioScale(next);
    }

    recalcScale();
    window.addEventListener("resize", recalcScale);
    return () => window.removeEventListener("resize", recalcScale);
  }, []);

  async function downloadJpg() {
    const node = exportCanvasRef.current;
    if (!node) return;

    try {
      setIsDownloading(true);
      setExportError(null);
      await ensureExportImagesLoaded(node);
      const dataUrl = await toJpeg(node, {
        quality: 0.98,
        pixelRatio: 2,
        cacheBust: false,
        backgroundColor: canvasBg,
      });

      const a = document.createElement("a");
      const raw = fileName.trim();
      const safe = sanitizeFileComponent(raw);
      const sizePart = (selectedTemplateSize || "").trim();
      a.download = safe
        ? `${sizePart ? `${sizePart}_` : ""}${safe}.jpg`
        : "katalog-ciktisi.jpg";
      a.href = dataUrl;
      a.click();
    } catch (e) {
      setExportError(
        `JPG oluşturulamadı: ${(e as Error)?.message ?? "bilinmeyen hata"}. Görsellerin yüklendiğinden emin olup tekrar deneyin.`,
      );
    } finally {
      setIsDownloading(false);
    }
  }

  // Export öncesi tüm görsellerin yüklendiğinden emin ol (yarım yüklenen görsel export'u bozar).
  async function ensureExportImagesLoaded(node: HTMLElement) {
    const imgs = Array.from(node.querySelectorAll("img"));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            // güvenlik zaman aşımı
            setTimeout(done, 4000);
          }),
      ),
    );
  }


  function makeSnapshot(): DraftV1 {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      selectedTemplate,
      productImageAspect,
      globalFontSize,
      canvasBgColor,
      isDarkBg,
      selectedTemplateSize,
      selectedManufacturer,
      headerRightText,
      unitName,
      fileName,
      slots,
    };
  }

  function snapshotTitle() {
    const base = sanitizeFileComponent(fileName) || "katalog-ciktisi";
    const sizePart = sanitizeFileComponent(selectedTemplateSize) || "boyut";
    return `${sizePart}_${base}`;
  }

  function applySnapshot(d: DraftV1) {
    const allowedTemplates: TemplateCount[] = [...TEMPLATES_DEFAULT, ...TEMPLATES_PARQUET];
    const nextTemplate = allowedTemplates.includes(d.selectedTemplate)
      ? d.selectedTemplate
      : 4;
    const nextAspect: ProductImageAspect =
      d.productImageAspect === "square" ||
      d.productImageAspect === "threeTwo" ||
      d.productImageAspect === "video" ||
      d.productImageAspect === "parquet" ||
      d.productImageAspect === "oneThree" ||
      d.productImageAspect === "oneFour"
        ? d.productImageAspect
        : "square";

    setIsDarkBg(!!d.isDarkBg);
    setCanvasBgColor(
      typeof d.canvasBgColor === "string" && d.canvasBgColor.trim()
        ? d.canvasBgColor
        : d.isDarkBg
          ? "#1D1616"
          : "#F5F5F5",
    );
    setProductImageAspect(nextAspect);
    setSelectedTemplate(nextTemplate);
    setSlots(buildSlots(nextTemplate, Array.isArray(d.slots) ? d.slots : []));

    const nextGlobalFont =
      typeof d.globalFontSize === "number" && Number.isFinite(d.globalFontSize)
        ? Math.max(12, Math.min(64, Math.round(d.globalFontSize)))
        : DEFAULT_GLOBAL_FONT_SIZE;
    setGlobalFontSize(nextGlobalFont);
    if (nextAspect !== "parquet") setLastNonParquetFontSize(nextGlobalFont);

    setSelectedTemplateSize(d.selectedTemplateSize || "30x60");
    setSelectedManufacturer(d.selectedManufacturer || "QUA SERAMİK");
    setHeaderRightText(d.headerRightText || "SÖKE FABRİKA SEVK");
    setUnitName(d.unitName || DEFAULT_UNIT_NAME);
    setFileName(d.fileName || "");
    setActiveSlotIndex(0);
    setImageErrorBySlot({});
  }

  async function captureThumbnail(): Promise<string | null> {
    const node = exportCanvasRef.current;
    if (!node) return null;
    try {
      return await toJpeg(node, {
        quality: 0.7,
        pixelRatio: 0.25,
        cacheBust: true,
        backgroundColor: canvasBg,
      });
    } catch {
      return null;
    }
  }

  async function addOrUpdatePdfQueueItem() {
    const snap = makeSnapshot();
    const thumb = await captureThumbnail();
    const title = snapshotTitle();

    if (pdfEditingIndex != null) {
      setPdfQueue((prev) =>
        prev.map((it, idx) =>
          idx === pdfEditingIndex
            ? {
                ...it,
                title,
                thumbnailDataUrl: thumb ?? it.thumbnailDataUrl,
                snapshot: snap,
              }
            : it,
        ),
      );
      setPdfEditingIndex(null);
      return;
    }

    // Not: id üretimi sadece bu buton tıklamasıyla (event handler içinde) çalışır,
    // render sırasında değil — react-hooks/purity kuralı burada yanlış pozitif üretiyor.
    // eslint-disable-next-line react-hooks/purity
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setPdfQueue((prev) => [
      ...prev,
      { id, title, thumbnailDataUrl: thumb, snapshot: snap },
    ]);
  }

  function movePdfQueueItem(idx: number, direction: -1 | 1) {
    const target = idx + direction;
    if (target < 0 || target >= pdfQueue.length) return;
    setPdfQueue((prev) => {
      const next = [...prev];
      const tmp = next[idx]!;
      next[idx] = next[target]!;
      next[target] = tmp;
      return next;
    });
    setPdfEditingIndex((cur) => {
      if (cur == null) return cur;
      if (cur === idx) return target;
      if (cur === target) return idx;
      return cur;
    });
  }

  function toggleQueueItemExpanded(id: string) {
    setExpandedQueueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Sayfalar arasında ekranda görünen küçük önizlemeleri tazeler
  // (gerçek PDF çıktısı zaten her zaman güncel snapshot'tan üretilir).
  async function refreshQueueThumbnails(
    items: { index: number; item: PdfQueueItemV1 }[],
  ) {
    const original = makeSnapshot();
    for (const { index, item } of items) {
      applySnapshot(item.snapshot);
      await sleep(0);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const node = exportCanvasRef.current;
      if (node) await ensureExportImagesLoaded(node);
      const thumb = await captureThumbnail();
      if (thumb) {
        setPdfQueue((prev) =>
          prev.map((it, i) =>
            i === index ? { ...it, thumbnailDataUrl: thumb } : it,
          ),
        );
      }
    }
    applySnapshot(original);
  }

  // Bir sayfadaki tek bir ürünü, başka bir sayfanın boş bir slotuna taşır.
  function movePdfSlotToPage(sourceIdx: number, slotIdx: number, targetIdx: number) {
    if (sourceIdx === targetIdx) return;
    const source = pdfQueue[sourceIdx];
    const target = pdfQueue[targetIdx];
    if (!source || !target) return;
    const movingSlot = source.snapshot.slots[slotIdx];
    if (!movingSlot || !slotHasAssignableMedia(movingSlot)) return;
    const emptyIdxInTarget = target.snapshot.slots.findIndex(
      (s) => !slotHasAssignableMedia(s),
    );
    if (emptyIdxInTarget === -1) return;

    const updatedSource: PdfQueueItemV1 = {
      ...source,
      snapshot: {
        ...source.snapshot,
        slots: source.snapshot.slots.map((s, i) =>
          i === slotIdx ? emptySlot() : s,
        ),
      },
    };
    const updatedTarget: PdfQueueItemV1 = {
      ...target,
      snapshot: {
        ...target.snapshot,
        slots: target.snapshot.slots.map((s, i) =>
          i === emptyIdxInTarget ? movingSlot : s,
        ),
      },
    };

    setPdfQueue((prev) =>
      prev.map((it, i) => {
        if (i === sourceIdx) return updatedSource;
        if (i === targetIdx) return updatedTarget;
        return it;
      }),
    );

    // Şu an düzenlenmekte olan sayfa etkilendiyse ekrandaki canlı hâli de senkron tut.
    if (pdfEditingIndex === sourceIdx) {
      setSlots(updatedSource.snapshot.slots);
    } else if (pdfEditingIndex === targetIdx) {
      setSlots(updatedTarget.snapshot.slots);
    }

    void refreshQueueThumbnails([
      { index: sourceIdx, item: updatedSource },
      { index: targetIdx, item: updatedTarget },
    ]);
  }

  async function downloadPdfFromQueue() {
    if (pdfQueue.length === 0) return;
    const node = exportCanvasRef.current;
    if (!node) return;

    const original = makeSnapshot();
    const pdfName = `${snapshotTitle()}_PDF.pdf`;

    try {
      setIsBuildingPdf(true);
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [CANVAS_W, CANVAS_H],
        compress: true,
      });

      for (let i = 0; i < pdfQueue.length; i++) {
        const item = pdfQueue[i]!;
        applySnapshot(item.snapshot);
        await sleep(0);
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        await new Promise<void>((r) => requestAnimationFrame(() => r()));

        await ensureExportImagesLoaded(node);
        const dataUrl = await toJpeg(node, {
          quality: 0.98,
          pixelRatio: 2,
          cacheBust: false,
          backgroundColor: normalizeHexColor(item.snapshot.canvasBgColor),
        });

        if (i > 0) doc.addPage([CANVAS_W, CANVAS_H], "portrait");
        doc.addImage(dataUrl, "JPEG", 0, 0, CANVAS_W, CANVAS_H);
      }

      doc.save(pdfName);
    } finally {
      applySnapshot(original);
      setPdfEditingIndex(null);
      setIsBuildingPdf(false);
    }
  }

  function productNamesFromSnapshot(snap: DraftV1): string[] {
    const names: string[] = [];
    for (const slot of Array.isArray(snap.slots) ? snap.slots : []) {
      const p =
        slot.productId != null ? productsById.get(slot.productId) : undefined;
      const name = displayNameForSlot(p, slot);
      if (name && name !== "\u2014") names.push(name);
    }
    return names;
  }

  async function saveCatalogToCloud() {
    try {
      setSavingDraft(true);
      setDraftSaveMsg(null);
      const current = makeSnapshot();
      // Kuyruk doluysa tüm sayfaları, boşsa mevcut afişi tek sayfa olarak kaydet.
      const queue: PdfQueueItemV1[] =
        pdfQueue.length > 0
          ? pdfQueue
          : [
              {
                id: "sayfa-0",
                title: snapshotTitle(),
                thumbnailDataUrl: null,
                snapshot: current,
              },
            ];
      const catalog: CatalogV1 = { version: 1, queue, current };

      // Ürün adlarını TÜM sayfalardan topla (arama için).
      const names = new Set<string>();
      for (const it of queue) {
        for (const n of productNamesFromSnapshot(it.snapshot)) names.add(n);
      }

      const title =
        fileName.trim() ||
        `${selectedTemplateSize} ${selectedManufacturer}`.trim();
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          size: selectedTemplateSize,
          manufacturer: selectedManufacturer,
          pageCount: queue.length,
          productNames: Array.from(names),
          catalog,
        }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ? ` \u2013 ${body.error}` : "";
        } catch {}
        throw new Error(`Kaydedilemedi (${res.status})${detail}`);
      }
      const data = (await res.json()) as {
        items?: DraftSummary[];
        overwritten?: boolean;
      };
      if (Array.isArray(data?.items)) setSavedItems(data.items);
      setDraftSaveMsg(
        data?.overwritten
          ? `\u201c${title}\u201d güncellendi (${queue.length} sayfa) \u2713`
          : `\u201c${title}\u201d kaydedildi (${queue.length} sayfa) \u2713`,
      );
    } catch (e) {
      setDraftSaveMsg((e as Error)?.message ?? "Kaydedilemedi");
    } finally {
      setSavingDraft(false);
    }
  }

  async function refreshSavedDrafts() {
    try {
      setSavedLoading(true);
      setSavedError(null);
      const res = await fetch("/api/drafts", { cache: "no-store" });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ? ` \u2013 ${body.error}` : "";
        } catch {}
        throw new Error(`Liste alınamadı (${res.status})${detail}`);
      }
      const data = (await res.json()) as { items?: DraftSummary[] };
      setSavedItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setSavedError((e as Error)?.message ?? "Liste alınamadı");
    } finally {
      setSavedLoading(false);
    }
  }

  function openSavedModal() {
    setSavedError(null);
    setSavedSearch("");
    setIsSavedOpen(true);
    void refreshSavedDrafts();
  }

  async function openSavedCatalog(id: string) {
    try {
      setSavedError(null);
      const res = await fetch(`/api/drafts?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Katalog açılamadı (${res.status})`);
      const data = (await res.json()) as { catalog?: unknown; draft?: unknown };
      const cat = (data?.catalog ?? data?.draft) as
        | Partial<CatalogV1>
        | undefined;

      // Kuyruğu geri yükle (her sayfayı doğrula).
      const rawQueue = Array.isArray(cat?.queue) ? cat!.queue : [];
      const queue: PdfQueueItemV1[] = [];
      rawQueue.forEach((it, qi) => {
        const obj = it as Partial<PdfQueueItemV1> | undefined;
        const snap = normalizeDraftLike(obj?.snapshot);
        if (!snap) return;
        queue.push({
          id:
            typeof obj?.id === "string" && obj.id ? obj.id : `sayfa-${qi}`,
          title: typeof obj?.title === "string" ? obj.title : "Sayfa",
          thumbnailDataUrl:
            typeof obj?.thumbnailDataUrl === "string" ? obj.thumbnailDataUrl : null,
          snapshot: snap,
        });
      });

      let current =
        normalizeDraftLike(cat?.current) ??
        (queue.length > 0 ? queue[0]!.snapshot : null);

      // Geriye dönük uyum: eski tek-sayfa formatı (kayıt doğrudan bir DraftV1).
      if (!current && queue.length === 0) {
        const legacy = normalizeDraftLike(cat);
        if (legacy) {
          current = legacy;
          queue.push({
            id: "sayfa-0",
            title: legacy.fileName || "Sayfa",
            thumbnailDataUrl: null,
            snapshot: legacy,
          });
        }
      }

      if (!current) throw new Error("Katalog verisi geçersiz");

      setPdfQueue(queue);
      applySnapshot(current);
      // İlk sayfayı düzenleme moduna al ki satış/düzenleme o sayfayı güncellesin.
      setPdfEditingIndex(queue.length > 0 ? 0 : null);
      setIsSavedOpen(false);
    } catch (e) {
      setSavedError((e as Error)?.message ?? "Katalog açılamadı");
    }
  }

  async function deleteSavedDraft(id: string) {
    if (!confirm("Bu kayıtlı afiş silinsin mi?")) return;
    try {
      setSavedError(null);
      const res = await fetch(`/api/drafts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Silinemedi (${res.status})`);
      const data = (await res.json()) as { items?: DraftSummary[] };
      setSavedItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setSavedError((e as Error)?.message ?? "Silinemedi");
    }
  }

  function exportDraftJson() {
    try {
      const baseName = sanitizeFileComponent(fileName) || "katalog-ciktisi";
      const sizePart = sanitizeFileComponent(selectedTemplateSize) || "boyut";

      const draft: DraftV1 = {
        version: 1,
        savedAt: new Date().toISOString(),
        selectedTemplate,
        productImageAspect,
        globalFontSize,
        canvasBgColor,
        isDarkBg,
        selectedTemplateSize,
        selectedManufacturer,
        headerRightText,
        unitName,
        fileName,
        slots,
      };

      const json = JSON.stringify(draft, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${sizePart}_${baseName}_Taslak.json`;
      a.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // swallow: export should never crash UI
    }
  }

  function exportPdfQueueJson() {
    try {
      const baseName = sanitizeFileComponent(fileName) || "katalog-ciktisi";
      const sizePart = sanitizeFileComponent(selectedTemplateSize) || "boyut";

      const payload: PdfQueueExportV1 = {
        version: 1,
        savedAt: new Date().toISOString(),
        items: pdfQueue,
      };

      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${sizePart}_${baseName}_PDFKuyrugu.json`;
      a.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // swallow: export should never crash UI
    }
  }

  function normalizeDraftLike(input: unknown): DraftV1 | null {
    if (!input || typeof input !== "object") return null;
    const parsed = input as Partial<DraftV1>;
    if (parsed.version !== 1) return null;

    const allowedTemplates: TemplateCount[] = [...TEMPLATES_DEFAULT, ...TEMPLATES_PARQUET];
    if (!allowedTemplates.includes(parsed.selectedTemplate as TemplateCount)) return null;
    const nextTemplate = parsed.selectedTemplate as TemplateCount;

    const nextAspect: ProductImageAspect =
      parsed.productImageAspect === "square" ||
      parsed.productImageAspect === "threeTwo" ||
      parsed.productImageAspect === "video" ||
      parsed.productImageAspect === "parquet" ||
      parsed.productImageAspect === "oneThree" ||
      parsed.productImageAspect === "oneFour"
        ? parsed.productImageAspect
        : "square";

    const nextGlobalFont =
      typeof parsed.globalFontSize === "number" && Number.isFinite(parsed.globalFontSize)
        ? Math.max(12, Math.min(64, Math.round(parsed.globalFontSize)))
        : DEFAULT_GLOBAL_FONT_SIZE;

    const nextIsDarkBg = typeof parsed.isDarkBg === "boolean" ? parsed.isDarkBg : false;
    const nextCanvasBgColor =
      typeof parsed.canvasBgColor === "string" && parsed.canvasBgColor.trim()
        ? parsed.canvasBgColor
        : nextIsDarkBg
          ? "#1D1616"
          : "#F5F5F5";

    const slotsFromFile = Array.isArray(parsed.slots) ? parsed.slots : [];
    const normalizedSlots: SlotState[] = Array.from({ length: nextTemplate }, (_, idx) => {
      const s = slotsFromFile[idx] as Partial<SlotState> | undefined;
      return normalizeSlotFromPartial(s);
    });

    return {
      version: 1,
      savedAt: typeof parsed.savedAt === "string" && parsed.savedAt ? parsed.savedAt : new Date().toISOString(),
      selectedTemplate: nextTemplate,
      productImageAspect: nextAspect,
      globalFontSize: nextGlobalFont,
      canvasBgColor: nextCanvasBgColor,
      isDarkBg: nextIsDarkBg,
      selectedTemplateSize: typeof parsed.selectedTemplateSize === "string" && parsed.selectedTemplateSize.trim()
        ? parsed.selectedTemplateSize
        : "30x60",
      selectedManufacturer: typeof parsed.selectedManufacturer === "string" && parsed.selectedManufacturer.trim()
        ? parsed.selectedManufacturer
        : "QUA SERAMİK",
      headerRightText: typeof parsed.headerRightText === "string" && parsed.headerRightText.trim()
        ? parsed.headerRightText
        : "SÖKE FABRİKA SEVK",
      unitName: typeof parsed.unitName === "string" && parsed.unitName.trim() ? parsed.unitName : DEFAULT_UNIT_NAME,
      fileName: typeof parsed.fileName === "string" ? parsed.fileName : "",
      slots: normalizedSlots,
    };
  }

  async function importPdfQueueFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<PdfQueueExportV1>;
      if (!parsed || typeof parsed !== "object") return;
      if (parsed.version !== 1) return;
      if (!Array.isArray(parsed.items)) return;

      const items: PdfQueueItemV1[] = parsed.items
        .map((it) => {
          if (!it || typeof it !== "object") return null;
          const obj = it as Partial<PdfQueueItemV1>;
          if (typeof obj.id !== "string" || !obj.id.trim()) return null;
          const snap = normalizeDraftLike(obj.snapshot);
          if (!snap) return null;
          return {
            id: obj.id,
            title: typeof obj.title === "string" ? obj.title : snapshotTitle(),
            thumbnailDataUrl:
              typeof obj.thumbnailDataUrl === "string" || obj.thumbnailDataUrl === null
                ? obj.thumbnailDataUrl
                : null,
            snapshot: snap,
          } satisfies PdfQueueItemV1;
        })
        .filter(Boolean) as PdfQueueItemV1[];

      setPdfQueue(items);
      setPdfEditingIndex(null);
    } catch {
      // invalid JSON or unexpected shape: ignore safely
    }
  }

  async function importDraftFile(file: File) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<DraftV1>;
      if (!parsed || typeof parsed !== "object") return;
      if (parsed.version !== 1) return;

      const allowedTemplates: TemplateCount[] = [...TEMPLATES_DEFAULT, ...TEMPLATES_PARQUET];
      if (!allowedTemplates.includes(parsed.selectedTemplate as TemplateCount)) return;
      const nextTemplate = parsed.selectedTemplate as TemplateCount;

      const nextAspect: ProductImageAspect =
        parsed.productImageAspect === "square" ||
        parsed.productImageAspect === "threeTwo" ||
        parsed.productImageAspect === "video" ||
        parsed.productImageAspect === "parquet" ||
        parsed.productImageAspect === "oneThree" ||
        parsed.productImageAspect === "oneFour"
          ? parsed.productImageAspect
          : productImageAspect;

      const nextGlobalFont =
        typeof parsed.globalFontSize === "number" && Number.isFinite(parsed.globalFontSize)
          ? Math.max(12, Math.min(64, Math.round(parsed.globalFontSize)))
          : globalFontSize;

      const nextIsDarkBg = typeof parsed.isDarkBg === "boolean" ? parsed.isDarkBg : isDarkBg;

      const slotsFromFile = Array.isArray(parsed.slots) ? parsed.slots : [];
      const normalizedSlots: SlotState[] = Array.from({ length: nextTemplate }, (_, idx) => {
        const s = slotsFromFile[idx] as Partial<SlotState> | undefined;
        return normalizeSlotFromPartial(s);
      });

      setIsDarkBg(nextIsDarkBg);
      setCanvasBgColor(
        typeof parsed.canvasBgColor === "string" && parsed.canvasBgColor.trim()
          ? parsed.canvasBgColor
          : nextIsDarkBg
            ? "#1D1616"
            : "#F5F5F5",
      );

      setProductImageAspect(nextAspect);
      setSelectedTemplate(nextTemplate);
      setSlots(buildSlots(nextTemplate, normalizedSlots));

      setGlobalFontSize(nextGlobalFont);
      if (nextAspect !== "parquet") setLastNonParquetFontSize(nextGlobalFont);
      if (nextAspect === "parquet") setParquetSliderTouched(true);

      if (typeof parsed.selectedTemplateSize === "string" && parsed.selectedTemplateSize.trim()) {
        setSelectedTemplateSize(parsed.selectedTemplateSize);
      }
      if (
        typeof parsed.selectedManufacturer === "string" &&
        parsed.selectedManufacturer.trim()
      ) {
        setSelectedManufacturer(parsed.selectedManufacturer);
      }
      if (typeof parsed.headerRightText === "string" && parsed.headerRightText.trim()) {
        setHeaderRightText(parsed.headerRightText);
      }
      if (typeof parsed.unitName === "string" && parsed.unitName.trim()) {
        setUnitName(parsed.unitName);
      }
      if (typeof parsed.fileName === "string") {
        setFileName(parsed.fileName);
      }
    } catch {
      // invalid JSON or unexpected shape: ignore safely
    }
  }

  return (
    <div
      className="min-h-screen flex bg-zinc-50 text-zinc-900"
      style={{
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'",
      }}
    >
      <aside className="relative w-[380px] shrink-0 border-r border-zinc-200 bg-white">
        <input
          ref={slotFileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onSlotImageFileChange}
        />
        <div className="h-full flex flex-col">
          <div className="p-5 border-b border-zinc-200">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    Kulalılar Katalog Studio
                  </div>
                  <div className="text-xs text-zinc-500">
                    Siyah-beyaz, temiz katalog çıktısı
                  </div>
                </div>
                <Link
                  href="/sales"
                  className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                >
                  Satışlar →
                </Link>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                  Dosya Adı
                </label>
                <input
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="örn. Mavi-Picasso"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  aria-label="Dosya adı"
                />
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                  Dışa Aktar · bu afiş
                </div>
                <button
                  onClick={downloadJpg}
                  disabled={isDownloading || isBuildingPdf}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  <Icon name="download" className="h-4 w-4" />
                  {isDownloading ? "İndiriliyor…" : "JPG İndir"}
                </button>
                {exportError ? (
                  <div className="mt-1.5 text-[11px] text-red-600">
                    {exportError}
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                  Studio Kayıt
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void saveCatalogToCloud()}
                    disabled={savingDraft || isDownloading || isBuildingPdf}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    title="Tüm katalogu (PDF kuyruğundaki tüm sayfalar) studio'ya kaydet — aynı isim üzerine yazar"
                  >
                    {savingDraft ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                  <button
                    type="button"
                    onClick={openSavedModal}
                    disabled={isDownloading || isBuildingPdf}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                    title="Kayıtlı afişleri aç / ürün ismiyle ara"
                  >
                    Kayıtlı Afişler
                  </button>
                </div>
                {draftSaveMsg ? (
                  <div className="mt-1.5 text-[11px] text-blue-700">
                    {draftSaveMsg}
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                  Satış
                </div>
                <button
                  type="button"
                  onClick={openSellFromBannerModal}
                  disabled={isRecordingSale || isDownloading || isBuildingPdf}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                  title="Afişten satılan ürünleri seç ve kaydet"
                >
                  Afişten satış kaydet…
                </button>
                {saleRecordMsg ? (
                  <div className="mt-1.5 text-[11px] text-emerald-700">
                    {saleRecordMsg}
                  </div>
                ) : null}
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                  PDF Kuyruğu · toplu katalog
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void addOrUpdatePdfQueueItem()}
                    disabled={isDownloading || isBuildingPdf}
                    className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    {pdfEditingIndex != null ? "Sayfayı Güncelle" : "Listeye Ekle"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadPdfFromQueue()}
                    disabled={pdfQueue.length === 0 || isDownloading || isBuildingPdf}
                    className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                    title={pdfQueue.length === 0 ? "PDF kuyruğu boş" : "Kuyruğu PDF indir"}
                  >
                    PDF İndir ({pdfQueue.length})
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={exportPdfQueueJson}
                    disabled={pdfQueue.length === 0 || isDownloading || isBuildingPdf}
                    className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                    title={pdfQueue.length === 0 ? "PDF kuyruğu boş" : "PDF kuyruğunu JSON olarak kaydet"}
                  >
                    Kuyruğu Kaydet
                  </button>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
                    Kuyruğu Yükle
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0];
                        if (!f) return;
                        void importPdfQueueFile(f);
                        e.currentTarget.value = "";
                      }}
                      className="hidden"
                      aria-label="PDF kuyruğu yükle"
                    />
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                  Yerel Yedek · .json
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={exportDraftJson}
                    disabled={isDownloading || isBuildingPdf}
                    className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    Taslağı Kaydet
                  </button>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50">
                    Taslak Yükle
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0];
                        if (!f) return;
                        void importDraftFile(f);
                        e.currentTarget.value = "";
                      }}
                      className="hidden"
                      aria-label="Taslak yükle"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 pb-24 space-y-5 overflow-auto">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900">PDF Kuyruğu</div>
                <button
                  type="button"
                  onClick={() => {
                    setPdfQueue([]);
                    setPdfEditingIndex(null);
                  }}
                  disabled={pdfQueue.length === 0 || isBuildingPdf}
                  className="inline-flex items-center gap-2 justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                >
                  Tüm Listeyi Temizle
                </button>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
                {pdfQueue.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-zinc-500">
                    Henüz sayfa eklenmedi.
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-200">
                    {pdfQueue.map((item, idx) => (
                      <PdfQueueRow
                        key={item.id}
                        item={item}
                        idx={idx}
                        pdfQueue={pdfQueue}
                        expanded={expandedQueueIds.has(item.id)}
                        isBuildingPdf={isBuildingPdf}
                        productsById={productsById}
                        onMoveUp={() => movePdfQueueItem(idx, -1)}
                        onMoveDown={() => movePdfQueueItem(idx, 1)}
                        onToggleExpand={() => toggleQueueItemExpanded(item.id)}
                        onEdit={() => {
                          applySnapshot(item.snapshot);
                          setPdfEditingIndex(idx);
                        }}
                        onDelete={() => {
                          setPdfQueue((prev) => prev.filter((x) => x.id !== item.id));
                          setPdfEditingIndex((cur) => {
                            if (cur == null) return null;
                            if (cur === idx) return null;
                            if (cur > idx) return cur - 1;
                            return cur;
                          });
                          setExpandedQueueIds((prev) => {
                            if (!prev.has(item.id)) return prev;
                            const next = new Set(prev);
                            next.delete(item.id);
                            return next;
                          });
                        }}
                        onMoveSlot={(slotIdx, targetIdx) =>
                          movePdfSlotToPage(idx, slotIdx, targetIdx)
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900">Şablon</div>
                <button
                  type="button"
                  onClick={resetAllSlots}
                  className="inline-flex items-center gap-2 justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                >
                  <Icon name="trash" className="h-4 w-4" />
                  Sıfırla
                </button>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {(isParquetMode ? TEMPLATES_PARQUET : TEMPLATES_DEFAULT).map((t) => (
                  <button
                    key={t}
                    onClick={() => onSelectTemplate(t)}
                    className={[
                      "rounded-lg border px-2 py-2 text-sm font-semibold transition",
                      t === selectedTemplate
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-sm font-semibold text-zinc-900">
                Arka Plan Rengi (Canvas)
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={canvasBg}
                  onChange={(e) => setCanvasBgColor(e.target.value)}
                  className="h-10 w-12 rounded-lg border border-zinc-200 bg-white p-1"
                  aria-label="Arka plan rengi seç"
                />
                <input
                  value={canvasBg}
                  onChange={(e) => setCanvasBgColor(e.target.value)}
                  className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-zinc-400"
                  placeholder={DEFAULT_CANVAS_BG}
                />
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="text-sm font-semibold text-zinc-900 font-montserrat">
                  Zemin Modu
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs font-montserrat text-zinc-600">
                    <span className={isDarkBg ? "font-bold" : ""}>
                      Koyu (#1D1616)
                    </span>
                    <span className="mx-2 text-zinc-300">/</span>
                    <span className={!isDarkBg ? "font-bold" : ""}>
                      Açık (#F5F5F5)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDarkBg((v) => !v)}
                    className="relative inline-flex h-8 w-16 items-center rounded-full border border-zinc-200 bg-white transition"
                    aria-label="Zemin modu (Koyu / Açık)"
                  >
                    <span
                      className={[
                        "inline-block h-7 w-7 transform rounded-full transition",
                        isDarkBg
                          ? "translate-x-8 bg-zinc-900"
                          : "translate-x-1 bg-zinc-200",
                      ].join(" ")}
                    />
                  </button>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-sm font-semibold text-zinc-900">
                Header / Boyut / Marka / Birim
              </div>
              <label className="space-y-1">
                <div className="text-xs font-semibold text-zinc-600">
                  Header sağ kutu
                </div>
                <input
                  value={headerRightText}
                  onChange={(e) => setHeaderRightText(e.target.value)}
                  placeholder="örn. BİLECİK FABRİKA SEVK"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                />
              </label>
              <div className="space-y-4">
                <label className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-600">Boyut</div>
                  <input
                    list="size-options"
                    value={selectedTemplateSize}
                    onChange={(e) => setSelectedTemplateSize(e.target.value)}
                    placeholder="örn. 60x120"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                  <datalist id="size-options">
                    {SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt} />
                    ))}
                  </datalist>
                </label>
                <label className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-600">Marka</div>
                  <input
                    value={selectedManufacturer}
                    onChange={(e) => {
                      setSelectedManufacturer(e.target.value);
                    }}
                    placeholder="örn. QUA SERAMİK"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  />
                </label>
              </div>
              <label className="space-y-1">
                <div className="text-xs font-semibold text-zinc-600">Birim</div>
                <input
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder={DEFAULT_UNIT_NAME}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                />
              </label>
            </section>

            <section className="space-y-3">
              <div className="text-sm font-semibold text-zinc-900">
                Yazı Ayarları
              </div>

              <label className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-zinc-600">
                    Global yazı boyutu
                  </div>
                  <div className="text-xs font-bold tabular-nums text-zinc-900">
                    {globalFontSize}px
                  </div>
                </div>
                <input
                  type="range"
                  min={12}
                  max={64}
                  value={globalFontSize}
                  onChange={(e) => {
                    setGlobalFontSize(Number(e.target.value));
                    if (isParquetMode) setParquetSliderTouched(true);
                  }}
                  className="w-full"
                  aria-label="Global yazı boyutu"
                />
              </label>
            </section>

            <section className="space-y-3">
              <div className="text-sm font-semibold text-zinc-900">
                Ürün Görsel Oranı
              </div>
              <select
                value={productImageAspect}
                onChange={(e) =>
                  setProductImageAspect(e.target.value as ProductImageAspect)
                }
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                aria-label="Ürün görsel oranı"
              >
                <option value="square">Kare (1:1)</option>
                <option value="threeTwo">Yatay (3:2)</option>
                <option value="video">60×120 (1:2)</option>
                <option value="oneThree">Dikey 1:3 (30×90 / 40×120)</option>
                <option value="oneFour">Dikey 1:4 (7,5×30 / 5×20)</option>
                <option value="parquet">Parke (1:6)</option>
              </select>
            </section>


            <section className="space-y-3">
              <div className="text-sm font-semibold text-zinc-900">Ürün Ara</div>

              <div
                className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5"
                role="tablist"
                aria-label="Ürün kaynağı"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={productPickerTab === "catalog"}
                  onClick={() => setProductPickerTab("catalog")}
                  className={[
                    "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition",
                    productPickerTab === "catalog"
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900",
                  ].join(" ")}
                >
                  Katalog
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={productPickerTab === "cloudinary"}
                  onClick={() => {
                    setProductPickerTab("cloudinary");
                    setUploadLibraryError(null);
                    void refreshUploadLibrary();
                  }}
                  className={[
                    "flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition",
                    productPickerTab === "cloudinary"
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900",
                  ].join(" ")}
                >
                  Cloudinary
                </button>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={
                    productPickerTab === "catalog"
                      ? "İsim, marka, boyut…"
                      : "Dosya adı veya public id…"
                  }
                  className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-zinc-400"
                  aria-label="Ara"
                />
              </div>

              {productPickerTab === "catalog" ? (
                <div className="text-[11px] text-zinc-500">
                  <span className="font-semibold text-zinc-700">
                    {filteredProducts.length}
                  </span>
                  {" / "}
                  {products.length} katalog
                  {productsError ? (
                    <span className="text-red-600"> • liste hatası</span>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                  <span>
                    <span className="font-semibold text-zinc-700">
                      {filteredUploadLibraryItems.length}
                    </span>{" "}
                    görsel
                    {uploadLibraryError ? (
                      <span className="text-red-600"> • yükleme hatası</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshUploadLibrary()}
                    disabled={isLoadingUploadLibrary}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Yenile
                  </button>
                </div>
              )}

              <div className="max-h-[400px] overflow-y-auto rounded-lg border border-zinc-200 bg-white">
                {productPickerTab === "catalog" ? (
                  productsError ? (
                    <div className="px-3 py-3 text-sm text-zinc-500">
                      {productsError}
                    </div>
                  ) : isLoadingProducts ? (
                    <div className="px-3 py-3 text-sm text-zinc-500">
                      Yükleniyor…
                    </div>
                  ) : filteredProducts.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-zinc-500">
                      Ürün bulunamadı
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-100">
                      {filteredProducts.map((p) => {
                        const isSelected =
                          slots[activeSlotIndex]?.productId === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectProductForActiveSlot(p.id)}
                            className={[
                              "w-full text-left px-3 py-2 transition",
                              isSelected
                                ? "bg-zinc-50"
                                : "hover:bg-zinc-50",
                            ].join(" ")}
                            title="Aktif slota yerleştir"
                          >
                            <div className="text-sm font-semibold text-zinc-900">
                              {p.name}
                            </div>
                            <div className="text-xs text-zinc-500 font-montserrat">
                              {(p.size?.trim() ? p.size : "—") +
                                " • " +
                                (p.brand?.trim() ? p.brand : "—")}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : uploadLibraryError ? (
                  <div className="px-3 py-3 text-sm text-red-700">
                    {uploadLibraryError}
                  </div>
                ) : isLoadingUploadLibrary &&
                  uploadLibraryItems.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-zinc-500">
                    Cloudinary listesi yükleniyor…
                  </div>
                ) : filteredUploadLibraryItems.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-zinc-500">
                    {uploadLibraryItems.length === 0
                      ? "Henüz yüklenmiş görsel yok. Slot kartından “Yükle” kullanın."
                      : "Aramanızla eşleşen görsel yok."}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 p-2">
                    {filteredUploadLibraryItems.map((item) => {
                      const slot = slots[activeSlotIndex];
                      const isCloudSelected = Boolean(
                        slot?.imagePublicId &&
                          slot.imagePublicId === item.publicId,
                      );
                      return (
                        <button
                          key={item.publicId}
                          type="button"
                          onClick={() => {
                            setCloudinaryUiError(null);
                            applyUploadedImageToSlot(activeSlotIndex, {
                              publicId: item.publicId,
                              url: item.url,
                              originalFilename: item.originalFilename,
                              displayName: item.displayName,
                            });
                          }}
                          className={[
                            "overflow-hidden rounded-lg border text-left transition",
                            isCloudSelected
                              ? "border-zinc-900 ring-1 ring-zinc-900"
                              : "border-zinc-200 hover:border-zinc-400",
                          ].join(" ")}
                          title="Aktif slota Cloudinary görseli olarak yerleştir"
                        >
                          <div className="aspect-square w-full overflow-hidden bg-zinc-100">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="line-clamp-2 px-1.5 py-1 text-[10px] font-medium text-zinc-800">
                            {cloudItemLabel(item)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="text-xs text-zinc-500">
                {productPickerTab === "catalog" ? (
                  <>
                    Listeden bir ürüne tıklayınca{" "}
                    <span className="font-semibold text-zinc-900">
                      aktif slota
                    </span>{" "}
                    yerleşir.
                  </>
                ) : (
                  <>
                    Bir görsele tıklayınca{" "}
                    <span className="font-semibold text-zinc-900">
                      aktif slot
                    </span>
                    , Cloudinary görseliyle güncellenir (katalog ürünü
                    seçiliyse görsel değişir; ürün bilgisi kalır).
                  </>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-sm font-semibold text-zinc-900">
                Slotlar (Ürün / Stok / Fiyat)
              </div>
              {cloudinaryUiError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {cloudinaryUiError}
                </div>
              ) : null}

              <div className="space-y-3">
                {slots.map((s, idx) => {
                  const p = s.productId ? productsById.get(s.productId) : null;
                  const isActive = idx === activeSlotIndex;
                  const hasCloudOverride = Boolean(
                    (s.imageUrlOverride && s.imageUrlOverride.trim()) ||
                      s.imagePublicId,
                  );
                  const mediaOk = slotHasAssignableMedia(s);
                  const titleLine = p
                    ? p.name
                    : hasCloudOverride
                      ? (s.customName || "").trim() || "Özel görsel"
                      : "Ürün seçilmedi";
                  const subLine = p
                    ? `${p.size} • ${p.id}`
                    : hasCloudOverride
                      ? "Cloudinary"
                      : "—";
                  return (
                    <div
                      key={idx}
                      className={[
                        "rounded-xl border p-3",
                        isActive
                          ? "border-zinc-900 bg-zinc-50"
                          : "border-zinc-200 bg-white",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-start gap-1.5">
                          <div className="flex shrink-0 flex-col gap-0.5 pt-0.5">
                            <button
                              type="button"
                              onClick={() => moveSlot(idx, -1)}
                              disabled={idx === 0}
                              title="Yukarı taşı"
                              aria-label="Yukarı taşı"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 disabled:border-zinc-100 disabled:bg-zinc-50 disabled:text-zinc-300"
                            >
                              <ChevronUp
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSlot(idx, 1)}
                              disabled={idx === slots.length - 1}
                              title="Aşağı taşı"
                              aria-label="Aşağı taşı"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 disabled:border-zinc-100 disabled:bg-zinc-50 disabled:text-zinc-300"
                            >
                              <ChevronDown
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                          <button
                            onClick={() => setActiveSlotIndex(idx)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="text-xs font-semibold text-zinc-500">
                              Slot {idx + 1}
                            </div>
                            <div className="truncate text-sm font-semibold text-zinc-900">
                              {titleLine}
                            </div>
                            <div className="truncate text-xs text-zinc-500">
                              {subLine}
                            </div>
                          </button>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => applyPriceToAll(idx)}
                            disabled={!mediaOk || !s.price.trim()}
                            title="Fiyatı tüm dolu slotlara uygula"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 disabled:bg-zinc-50 disabled:text-zinc-300"
                          >
                            <Icon name="copy" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateSlot(idx, { darkText: !slots[idx]?.darkText })
                            }
                            disabled={!mediaOk}
                            title="Koyu Yazı (slot metni ters çevir)"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 disabled:bg-zinc-50 disabled:text-zinc-300"
                          >
                            <Icon name="invert" />
                          </button>
                          <button
                            type="button"
                            onClick={() => clearSlot(idx)}
                            title="Slotu temizle"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                          >
                            <Icon name="trash" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openUploadPickerForSlot(idx)}
                          disabled={uploadingSlotIndex !== null}
                          className="inline-flex min-w-[104px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                        >
                          <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {uploadingSlotIndex === idx ? "Yükleniyor…" : "Yükle"}
                        </button>
                        <button
                          type="button"
                          onClick={() => openLibraryPickerForSlot(idx)}
                          disabled={uploadingSlotIndex !== null}
                          className="inline-flex min-w-[104px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                        >
                          <Images className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Kütüphane
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCloudinaryUiError(null);
                            clearCloudImageForSlot(idx);
                          }}
                          disabled={!hasCloudOverride}
                          title="Özel görseli kaldır (katalog görseline dön)"
                          className="inline-flex min-w-[104px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
                        >
                          <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Sıfırla
                        </button>
                      </div>

                      <div className="mt-3 space-y-2">
                        <label className="space-y-1 block">
                          <div className="text-xs font-semibold text-zinc-600">
                            Ürün Adı (Opsiyonel)
                          </div>
                          <input
                            value={s.customName}
                            onChange={(e) => updateSlot(idx, { customName: e.target.value })}
                            placeholder="Boş bırakırsan otomatik ad kullanılır"
                            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                            disabled={!mediaOk}
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1">
                            <div className="text-xs font-semibold text-zinc-600">
                              Yüzey
                            </div>
                            <select
                              value={s.surface}
                              onChange={(e) =>
                                updateSlot(idx, {
                                  surface: e.target.value as SlotState["surface"],
                                })
                              }
                              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                              disabled={!mediaOk}
                            >
                              <option value="">Boş</option>
                              <option value="FLP">FLP</option>
                              <option value="SEMİ LAPP.">SEMİ LAPP.</option>
                              <option value="MAT">MAT</option>
                            </select>
                          </label>

                          <label className="space-y-1">
                            <div className="text-xs font-semibold text-zinc-600">
                              Sınıf
                            </div>
                            <div className="flex items-center gap-2">
                              <select
                                value={s.grade}
                                onChange={(e) =>
                                  updateSlot(idx, {
                                    grade: e.target.value as SlotState["grade"],
                                  })
                                }
                                className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                disabled={!mediaOk}
                              >
                                <option value="">Boş</option>
                                <option value="1.">1.</option>
                                <option value="END.">END.</option>
                              </select>

                              <label
                                className={[
                                  "inline-flex h-[38px] items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-800",
                                  !mediaOk ? "opacity-50" : "hover:bg-zinc-50",
                                ].join(" ")}
                                title="REC"
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(s.isRec)}
                                  onChange={(e) => updateSlot(idx, { isRec: e.target.checked })}
                                  disabled={!mediaOk}
                                  className="h-4 w-4 accent-zinc-900"
                                />
                                <span className="font-semibold">REC</span>
                              </label>
                            </div>
                          </label>
                        </div>

                        <div className="space-y-2">
                          <label className="space-y-1 block">
                            <div className="text-xs font-semibold text-zinc-600">
                              Görsel oranı (bu slot)
                            </div>
                            <select
                              value={s.imageAspect}
                              onChange={(e) =>
                                updateSlot(idx, {
                                  imageAspect: e.target
                                    .value as SlotState["imageAspect"],
                                })
                              }
                              disabled={!mediaOk}
                              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                            >
                              <option value="">Sayfa ile aynı</option>
                              <option value="square">Kare (1:1)</option>
                              <option value="threeTwo">Yatay (3:2)</option>
                              <option value="video">60×120 (1:2)</option>
                              <option value="oneThree">Dikey 1:3</option>
                              <option value="oneFour">Dikey 1:4</option>
                              <option value="parquet">Parke (1:6)</option>
                            </select>
                          </label>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-semibold text-zinc-600">
                                Görsel genişliği (%)
                              </div>
                              <button
                                type="button"
                                onClick={() => applyImageScaleToAll(idx)}
                                disabled={!mediaOk}
                                title="Bu genişliği tüm dolu slotlara uygula"
                                className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:bg-zinc-50 disabled:text-zinc-300"
                              >
                                Tümüne uygula
                              </button>
                            </div>
                            <input
                              value={s.imageScale}
                              onChange={(e) =>
                                updateSlot(idx, {
                                  imageScale: digitsOnly(e.target.value).slice(0, 3),
                                })
                              }
                              placeholder={`otomatik (${autoImageScale(
                                sizeTextForSlot(
                                  s.productId != null
                                    ? productsById.get(s.productId)
                                    : undefined,
                                ),
                              )})`}
                              inputMode="numeric"
                              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                              disabled={!mediaOk}
                            />
                          </div>

                          <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-2">
                            <label className="flex items-center gap-2 text-xs text-zinc-700">
                              <input
                                type="checkbox"
                                checked={Boolean(s.hideStockPrice)}
                                onChange={(e) =>
                                  updateSlot(idx, {
                                    hideStockPrice: e.target.checked,
                                  })
                                }
                                disabled={!mediaOk}
                                className="h-4 w-4 accent-zinc-900"
                              />
                              <span className="font-semibold">
                                Stok/fiyat yerine yazı
                              </span>
                            </label>

                            {s.hideStockPrice ? (
                              <textarea
                                value={s.noteText}
                                onChange={(e) =>
                                  updateSlot(idx, { noteText: e.target.value })
                                }
                                placeholder={"örn. 5 palet 40x120 alana\n1 palet 10x20 hediye"}
                                rows={2}
                                className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                disabled={!mediaOk}
                              />
                            ) : null}

                            {s.hideStockPrice ? (
                              <div className="grid grid-cols-2 gap-2">
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    Yazı boyutu (%)
                                  </div>
                                  <input
                                    value={s.noteScale}
                                    onChange={(e) =>
                                      updateSlot(idx, {
                                        noteScale: digitsOnly(
                                          e.target.value,
                                        ).slice(0, 3),
                                      })
                                    }
                                    placeholder="120"
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>
                                <label className="col-span-2 space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    Simge
                                  </div>
                                  <select
                                    value={s.noteIcon}
                                    onChange={(e) =>
                                      updateSlot(idx, {
                                        noteIcon: e.target
                                          .value as SlotState["noteIcon"],
                                      })
                                    }
                                    disabled={!mediaOk}
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                  >
                                    <option value="gift">Hediye kutusu</option>
                                    <option value="star">Yıldız</option>
                                    <option value="percent">Yüzde</option>
                                    <option value="tag">Etiket</option>
                                    <option value="">Simge yok</option>
                                  </select>
                                </label>
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    Zemin rengi
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="color"
                                      value={
                                        /^#[0-9a-fA-F]{6}$/.test(s.noteColor)
                                          ? s.noteColor
                                          : NOTE_DEFAULT_FILL
                                      }
                                      onChange={(e) =>
                                        updateSlot(idx, {
                                          noteColor: e.target.value.toUpperCase(),
                                        })
                                      }
                                      disabled={!mediaOk}
                                      className="h-[38px] w-10 shrink-0 cursor-pointer rounded-lg border border-zinc-200 bg-white"
                                      aria-label="Kampanya yazısı rengi"
                                    />
                                    <input
                                      value={s.noteColor}
                                      onChange={(e) =>
                                        updateSlot(idx, {
                                          noteColor: e.target.value,
                                        })
                                      }
                                      placeholder={NOTE_DEFAULT_FILL}
                                      className="w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm outline-none focus:border-zinc-400"
                                      disabled={!mediaOk}
                                    />
                                  </div>
                                </label>
                              </div>
                            ) : null}
                          </div>

                          <label className="flex items-center gap-2 text-xs text-zinc-700">
                            <input
                              type="checkbox"
                              checked={s.dualStock}
                              onChange={(e) =>
                                updateSlot(idx, { dualStock: e.target.checked })
                              }
                              disabled={!mediaOk}
                              className="h-4 w-4 accent-zinc-900"
                            />
                            <span className="font-semibold">
                              Çift stok (1. + END)
                            </span>
                          </label>

                          {!s.dualStock ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    Stok
                                  </div>
                                  <input
                                    value={s.stock}
                                    onChange={(e) =>
                                      updateSlot(idx, { stock: e.target.value })
                                    }
                                    placeholder="örn. 51.2"
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>

                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    {s.dualPrice
                                      ? `${s.priceLabel?.trim() || "Vadeli"} fiyatı`
                                      : "Fiyat"}
                                  </div>
                                  <input
                                    value={s.price}
                                    onChange={(e) =>
                                      updateSlot(idx, {
                                        price: formatThousandsWithDot(
                                          digitsOnly(e.target.value),
                                        ),
                                      })
                                    }
                                    placeholder="örn. 1.250"
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>
                              </div>

                              <label className="flex items-center gap-2 text-xs text-zinc-700">
                                <input
                                  type="checkbox"
                                  checked={Boolean(s.dualPrice)}
                                  onChange={(e) =>
                                    updateSlot(idx, { dualPrice: e.target.checked })
                                  }
                                  disabled={!mediaOk}
                                  className="h-4 w-4 accent-zinc-900"
                                />
                                <span className="font-semibold">
                                  Çift fiyat (Vadeli + Kart)
                                </span>
                              </label>

                              {s.dualPrice ? (
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="space-y-1">
                                    <div className="text-xs font-semibold text-zinc-600">
                                      1. fiyat etiketi
                                    </div>
                                    <input
                                      value={s.priceLabel}
                                      onChange={(e) =>
                                        updateSlot(idx, {
                                          priceLabel: e.target.value,
                                        })
                                      }
                                      placeholder="Vadeli"
                                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                      disabled={!mediaOk}
                                    />
                                  </label>
                                  <label className="space-y-1">
                                    <div className="text-xs font-semibold text-zinc-600">
                                      2. fiyat etiketi
                                    </div>
                                    <input
                                      value={s.secondPriceLabel}
                                      onChange={(e) =>
                                        updateSlot(idx, {
                                          secondPriceLabel: e.target.value,
                                        })
                                      }
                                      placeholder="Kart"
                                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                      disabled={!mediaOk}
                                    />
                                  </label>
                                  <label className="col-span-2 space-y-1">
                                    <div className="text-xs font-semibold text-zinc-600">
                                      {s.secondPriceLabel?.trim() || "Kart"} fiyatı
                                    </div>
                                    <input
                                      value={s.secondPrice}
                                      onChange={(e) =>
                                        updateSlot(idx, {
                                          secondPrice: formatThousandsWithDot(
                                            digitsOnly(e.target.value),
                                          ),
                                        })
                                      }
                                      placeholder="örn. 220"
                                      inputMode="numeric"
                                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                      disabled={!mediaOk}
                                    />
                                  </label>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    1. stok etiketi
                                  </div>
                                  <input
                                    value={s.primaryStockLabel}
                                    onChange={(e) =>
                                      updateSlot(idx, {
                                        primaryStockLabel: e.target.value,
                                      })
                                    }
                                    placeholder="1.Stok"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    END stok etiketi
                                  </div>
                                  <input
                                    value={s.endStockLabel}
                                    onChange={(e) =>
                                      updateSlot(idx, {
                                        endStockLabel: e.target.value,
                                      })
                                    }
                                    placeholder="END.Stok"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    1. stok miktarı
                                  </div>
                                  <input
                                    value={s.stock}
                                    onChange={(e) =>
                                      updateSlot(idx, { stock: e.target.value })
                                    }
                                    placeholder="örn. 279"
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    END stok miktarı
                                  </div>
                                  <input
                                    value={s.endStock}
                                    onChange={(e) =>
                                      updateSlot(idx, { endStock: e.target.value })
                                    }
                                    placeholder="örn. 48"
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    1. stok fiyatı
                                  </div>
                                  <input
                                    value={s.price}
                                    onChange={(e) =>
                                      updateSlot(idx, {
                                        price: formatThousandsWithDot(
                                          digitsOnly(e.target.value),
                                        ),
                                      })
                                    }
                                    placeholder="örn. 230"
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>
                                <label className="space-y-1">
                                  <div className="text-xs font-semibold text-zinc-600">
                                    END stok fiyatı
                                  </div>
                                  <input
                                    value={s.endStockPrice}
                                    onChange={(e) =>
                                      updateSlot(idx, {
                                        endStockPrice: formatThousandsWithDot(
                                          digitsOnly(e.target.value),
                                        ),
                                      })
                                    }
                                    placeholder="örn. 230"
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                                    disabled={!mediaOk}
                                  />
                                </label>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>

        {isUploadLibraryOpen && libraryPickerSlotIndex !== null ? (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-library-title"
            onClick={closeUploadLibraryModal}
          >
            <div
              className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                <div>
                  <div
                    id="upload-library-title"
                    className="text-sm font-semibold text-zinc-900"
                  >
                    Kütüphaneden seç
                  </div>
                  <div className="text-xs text-zinc-500">
                    Slot {libraryPickerSlotIndex + 1} • Cloudinary
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshUploadLibrary()}
                    disabled={isLoadingUploadLibrary}
                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Yenile
                  </button>
                  <button
                    type="button"
                    onClick={closeUploadLibraryModal}
                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                  >
                    Kapat
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2 border-b border-zinc-100 px-4 py-2.5 sm:flex-row sm:items-center">
                <select
                  value={librarySelectedFolder}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLibrarySelectedFolder(v);
                    setLibrarySearch("");
                    void refreshUploadLibrary(v);
                  }}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 outline-none focus:border-zinc-400 sm:w-52"
                  aria-label="Klasör"
                >
                  {(libraryFolders.some(
                    (f) => f.path === librarySelectedFolder,
                  )
                    ? libraryFolders
                    : [
                        {
                          name: librarySelectedFolder,
                          path: librarySelectedFolder,
                        },
                        ...libraryFolders,
                      ]
                  ).map((f) => (
                    <option key={f.path} value={f.path}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <input
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Görsel adı ara…"
                  className="w-full flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-zinc-400"
                  aria-label="Kütüphanede ara"
                />
              </div>
              {uploadLibraryError ? (
                <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">
                  {uploadLibraryError}
                </div>
              ) : null}
              <div className="min-h-[200px] flex-1 overflow-y-auto p-3">
                {isLoadingUploadLibrary && uploadLibraryItems.length === 0 ? (
                  <div className="px-2 py-8 text-center text-sm text-zinc-500">
                    Yükleniyor…
                  </div>
                ) : uploadLibraryItems.length === 0 ? (
                  <div className="px-2 py-8 text-center text-sm text-zinc-500">
                    Bu klasörde görsel yok. Başka klasör seçin ya da bu slota
                    &quot;Yükle&quot; ile görsel gönderin.
                  </div>
                ) : libraryModalItems.length === 0 ? (
                  <div className="px-2 py-8 text-center text-sm text-zinc-500">
                    &quot;{librarySearch}&quot; ile eşleşen görsel yok.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {libraryModalItems.map((item) => (
                      <button
                        key={item.publicId}
                        type="button"
                        onClick={() => {
                          setCloudinaryUiError(null);
                          applyUploadedImageToSlot(libraryPickerSlotIndex, {
                            publicId: item.publicId,
                            url: item.url,
                            originalFilename: item.originalFilename,
                            displayName: item.displayName,
                          });
                          closeUploadLibraryModal();
                        }}
                        className="group overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 text-left transition hover:border-zinc-400 hover:bg-white"
                      >
                        <div className="aspect-square w-full overflow-hidden bg-zinc-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="line-clamp-2 px-2 py-1.5 text-[10px] font-medium text-zinc-700 group-hover:text-zinc-900">
                          {cloudItemLabel(item)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {isSellModalOpen ? (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setIsSellModalOpen(false)}
          >
            <div
              className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    Afişten satış kaydet
                  </div>
                  <div className="text-xs text-zinc-500">
                    Satılan ürünleri seçin, miktarı (m²) gerekirse düzeltin. Kısmi
                    satışlarda miktarı azaltmanız yeterli.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSellModalOpen(false)}
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                >
                  Kapat
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-b border-zinc-100 px-4 py-2.5">
                <label className="text-xs font-semibold text-zinc-600">
                  Tarih
                  <input
                    type="date"
                    value={sellDate}
                    onChange={(e) => setSellDate(e.target.value)}
                    className="mt-1 block rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
                  />
                </label>
                <label className="flex-1 text-xs font-semibold text-zinc-600">
                  Müşteri (opsiyonel)
                  <input
                    value={sellCustomer}
                    onChange={(e) => setSellCustomer(e.target.value)}
                    placeholder="örn. Ahmet Yılmaz"
                    className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400"
                  />
                </label>
              </div>

              <div className="min-h-[120px] flex-1 overflow-y-auto p-3">
                <div className="flex flex-col gap-2">
                  {sellRows.map((r) => {
                    const lineTotal =
                      parseTrNumber(r.quantity) * parseTrNumber(r.unitPrice);
                    return (
                      <div
                        key={r.rowKey}
                        className={[
                          "rounded-xl border p-2.5",
                          r.selected
                            ? "border-emerald-300 bg-emerald-50/40"
                            : "border-zinc-200 bg-zinc-50",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={r.selected}
                            onChange={(e) =>
                              updateSellRow(r.rowKey, {
                                selected: e.target.checked,
                              })
                            }
                            className="mt-1 h-4 w-4"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-semibold text-zinc-900">
                              {r.productName}
                            </div>
                            <div className="text-[11px] text-zinc-500">
                              {[r.brand, r.size].filter(Boolean).join(" • ")}
                            </div>
                            <div className="mt-2 flex flex-wrap items-end gap-2">
                              <label className="text-[11px] font-semibold text-zinc-600">
                                Miktar (m²)
                                <input
                                  inputMode="decimal"
                                  value={r.quantity}
                                  onChange={(e) =>
                                    updateSellRow(r.rowKey, {
                                      quantity: e.target.value,
                                    })
                                  }
                                  className="mt-0.5 block w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm outline-none focus:border-zinc-400"
                                />
                              </label>
                              <label className="text-[11px] font-semibold text-zinc-600">
                                Birim Fiyat (₺)
                                <input
                                  inputMode="decimal"
                                  value={r.unitPrice}
                                  onChange={(e) =>
                                    updateSellRow(r.rowKey, {
                                      unitPrice: e.target.value,
                                    })
                                  }
                                  className="mt-0.5 block w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm outline-none focus:border-zinc-400"
                                />
                              </label>
                              <div className="text-[11px] font-semibold text-zinc-600">
                                Satır Toplam
                                <div className="mt-0.5 rounded-lg bg-white px-2 py-1 text-sm font-bold text-zinc-900 ring-1 ring-zinc-200">
                                  {lineTotal.toLocaleString("tr-TR", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  ₺
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3">
                <div className="text-xs text-zinc-600">
                  Seçili:{" "}
                  <span className="font-bold text-zinc-900">
                    {sellRows.filter((r) => r.selected).length}
                  </span>{" "}
                  ürün • Toplam:{" "}
                  <span className="font-bold text-emerald-700">
                    {sellRows
                      .filter((r) => r.selected)
                      .reduce(
                        (acc, r) =>
                          acc +
                          parseTrNumber(r.quantity) * parseTrNumber(r.unitPrice),
                        0,
                      )
                      .toLocaleString("tr-TR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                    ₺
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void saveSelectedSales()}
                  disabled={isRecordingSale}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isRecordingSale ? "Kaydediliyor…" : "Seçilenleri kaydet"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isSavedOpen ? (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setIsSavedOpen(false)}
          >
            <div
              className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    Kayıtlı Afişler
                  </div>
                  <div className="text-xs text-zinc-500">
                    Kayıtlı kataloglar (tüm sayfalar). Ürün ismiyle arayın, açmak için tıklayın.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshSavedDrafts()}
                    disabled={savedLoading}
                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Yenile
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSavedOpen(false)}
                    className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                  >
                    Kapat
                  </button>
                </div>
              </div>

              <div className="border-b border-zinc-100 px-4 py-2.5">
                <input
                  value={savedSearch}
                  onChange={(e) => setSavedSearch(e.target.value)}
                  placeholder="Ürün adı, başlık, marka ara…"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400"
                  aria-label="Kayıtlı afişlerde ara"
                />
              </div>

              {savedError ? (
                <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">
                  {savedError}
                </div>
              ) : null}

              <div className="min-h-[160px] flex-1 overflow-y-auto p-3">
                {(() => {
                  const q = savedSearch.trim().toLowerCase();
                  const list = q
                    ? savedItems.filter((d) => {
                        const hay = `${d.title} ${d.manufacturer} ${d.size} ${d.productNames.join(" ")}`.toLowerCase();
                        return hay.includes(q);
                      })
                    : savedItems;
                  if (savedLoading && savedItems.length === 0) {
                    return (
                      <div className="px-2 py-8 text-center text-sm text-zinc-500">
                        Yükleniyor…
                      </div>
                    );
                  }
                  if (savedItems.length === 0) {
                    return (
                      <div className="px-2 py-8 text-center text-sm text-zinc-500">
                        Henüz kayıtlı afiş yok. &quot;Studio&apos;ya Kaydet&quot;
                        ile kaydedin.
                      </div>
                    );
                  }
                  if (list.length === 0) {
                    return (
                      <div className="px-2 py-8 text-center text-sm text-zinc-500">
                        &quot;{savedSearch}&quot; ile eşleşen afiş yok.
                      </div>
                    );
                  }
                  return (
                    <div className="flex flex-col gap-2">
                      {list.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3 hover:border-zinc-300"
                        >
                          <button
                            type="button"
                            onClick={() => void openSavedCatalog(d.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="truncate text-sm font-semibold text-zinc-900">
                              {d.title || "Afiş"}
                            </div>
                            <div className="mt-0.5 text-[11px] text-zinc-500">
                              {`${d.pageCount ?? 1} sayfa`}
                              {[d.size, d.manufacturer].filter(Boolean).length
                                ? ` • ${[d.size, d.manufacturer].filter(Boolean).join(" • ")}`
                                : ""}
                              {d.savedAt
                                ? ` • ${new Date(d.savedAt).toLocaleString("tr-TR")}`
                                : ""}
                            </div>
                            {d.productNames.length ? (
                              <div className="mt-1 line-clamp-2 text-[11px] text-zinc-600">
                                {d.productNames.join(", ")}
                              </div>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteSavedDraft(d.id)}
                            className="shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:border-red-300 hover:text-red-600"
                          >
                            Sil
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : null}
      </aside>

      <main className="flex-1 bg-zinc-100">
        <div className="h-[100svh] p-6">
          <div
            ref={workspaceRef}
            className="relative h-full w-full overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200"
          >
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `translate(-50%, -50%) scale(${studioScale})`,
                transformOrigin: "center",
              }}
            >
              <div className="rounded-3xl bg-white p-3 ring-1 ring-zinc-200">
                <div className="mb-3 flex items-center justify-between gap-3 px-2">
                  <div className="text-xs font-semibold text-zinc-600">
                    Studio Scale:{" "}
                    <span className="font-bold text-zinc-900">
                      {Math.round(studioScale * 100)}%
                    </span>{" "}
                    • {CANVAS_W}×{CANVAS_H}
                  </div>
                  <div className="text-xs font-semibold text-zinc-500">
                    Şablon {selectedTemplate} • Slot {activeSlotIndex + 1}
                  </div>
                </div>

                <div
                  className="rounded-2xl bg-white overflow-hidden ring-1 ring-zinc-200"
                  style={{ width: CANVAS_W, height: CANVAS_H }}
                >
                  <div
                    ref={exportCanvasRef}
                    className={[
                      "h-full w-full flex flex-col",
                      isThreeVertical ? "h-screen overflow-hidden" : "",
                      isDarkBg ? "text-white" : "text-black",
                    ].join(" ")}
                    style={{ width: CANVAS_W, height: CANVAS_H, background: canvasBg }}
                  >
                      <header className={["shrink-0", canvasTextColorClass].join(" ")}>
                        <div className="px-14 pt-12">
                          <div className="flex items-start justify-between gap-12">
                            <div className="flex flex-col items-center gap-6">
                              <div className="shrink-0 pt-1">
                                <div className="relative min-h-[150px] w-[420px] shrink-0 overflow-hidden">
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <img
                                      src={selectedLogoSrc}
                                      alt="KULALILAR"
                                      className="block w-auto object-contain"
                                      style={{
                                        height: `${BASE_LOGO_HEIGHT_PX}px`,
                                        transform: `scale(${FIXED_LOGO_SCALE})`,
                                        transformOrigin: "center",
                                        filter: logoFilter,
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>

                              <div
                                className={[
                                  "rounded-none font-montserrat font-bold tracking-wide text-center flex items-center justify-center",
                                ].join(" ")}
                                style={{
                                  borderStyle: "solid",
                                  borderWidth: `${FIXED_HEADER_BORDER_WIDTH}px`,
                                  borderColor: canvasTextColor,
                                  color: canvasTextColor,
                                  paddingLeft: `${headerBoxPx}px`,
                                  paddingRight: `${headerBoxPx}px`,
                                  paddingTop: `${headerBoxPy}px`,
                                  paddingBottom: `${headerBoxPy}px`,
                                  fontSize: `${FIXED_HEADER_FONT_SIZE}px`,
                                  lineHeight: 1.05,
                                }}
                              >
                                {(selectedTemplateSize || " ").toUpperCase()}
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-6">
                              <div
                                className={[
                                  "shrink-0 rounded-none font-montserrat font-bold tracking-wide text-center flex items-center justify-center",
                                ].join(" ")}
                                style={{
                                  borderStyle: "solid",
                                  borderWidth: `${FIXED_HEADER_BORDER_WIDTH}px`,
                                  borderColor: canvasTextColor,
                                  color: canvasTextColor,
                                  paddingLeft: `${headerBoxPx}px`,
                                  paddingRight: `${headerBoxPx}px`,
                                  paddingTop: `${headerBoxPy}px`,
                                  paddingBottom: `${headerBoxPy}px`,
                                  fontSize: `${FIXED_HEADER_FONT_SIZE}px`,
                                  lineHeight: 1.05,
                                }}
                              >
                                {headerRightText || " "}
                              </div>

                              <div
                                className={[
                                  "font-montserrat font-bold tracking-wide text-right",
                                ].join(" ")}
                                style={{
                                  color: canvasTextColor,
                                  fontSize: `${FIXED_HEADER_FONT_SIZE}px`,
                                  lineHeight: 1.05,
                                }}
                              >
                                {selectedManufacturer || " "}
                              </div>
                            </div>
                          </div>
                        </div>
                      </header>

                      <section
                        className={[
                          "flex-1 pb-12",
                          selectedTemplate === 8 ? "px-6" : "px-12",
                        ].join(" ")}
                        style={{ backgroundColor: productBgColor }}
                      >
                        <div
                          className={`h-full flex flex-col ${
                            isSixOrEightSquare
                              ? isEightSquare
                                ? "justify-start pt-[20px]"
                                : "justify-start pt-[20px]"
                              : "justify-center"
                          }`}
                        >
                        {isParquetMode && (
                          <div
                            className={[
                              "w-full",
                              "h-full flex flex-col justify-center",
                            ].join(" ")}
                            style={{
                              transform: `scale(${parquetStackScale})`,
                              transformOrigin:
                                isParquetFour || isParquetSix || isParquetThree || isParquetFive
                                  ? "center"
                                  : "center",
                            }}
                          >
                            <div
                              className={[
                                "flex flex-col",
                                isParquetThree
                                  ? "gap-16"
                                  : isParquetFour
                                    ? "gap-16"
                                    : isParquetFive
                                      ? "gap-12"
                                      : "gap-2",
                              ].join(" ")}
                              style={
                                isParquetSix && parquetSixGap
                                  ? ({ rowGap: parquetSixGap } as React.CSSProperties)
                                  : undefined
                              }
                            >
                              {Array.from({ length: selectedTemplate }, (_, idx) => {
                                const slot = slots[idx];
                                const p =
                                  slot?.productId != null
                                    ? productsById.get(slot.productId)
                                    : undefined;
                                const hasImageError = Boolean(imageErrorBySlot[idx]);
                                const stockPriceFontSize = Math.max(
                                  14,
                                  Math.round(globalFontSize * 0.9),
                                );
                                const aspectClass = frameAspectClass(
                                  aspectForSlot(productImageAspect, slot),
                                  slot,
                                  sizeTextForSlot(p),
                                );

                                return (
                                  <div
                                    key={idx}
                                    className="flex flex-col items-stretch overflow-hidden"
                                    style={{ background: canvasBg }}
                                  >
                                    <div
                                      className={[
                                        "w-full overflow-hidden",
                                        aspectClass,
                                      ].join(" ")}
                                      style={
                                        isParquetSix
                                          ? ({ height: `${parquetSixImageHeightPx}px` } as React.CSSProperties)
                                          : undefined
                                      }
                                    >
                                      <div
                                        className="h-full w-full"
                                        style={
                                          isParquetFive
                                            ? ({
                                                transform: `scale(${parquetFiveImageScale})`,
                                                transformOrigin: "center",
                                              } as React.CSSProperties)
                                            : undefined
                                        }
                                      >
                                      <SlotImage
                                        src={imageSrcForSlot(p, slot)}
                                        alt={displayNameForSlot(p, slot)}
                                        slot={slot}
                                        sizeText={sizeTextForSlot(p)}
                                        frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                        hasError={hasImageError}
                                        onError={() => markSlotImageError(idx)}
                                        onLoad={() => clearSlotImageError(idx)}
                                      />
                                      </div>
                                    </div>

                                    <div
                                      className={[
                                        isParquetThree
                                          ? "mt-4 px-2 pt-0 pb-0 flex flex-col items-center justify-start"
                                          : isParquetFour
                                            ? "mt-4 px-2 pt-0 pb-0 flex flex-col items-center justify-start"
                                            : isParquetFive
                                              ? "mt-1 px-2 pt-0 pb-0 flex flex-col items-center justify-start"
                                              : "mt-0.5 px-2 pt-0 pb-0 flex flex-col items-center justify-start",
                                        productDetailsTextColorClass,
                                      ].join(" ")}
                                    >
                                      <div
                                        className="font-semibold leading-tight tracking-wide text-center uppercase"
                                        style={{ fontSize: globalFontSize }}
                                      >
                                        {displayNameForSlot(p, slot)}
                                      </div>
                                      <SlotStockPriceDisplay
                                        slot={slot}
                                        unitName={unitName}
                                        fontSize={stockPriceFontSize}
                                        stockLineClassName="font-bold leading-snug text-center"
                                        priceLineClassName="font-bold leading-snug text-center"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!isParquetMode && (
                          <>
                        {selectedTemplate === 3 && productImageAspect === "square" ? (
                          (() => {
                            const stockPriceFontSize = Math.max(
                              14,
                              Math.round(globalFontSize * 0.9),
                            );
                            const renderThreeSquareTile = (idx: number) => {
                              const slot = slots[idx];
                              const p =
                                slot?.productId != null
                                  ? productsById.get(slot.productId)
                                  : undefined;
                              const hasImageError = Boolean(imageErrorBySlot[idx]);

                              return (
                                <div
                                  className="flex flex-col items-stretch overflow-hidden"
                                  style={{ background: canvasBg }}
                                >
                                  <div className="w-full overflow-hidden aspect-square">
                                    <SlotImage
                                      src={imageSrcForSlot(p, slot)}
                                      alt={displayNameForSlot(p, slot)}
                                      slot={slot}
                                      sizeText={sizeTextForSlot(p)}
                                      frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                      hasError={hasImageError}
                                      onError={() => markSlotImageError(idx)}
                                      onLoad={() => clearSlotImageError(idx)}
                                    />
                                  </div>

                                  <div
                                    className={[
                                      "mt-2 px-3 pt-3 pb-2 flex flex-col items-center justify-start",
                                      productDetailsTextColorClass,
                                    ].join(" ")}
                                  >
                                    <div
                                      className="font-semibold leading-tight tracking-wide text-center uppercase"
                                      style={{ fontSize: globalFontSize }}
                                    >
                                      {displayNameForSlot(p, slot)}
                                    </div>
                                    <SlotStockPriceDisplay
                                      slot={slot}
                                      unitName={unitName}
                                      fontSize={stockPriceFontSize}
                                      stockLineClassName={"mt-2 font-bold leading-snug text-center"}
                                      priceLineClassName={"mt-1 font-bold leading-snug text-center"}
                                    />
                                  </div>
                                </div>
                              );
                            };

                            // Kare + Üçlü: 4'lü şablondaki gibi büyük görsel; üstte 2, altta 1 ürün ortalanmış.
                            return (
                              <div className="h-full flex items-center justify-center">
                                <div className="w-full max-w-[980px]">
                                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                    <div key={0}>{renderThreeSquareTile(0)}</div>
                                    <div key={1}>{renderThreeSquareTile(1)}</div>
                                  </div>
                                  <div className="mt-3 flex justify-center">
                                    <div className="w-[calc(50%-12px)]">
                                      {renderThreeSquareTile(2)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        ) : (selectedTemplate === 3 &&
                            (productImageAspect === "oneThree" ||
                              productImageAspect === "oneFour")) ||
                          ((selectedTemplate === 4 || selectedTemplate === 5) &&
                            productImageAspect === "oneFour") ? (
                          // Küçük ebatlar (1:4) ince olduğu için 4'lü ve 5'li de
                          // iki sütun yerine tek sütunda alt alta sığıyor.
                          <div className="h-full w-full flex items-center justify-center overflow-hidden">
                            <div
                              className={[
                                "w-full flex flex-col items-center justify-center py-10",
                                selectedTemplate >= 5
                                  ? "gap-y-5"
                                  : selectedTemplate === 4
                                    ? "gap-y-8"
                                    : "gap-y-12",
                              ].join(" ")}
                            >
                              {Array.from({ length: selectedTemplate }, (_, i) => i).map((idx) => {
                                const slot = slots[idx];
                                const p =
                                  slot?.productId != null
                                    ? productsById.get(slot.productId)
                                    : undefined;
                                const hasImageError = Boolean(imageErrorBySlot[idx]);
                                const stockPriceFontSize = Math.max(
                                  14,
                                  Math.round(globalFontSize * 0.9),
                                );
                                const aspectClass = frameAspectClass(
                                  aspectForSlot(productImageAspect, slot),
                                  slot,
                                  sizeTextForSlot(p),
                                );

                                return (
                                  <div
                                    key={idx}
                                    className="w-full flex flex-col items-center"
                                    style={{ background: canvasBg }}
                                  >
                                    <div className="w-full max-w-[860px] overflow-hidden flex items-center justify-center">
                                      <div
                                        className={[
                                          "w-full overflow-hidden",
                                          aspectClass,
                                        ].join(" ")}
                                      >
                                        <SlotImage
                                          src={imageSrcForSlot(p, slot)}
                                          alt={displayNameForSlot(p, slot)}
                                          slot={slot}
                                          sizeText={sizeTextForSlot(p)}
                                          frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                          hasError={hasImageError}
                                          onError={() => markSlotImageError(idx)}
                                          onLoad={() => clearSlotImageError(idx)}
                                        />
                                      </div>
                                    </div>

                                    <div
                                      className={[
                                        "px-2 pt-3 pb-0 flex flex-col items-center gap-y-1",
                                        productDetailsTextColorClass,
                                      ].join(" ")}
                                    >
                                      <div
                                        className="font-semibold leading-tight tracking-wide text-center uppercase"
                                        style={{ fontSize: globalFontSize }}
                                      >
                                        {displayNameForSlot(p, slot)}
                                      </div>
                                      <SlotStockPriceDisplay
                                        slot={slot}
                                        unitName={unitName}
                                        fontSize={stockPriceFontSize}
                                        stockLineClassName={"font-bold leading-tight text-center"}
                                        priceLineClassName={"font-bold leading-tight text-center"}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : selectedTemplate === 3 && productImageAspect === "video" ? (
                          <div className="h-full w-full flex items-start justify-center overflow-hidden">
                            <div className="w-full h-full flex flex-col overflow-hidden pt-4 pb-8">
                              <div
                                className="w-full"
                                style={{ transform: "scale(0.86)", transformOrigin: "top center" }}
                              >
                              <div className="grid grid-rows-3 h-full overflow-hidden gap-y-7">
                                {[0, 1, 2].map((idx) => {
                                  const slot = slots[idx];
                                  const p =
                                    slot?.productId != null
                                      ? productsById.get(slot.productId)
                                      : undefined;
                                  const hasImageError = Boolean(imageErrorBySlot[idx]);
                                  const stockPriceFontSize = Math.max(
                                    14,
                                    Math.round(globalFontSize * 0.9),
                                  );
                                  const aspectClass = frameAspectClass(
                                    aspectForSlot(productImageAspect, slot),
                                    slot,
                                    sizeTextForSlot(p),
                                  );

                                  return (
                                    <div
                                      key={idx}
                                      className="flex flex-col items-center justify-center min-h-0 overflow-hidden"
                                      style={{ background: canvasBg }}
                                    >
                                      <div
                                        className={[
                                          "w-full max-w-[860px] overflow-hidden flex items-center justify-center",
                                        ].join(" ")}
                                      >
                                        <div
                                          className={[
                                            "w-full overflow-hidden",
                                            aspectClass,
                                          ].join(" ")}
                                        >
                                          <SlotImage
                                            src={imageSrcForSlot(p, slot)}
                                            alt={displayNameForSlot(p, slot)}
                                            slot={slot}
                                            sizeText={sizeTextForSlot(p)}
                                            frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                            hasError={hasImageError}
                                            onError={() => markSlotImageError(idx)}
                                            onLoad={() => clearSlotImageError(idx)}
                                          />
                                        </div>
                                      </div>

                                      <div
                                        className={[
                                          "px-2 pt-3 pb-0 flex flex-col items-center gap-y-1",
                                          productDetailsTextColorClass,
                                        ].join(" ")}
                                      >
                                        <div
                                          className="font-semibold leading-tight tracking-wide text-center uppercase"
                                          style={{ fontSize: globalFontSize }}
                                        >
                                          {displayNameForSlot(p, slot)}
                                        </div>
                                        <SlotStockPriceDisplay
                                          slot={slot}
                                          unitName={unitName}
                                          fontSize={stockPriceFontSize}
                                          stockLineClassName={"font-bold leading-tight text-center"}
                                          priceLineClassName={"font-bold leading-tight text-center"}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              </div>
                            </div>
                          </div>
                        ) : selectedTemplate === 1 ? (
                          <div className="h-full flex flex-col items-center justify-center">
                            {(() => {
                              const idx = 0;
                              const slot = slots[idx];
                              const p =
                                slot?.productId != null
                                  ? productsById.get(slot.productId)
                                  : undefined;
                              const hasImageError = Boolean(imageErrorBySlot[idx]);
                              const stockPriceFontSize = Math.max(
                                14,
                                Math.round(globalFontSize * 0.9),
                              );
                              const aspectClass = frameAspectClass(
                                aspectForSlot(productImageAspect, slot),
                                slot,
                                sizeTextForSlot(p),
                              );

                              return (
                                <div
                                  className={[
                                    "w-full flex flex-col items-stretch overflow-hidden",
                                    productImageAspect === "square"
                                      ? "max-w-[560px]"
                                      : "max-w-[860px]",
                                  ].join(" ")}
                                  style={{ background: canvasBg }}
                                >
                                  <div
                                    className={["w-full overflow-hidden", aspectClass].join(
                                      " ",
                                    )}
                                  >
                                    <SlotImage
                                      src={imageSrcForSlot(p, slot)}
                                      alt={displayNameForSlot(p, slot)}
                                      slot={slot}
                                      sizeText={sizeTextForSlot(p)}
                                      frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                      hasError={hasImageError}
                                      onError={() => markSlotImageError(idx)}
                                      onLoad={() => clearSlotImageError(idx)}
                                    />
                                  </div>

                                  <div
                                    className={[
                                      productImageAspect === "square"
                                        ? "mt-7 px-3 pt-3 pb-2 flex flex-col items-center justify-start"
                                        : "mt-8 px-3 pt-3 pb-2 flex flex-col items-center justify-start",
                                        productDetailsTextColorClass,
                                    ].join(" ")}
                                  >
                                    <div
                                      className="font-semibold leading-tight tracking-wide text-center uppercase"
                                      style={{ fontSize: globalFontSize }}
                                    >
                                      {displayNameForSlot(p, slot)}
                                    </div>
                                    <SlotStockPriceDisplay
                                      slot={slot}
                                      unitName={unitName}
                                      fontSize={stockPriceFontSize}
                                      stockLineClassName={"mt-3 font-bold leading-snug text-center"}
                                      priceLineClassName={"mt-1 font-bold leading-snug text-center"}
                                    />
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ) : selectedTemplate === 2 ? (
                          <div
                            className={[
                              "h-full flex flex-col items-center justify-center",
                              productImageAspect === "square"
                                ? "gap-20 py-12"
                                : "gap-12",
                            ].join(" ")}
                          >
                            {[0, 1].map((idx) => {
                              const slot = slots[idx];
                              const p =
                                slot?.productId != null
                                  ? productsById.get(slot.productId)
                                  : undefined;
                              const hasImageError = Boolean(imageErrorBySlot[idx]);
                              const stockPriceFontSize = Math.max(
                                14,
                                Math.round(globalFontSize * 0.9),
                              );
                              const aspectClass = frameAspectClass(
                                aspectForSlot(productImageAspect, slot),
                                slot,
                                sizeTextForSlot(p),
                              );

                              return (
                                <div
                                  key={idx}
                                  className={[
                                    "w-full flex flex-col items-stretch overflow-hidden",
                                    productImageAspect === "square"
                                      ? "max-w-[480px]"
                                      : "max-w-[780px]",
                                  ].join(" ")}
                                  style={{ background: canvasBg }}
                                >
                                  <div
                                    className={["w-full overflow-hidden", aspectClass].join(
                                      " ",
                                    )}
                                  >
                                    <SlotImage
                                      src={imageSrcForSlot(p, slot)}
                                      alt={displayNameForSlot(p, slot)}
                                      slot={slot}
                                      sizeText={sizeTextForSlot(p)}
                                      frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                      hasError={hasImageError}
                                      onError={() => markSlotImageError(idx)}
                                      onLoad={() => clearSlotImageError(idx)}
                                    />
                                  </div>

                                  <div
                                    className={[
                                      productImageAspect === "square"
                                        ? "mt-4 px-3 pt-3 pb-2 flex flex-col items-center justify-start"
                                        : "mt-6 px-3 pt-3 pb-2 flex flex-col items-center justify-start",
                                      productDetailsTextColorClass,
                                    ].join(" ")}
                                  >
                                    <div
                                      className="font-semibold leading-tight tracking-wide text-center uppercase"
                                      style={{ fontSize: globalFontSize }}
                                    >
                                      {displayNameForSlot(p, slot)}
                                    </div>
                                    <SlotStockPriceDisplay
                                      slot={slot}
                                      unitName={unitName}
                                      fontSize={stockPriceFontSize}
                                      stockLineClassName={"mt-3 font-bold leading-snug text-center"}
                                      priceLineClassName={"mt-1 font-bold leading-snug text-center"}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : selectedTemplate === 4 ? (
                          <div className="h-full flex items-center justify-center">
                            <div className="w-full max-w-[980px]">
                              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                                {Array.from({ length: selectedTemplate }, (_, idx) => {
                                  const slot = slots[idx];
                                  const p =
                                    slot?.productId != null
                                      ? productsById.get(slot.productId)
                                      : undefined;
                                  const hasImageError = Boolean(imageErrorBySlot[idx]);
                                  const stockPriceFontSize = Math.max(
                                    14,
                                    Math.round(globalFontSize * 0.9),
                                  );
                                  const aspectClass = frameAspectClass(
                                    aspectForSlot(productImageAspect, slot),
                                    slot,
                                    sizeTextForSlot(p),
                                  );

                                  return (
                                    <div
                                      key={idx}
                                      className="flex flex-col items-stretch overflow-hidden"
                                      style={{ background: canvasBg }}
                                    >
                                      <div
                                        className={[
                                          "w-full overflow-hidden",
                                          aspectClass,
                                        ].join(" ")}
                                      >
                                        <SlotImage
                                          src={imageSrcForSlot(p, slot)}
                                          alt={displayNameForSlot(p, slot)}
                                          slot={slot}
                                          sizeText={sizeTextForSlot(p)}
                                          frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                          hasError={hasImageError}
                                          onError={() => markSlotImageError(idx)}
                                          onLoad={() => clearSlotImageError(idx)}
                                        />
                                      </div>

                                      <div
                                        className={[
                                          productImageAspect === "square"
                                            ? "mt-2 px-3 pt-3 pb-2 flex flex-col items-center justify-start"
                                            : "mt-3 px-3 pt-3 pb-2 flex flex-col items-center justify-start",
                                          productDetailsTextColorClass,
                                        ].join(" ")}
                                      >
                                        <div
                                          className="font-semibold leading-tight tracking-wide text-center uppercase"
                                          style={{ fontSize: globalFontSize }}
                                        >
                                          {displayNameForSlot(p, slot)}
                                        </div>
                                        <SlotStockPriceDisplay
                                          slot={slot}
                                          unitName={unitName}
                                          fontSize={stockPriceFontSize}
                                          stockLineClassName={"mt-2 font-bold leading-snug text-center"}
                                          priceLineClassName={"mt-1 font-bold leading-snug text-center"}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : selectedTemplate === 8 ? (
                          productImageAspect === "square" ? (
                            <div className="h-full flex items-start justify-center">
                              <div className="w-full max-w-full">
                                <div
                                  className="grid h-full grid-cols-2 grid-rows-4 gap-x-3 gap-y-0"
                                >
                                  {Array.from({ length: selectedTemplate }, (_, idx) => {
                                    const slot = slots[idx];
                                    const p =
                                      slot?.productId != null
                                        ? productsById.get(slot.productId)
                                        : undefined;
                                    const hasImageError = Boolean(imageErrorBySlot[idx]);
                                    const stockPriceFontSizeBase = Math.max(
                                      14,
                                      Math.round(globalFontSize * 0.9),
                                    );
                                    // 8'li Kare: yazıların taşmaması için çok hafif küçült.
                                    const eightTitleFontSize = Math.max(
                                      12,
                                      Math.round(globalFontSize * 0.92),
                                    );
                                    const eightStockPriceFontSize = Math.max(
                                      12,
                                      Math.round(stockPriceFontSizeBase * 0.92),
                                    );

                                    return (
                                      <div
                                        key={idx}
                                        className="flex h-[382px] flex-col overflow-hidden"
                                        style={{ background: canvasBg }}
                                      >
                                        <div className="flex-1 min-h-0 flex items-center justify-center">
                                          <div
                                            className="h-full aspect-square max-w-full overflow-hidden"
                                            style={{
                                              transform: `translateY(-1px) scale(${eightSquareImageScale})`,
                                              transformOrigin: "center",
                                            }}
                                          >
                                            <SlotImage
                                              src={imageSrcForSlot(p, slot)}
                                              alt={displayNameForSlot(p, slot)}
                                              slot={slot}
                                              sizeText={sizeTextForSlot(p)}
                                              frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                              hasError={hasImageError}
                                              onError={() => markSlotImageError(idx)}
                                              onLoad={() => clearSlotImageError(idx)}
                                            />
                                          </div>
                                        </div>

                                        <div
                                          className={[
                                            "mt-0 px-1 pt-0 pb-0 flex flex-col items-center justify-start leading-[1.1]",
                                            productDetailsTextColorClass,
                                          ].join(" ")}
                                        >
                                          <div
                                            className="font-semibold leading-[1.1] tracking-wide text-center uppercase"
                                            style={{ fontSize: eightTitleFontSize }}
                                          >
                                            {displayNameForSlot(p, slot)}
                                          </div>
                                          <SlotStockPriceDisplay
                                            slot={slot}
                                            unitName={unitName}
                                            fontSize={eightStockPriceFontSize}
                                            stockLineClassName={"mt-0 font-bold leading-[1.1] text-center"}
                                            priceLineClassName={"mt-0 font-bold leading-[1.1] text-center"}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center">
                              <div
                                className="w-full max-w-full"
                                style={{
                                  transform: "scale(0.92)",
                                  transformOrigin: "center",
                                }}
                              >
                                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                                  {Array.from({ length: selectedTemplate }, (_, idx) => {
                                    const slot = slots[idx];
                                    const p =
                                      slot?.productId != null
                                        ? productsById.get(slot.productId)
                                        : undefined;
                                    const hasImageError = Boolean(imageErrorBySlot[idx]);
                                    const stockPriceFontSize = Math.max(
                                      14,
                                      Math.round(globalFontSize * 0.9),
                                    );
                                    const aspectClass = frameAspectClass(
                                      aspectForSlot(productImageAspect, slot),
                                      slot,
                                      sizeTextForSlot(p),
                                    );

                                    return (
                                      <div
                                        key={idx}
                                        className="flex flex-col items-stretch overflow-hidden"
                                        style={{ background: canvasBg }}
                                      >
                                        <div
                                          className={[
                                            "w-full overflow-hidden",
                                            aspectClass,
                                          ].join(" ")}
                                        >
                                          <SlotImage
                                            src={imageSrcForSlot(p, slot)}
                                            alt={displayNameForSlot(p, slot)}
                                            slot={slot}
                                            sizeText={sizeTextForSlot(p)}
                                            frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                            hasError={hasImageError}
                                            onError={() => markSlotImageError(idx)}
                                            onLoad={() => clearSlotImageError(idx)}
                                          />
                                        </div>

                                        <div
                                          className={[
                                            "mt-0.5 px-2 pt-1 pb-1 flex flex-col items-center justify-start",
                                            productDetailsTextColorClass,
                                          ].join(" ")}
                                        >
                                          <div
                                            className="font-semibold leading-tight tracking-wide text-center uppercase"
                                            style={{ fontSize: globalFontSize }}
                                          >
                                            {displayNameForSlot(p, slot)}
                                          </div>
                                          <SlotStockPriceDisplay
                                            slot={slot}
                                            unitName={unitName}
                                            fontSize={stockPriceFontSize}
                                            stockLineClassName={"mt-0.5 font-bold leading-snug text-center"}
                                            priceLineClassName={"mt-0 font-bold leading-snug text-center"}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )
                        ) : selectedTemplate === 6 &&
                          productImageAspect === "square" ? (
                          <div className="h-full flex items-start justify-center">
                            <div
                              className={[
                                "w-full max-w-full",
                                isSixOrEightSquare ? "mt-[-150px]" : "",
                              ].join(" ")}
                              style={{ transform: "scale(0.76)", transformOrigin: "center" }}
                            >
                              <div className="grid grid-cols-2 gap-x-7 gap-y-10">
                                {Array.from({ length: selectedTemplate }, (_, idx) => {
                                  const slot = slots[idx];
                                  const p =
                                    slot?.productId != null
                                      ? productsById.get(slot.productId)
                                      : undefined;
                                  const hasImageError = Boolean(imageErrorBySlot[idx]);
                                  const stockPriceFontSize = Math.max(
                                    14,
                                    Math.round(globalFontSize * 0.9),
                                  );
                                  const aspectClass = frameAspectClass(
                                    aspectForSlot(productImageAspect, slot),
                                    slot,
                                    sizeTextForSlot(p),
                                  );

                                  return (
                                    <div
                                      key={idx}
                                      className="flex flex-col items-stretch overflow-hidden"
                                      style={{ background: canvasBg }}
                                    >
                                      <div
                                        className={[
                                          "w-full overflow-hidden",
                                          aspectClass,
                                        ].join(" ")}
                                      >
                                        <SlotImage
                                          src={imageSrcForSlot(p, slot)}
                                          alt={displayNameForSlot(p, slot)}
                                          slot={slot}
                                          sizeText={sizeTextForSlot(p)}
                                          frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                          hasError={hasImageError}
                                          onError={() => markSlotImageError(idx)}
                                          onLoad={() => clearSlotImageError(idx)}
                                        />
                                      </div>

                                      <div
                                        className={[
                                          "mt-0 px-2 pt-1 pb-1 flex flex-col items-center justify-start",
                                          productDetailsTextColorClass,
                                        ].join(" ")}
                                      >
                                        <div
                                          className="font-semibold leading-tight tracking-wide text-center uppercase"
                                          style={{ fontSize: globalFontSize }}
                                        >
                                          {displayNameForSlot(p, slot)}
                                        </div>
                                        <SlotStockPriceDisplay
                                          slot={slot}
                                          unitName={unitName}
                                          fontSize={stockPriceFontSize}
                                          stockLineClassName={"mt-0.5 font-bold leading-snug text-center"}
                                          priceLineClassName={"mt-0 font-bold leading-snug text-center"}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : selectedTemplate === 5 &&
                          (productImageAspect === "video" ||
                            productImageAspect === "oneThree" ||
                            productImageAspect === "oneFour") ? (
                          <div className="h-full w-full flex items-start justify-center overflow-hidden">
                            <div className="w-full h-full flex flex-col overflow-hidden pt-4 pb-8">
                              <div
                                className="w-full"
                                style={{
                                  transform: "translateY(14px) scale(0.9)",
                                  transformOrigin: "top center",
                                }}
                              >
                                <div
                                  className="w-full"
                                  style={{ transform: "scale(1.08)", transformOrigin: "top center" }}
                                >
                                <div className="grid grid-cols-2 gap-x-8 gap-y-8">
                                  {[0, 1, 2, 3].map((idx) => {
                                    const slot = slots[idx];
                                    const p =
                                      slot?.productId != null
                                        ? productsById.get(slot.productId)
                                        : undefined;
                                    const hasImageError = Boolean(imageErrorBySlot[idx]);
                                    const stockPriceFontSize = Math.max(
                                      14,
                                      Math.round(globalFontSize * 0.9),
                                    );
                                    const aspectClass = frameAspectClass(
                                      aspectForSlot(productImageAspect, slot),
                                      slot,
                                      sizeTextForSlot(p),
                                    );

                                    return (
                                      <div
                                        key={idx}
                                        className="flex flex-col items-stretch overflow-hidden"
                                        style={{ background: canvasBg }}
                                      >
                                        <div
                                          className={[
                                            "w-full overflow-hidden",
                                            aspectClass,
                                          ].join(" ")}
                                        >
                                          <SlotImage
                                            src={imageSrcForSlot(p, slot)}
                                            alt={displayNameForSlot(p, slot)}
                                            slot={slot}
                                            sizeText={sizeTextForSlot(p)}
                                            frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                            hasError={hasImageError}
                                            onError={() => markSlotImageError(idx)}
                                            onLoad={() => clearSlotImageError(idx)}
                                          />
                                        </div>

                                        <div
                                          className={[
                                            "mt-3 px-3 pt-2 pb-2 flex flex-col items-center justify-start",
                                            productDetailsTextColorClass,
                                          ].join(" ")}
                                        >
                                          <div
                                            className="font-semibold leading-tight tracking-wide text-center uppercase"
                                            style={{ fontSize: globalFontSize }}
                                          >
                                              {displayNameForSlot(p, slot)}
                                          </div>
                                          <SlotStockPriceDisplay
                                            slot={slot}
                                            unitName={unitName}
                                            fontSize={stockPriceFontSize}
                                            stockLineClassName={"mt-1 font-bold leading-snug text-center"}
                                            priceLineClassName={"mt-0.5 font-bold leading-snug text-center"}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                </div>

                                <div className="mt-28 flex items-start justify-center">
                                  {(() => {
                                    const idx = 4;
                                    const slot = slots[idx];
                                    const p =
                                      slot?.productId != null
                                        ? productsById.get(slot.productId)
                                        : undefined;
                                    const hasImageError = Boolean(imageErrorBySlot[idx]);
                                    const stockPriceFontSize = Math.max(
                                      14,
                                      Math.round(globalFontSize * 0.9),
                                    );
                                    const aspectClass = frameAspectClass(
                                      aspectForSlot(productImageAspect, slot),
                                      slot,
                                      sizeTextForSlot(p),
                                    );

                                    return (
                                      <div
                                        className="w-full max-w-[680px] mx-auto flex flex-col items-stretch overflow-hidden"
                                        style={{ background: canvasBg }}
                                      >
                                        <div
                                          className={[
                                            "w-full overflow-hidden",
                                            aspectClass,
                                          ].join(" ")}
                                        >
                                          <SlotImage
                                            src={imageSrcForSlot(p, slot)}
                                            alt={displayNameForSlot(p, slot)}
                                            slot={slot}
                                            sizeText={sizeTextForSlot(p)}
                                            frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                            hasError={hasImageError}
                                            onError={() => markSlotImageError(idx)}
                                            onLoad={() => clearSlotImageError(idx)}
                                          />
                                        </div>

                                        <div
                                          className={[
                                            "mt-3 px-3 pt-2 pb-2 flex flex-col items-center justify-start",
                                            productDetailsTextColorClass,
                                          ].join(" ")}
                                        >
                                          <div
                                            className="font-semibold leading-tight tracking-wide text-center uppercase"
                                            style={{ fontSize: globalFontSize }}
                                          >
                                              {displayNameForSlot(p, slot)}
                                          </div>
                                          <SlotStockPriceDisplay
                                            slot={slot}
                                            unitName={unitName}
                                            fontSize={stockPriceFontSize}
                                            stockLineClassName={"mt-1 font-bold leading-snug text-center"}
                                            priceLineClassName={"mt-0.5 font-bold leading-snug text-center"}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : selectedTemplate === 5 &&
                          productImageAspect === "square" ? (
                          <div className="h-full flex items-start justify-center pt-2 overflow-hidden">
                            <div className="w-full max-w-full">
                              <div
                                className="w-full"
                                style={{
                                  transform: "translateY(24px) scale(0.82)",
                                  transformOrigin: "top center",
                                }}
                              >
                                <div className="grid grid-cols-2 grid-rows-3 gap-x-8 gap-y-4">
                                  {Array.from({ length: 6 }, (_, cellIdx) => {
                                    if (cellIdx >= 5) {
                                      return <div key="empty-5" className="opacity-0" />;
                                    }

                                    const idx = cellIdx;
                                    const slot = slots[idx];
                                    const p =
                                      slot?.productId != null
                                        ? productsById.get(slot.productId)
                                        : undefined;
                                    const hasImageError = Boolean(imageErrorBySlot[idx]);
                                    const stockPriceFontSize = Math.max(
                                      14,
                                      Math.round(globalFontSize * 0.9),
                                    );
                                    const aspectClass = frameAspectClass(
                                      aspectForSlot(productImageAspect, slot),
                                      slot,
                                      sizeTextForSlot(p),
                                    );

                                    return (
                                      <div
                                        key={idx}
                                        className="flex flex-col items-stretch overflow-hidden"
                                        style={{ background: canvasBg }}
                                      >
                                        <div
                                          className={[
                                            "w-full overflow-hidden",
                                            aspectClass,
                                          ].join(" ")}
                                        >
                                          <SlotImage
                                            src={imageSrcForSlot(p, slot)}
                                            alt={displayNameForSlot(p, slot)}
                                            slot={slot}
                                            sizeText={sizeTextForSlot(p)}
                                            frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                            hasError={hasImageError}
                                            onError={() => markSlotImageError(idx)}
                                            onLoad={() => clearSlotImageError(idx)}
                                          />
                                        </div>

                                        <div
                                          className={[
                                            "mt-2 px-3 pt-2 pb-2 flex flex-col items-center justify-start",
                                            productDetailsTextColorClass,
                                          ].join(" ")}
                                        >
                                          <div
                                            className="font-semibold leading-tight tracking-wide text-center uppercase"
                                            style={{ fontSize: globalFontSize }}
                                          >
                                            {displayNameForSlot(p, slot)}
                                          </div>
                                          <SlotStockPriceDisplay
                                            slot={slot}
                                            unitName={unitName}
                                            fontSize={stockPriceFontSize}
                                            stockLineClassName={"mt-1 font-bold leading-snug text-center"}
                                            priceLineClassName={"mt-0.5 font-bold leading-snug text-center"}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : selectedTemplate === 6 &&
                          (productImageAspect === "video" ||
                            productImageAspect === "oneThree" ||
                            productImageAspect === "oneFour") ? (
                          <div
                            className="box-border h-full grid gap-x-6 gap-y-10 py-10"
                            style={{
                              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                              // Satırlar içeriğe göre sarılır ve blok dikeyde
                              // ortalanır; aksi hâlde 1fr satırlar tuvale
                              // yayılıp üstten başlıyor ve aralar açılıyordu.
                              gridTemplateRows: "repeat(3, min-content)",
                              alignContent: "center",
                            }}
                          >
                            {Array.from({ length: 6 }, (_, idx) => {
                              const slot = slots[idx];
                              const p =
                                slot?.productId != null
                                  ? productsById.get(slot.productId)
                                  : undefined;
                              const hasImageError = Boolean(imageErrorBySlot[idx]);
                              const stockPriceFontSize = Math.max(
                                14,
                                Math.round(globalFontSize * 0.9),
                              );
                              const aspectClass = frameAspectClass(
                                aspectForSlot(productImageAspect, slot),
                                slot,
                                sizeTextForSlot(p),
                              );

                              return (
                                <div
                                  key={idx}
                                  className="flex min-h-0 flex-col justify-center overflow-hidden"
                                  style={{ background: canvasBg }}
                                >
                                  <div
                                    className={[
                                      "w-full shrink-0 overflow-hidden",
                                      aspectClass,
                                    ].join(" ")}
                                  >
                                    <SlotImage
                                      src={imageSrcForSlot(p, slot)}
                                      alt={displayNameForSlot(p, slot)}
                                      slot={slot}
                                      sizeText={sizeTextForSlot(p)}
                                      frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                      hasError={hasImageError}
                                      onError={() => markSlotImageError(idx)}
                                      onLoad={() => clearSlotImageError(idx)}
                                    />
                                  </div>

                                  <div
                                    className={[
                                      "mt-2 shrink-0 px-3 pt-2 pb-1 flex flex-col items-center justify-start",
                                      productDetailsTextColorClass,
                                    ].join(" ")}
                                  >
                                    <div
                                      className="font-semibold leading-tight tracking-wide text-center uppercase"
                                      style={{ fontSize: globalFontSize }}
                                    >
                                      {displayNameForSlot(p, slot)}
                                    </div>
                                    <SlotStockPriceDisplay
                                      slot={slot}
                                      unitName={unitName}
                                      fontSize={stockPriceFontSize}
                                      stockLineClassName="mt-1 font-bold leading-snug text-center"
                                      priceLineClassName="mt-0.5 font-bold leading-snug text-center"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div
                            className="h-full grid gap-6"
                            style={{
                              gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
                              gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
                            }}
                          >
                            {Array.from({ length: selectedTemplate }, (_, idx) => {
                              const slot = slots[idx];
                              const p =
                                slot?.productId != null
                                  ? productsById.get(slot.productId)
                                  : undefined;
                              const hasImageError = Boolean(imageErrorBySlot[idx]);
                                  const stockPriceFontSize = Math.max(
                                    14,
                                    Math.round(globalFontSize * 0.9),
                                  );
                              const aspectClass = frameAspectClass(
                                aspectForSlot(productImageAspect, slot),
                                slot,
                                sizeTextForSlot(p),
                              );

                              return (
                                <div
                                  key={idx}
                                  className="flex flex-col items-stretch overflow-hidden"
                                  style={{ background: canvasBg }}
                                >
                                  <div
                                    className={["w-full overflow-hidden", aspectClass].join(
                                      " ",
                                    )}
                                  >
                                    <SlotImage
                                      src={imageSrcForSlot(p, slot)}
                                      alt={displayNameForSlot(p, slot)}
                                      slot={slot}
                                      sizeText={sizeTextForSlot(p)}
                                      frameRatio={aspectRatioForProductImage(aspectForSlot(productImageAspect, slot))}
                                      hasError={hasImageError}
                                      onError={() => markSlotImageError(idx)}
                                      onLoad={() => clearSlotImageError(idx)}
                                    />
                                  </div>

                                  <div
                                    className={[
                                      productImageAspect === "square"
                                        ? "mt-2 px-3 pt-3 pb-2 flex flex-col items-center justify-start"
                                        : "mt-3 px-3 pt-3 pb-2 flex flex-col items-center justify-start",
                                      productDetailsTextColorClass,
                                    ].join(" ")}
                                  >
                                    <div
                                      className="font-semibold leading-tight tracking-wide text-center uppercase"
                                      style={{ fontSize: globalFontSize }}
                                    >
                                      {displayNameForSlot(p, slot)}
                                    </div>
                                    <SlotStockPriceDisplay
                                      slot={slot}
                                      unitName={unitName}
                                      fontSize={stockPriceFontSize}
                                      stockLineClassName={"mt-2 font-bold leading-snug text-center"}
                                      priceLineClassName={"mt-1 font-bold leading-snug text-center"}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                          </>
                        )}
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
      </main>
    </div>
  );
}

