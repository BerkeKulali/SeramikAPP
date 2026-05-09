"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toJpeg } from "html-to-image";
import { jsPDF } from "jspdf";
import { Search } from "lucide-react";

type TemplateCount = 1 | 2 | 3 | 4 | 5 | 6 | 8;
type ProductImageAspect = "square" | "threeTwo" | "video" | "parquet";

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
  bytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

type SlotState = {
  productId: string | null;
  stock: string;
  price: string;
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
  "15x60",
  "20x120",
  "60x60",
  "60x120",
  "30x60",
  "30x90",
  "45x45",
  "50x50",
  "80x80",
  "100x100",
  "120x180",
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
    darkText: false,
    customName: "",
    imageUrlOverride: null,
    imagePublicId: null,
    surface: "",
    grade: "",
    isRec: false,
  };
}

function buildSlots(count: TemplateCount, prev?: SlotState[]): SlotState[] {
  const base: SlotState[] = Array.from({ length: count }, (_, idx) => {
    const existing = prev?.[idx];
    if (!existing) return emptySlot();
    return {
      ...existing,
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
  const s = input.trim().toLowerCase().replace("×", "x");
  if ((SIZE_OPTIONS as readonly string[]).includes(s)) return s as SizeOption;
  return "60x60";
}

function aspectClassForSize(sizeText: string) {
  // Portrait canvas içinde bile tüm ürün görselleri yatay kalmalı.
  // Boyuta göre değişmez: 60x120 (1:2) yatay oranı.
  void sizeText;
  return "aspect-[2/1]";
}

function aspectClassForProductImage(aspect: ProductImageAspect) {
  if (aspect === "square") return "aspect-square";
  if (aspect === "threeTwo") return "aspect-[3/2]";
  if (aspect === "parquet") return "aspect-[6/1]";
  // "video" seçeneği: 60x120 (1:2) yatay görsel oranı
  return "aspect-[2/1]";
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
  const [isBuildingPdf, setIsBuildingPdf] = useState(false);
  const [isUploadLibraryOpen, setIsUploadLibraryOpen] = useState(false);
  const [uploadLibraryItems, setUploadLibraryItems] = useState<UploadLibraryItem[]>([]);
  const [isLoadingUploadLibrary, setIsLoadingUploadLibrary] = useState(false);
  const [uploadLibraryError, setUploadLibraryError] = useState<string | null>(null);

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

  function updateSlot(index: number, patch: Partial<SlotState>) {
    setSlots((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, ...patch } : s)),
    );
  }

  async function refreshUploadLibrary() {
    try {
      setIsLoadingUploadLibrary(true);
      setUploadLibraryError(null);
      const res = await fetch("/api/uploads", { cache: "no-store" });
      if (!res.ok) throw new Error(`Upload list failed: ${res.status}`);
      const data = (await res.json()) as { items?: UploadLibraryItem[] };
      setUploadLibraryItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setUploadLibraryError((e as Error)?.message ?? "Upload list failed");
    } finally {
      setIsLoadingUploadLibrary(false);
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
    };
  }

  function applyUploadedImageToSlot(
    idx: number,
    uploaded: { publicId: string; url: string; originalFilename?: string },
  ) {
    const title = (uploaded.originalFilename || "").trim();
    updateSlot(idx, {
      imageUrlOverride: uploaded.url,
      imagePublicId: uploaded.publicId,
      customName: (slots[idx]?.customName ?? "").trim() ? slots[idx]!.customName : title,
    });
    setImageErrorBySlot((prev) => {
      if (!prev[idx]) return prev;
      const next = { ...prev };
      delete next[idx];
      return next;
    });
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
        if (!s.productId) return s;
        return { ...s, price };
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
      const dataUrl = await toJpeg(node, {
        quality: 0.98,
        pixelRatio: 2,
        cacheBust: true,
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
    } finally {
      setIsDownloading(false);
    }
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
      d.productImageAspect === "parquet"
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

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setPdfQueue((prev) => [
      ...prev,
      { id, title, thumbnailDataUrl: thumb, snapshot: snap },
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

        const dataUrl = await toJpeg(node, {
          quality: 0.98,
          pixelRatio: 2,
          cacheBust: true,
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
      parsed.productImageAspect === "parquet"
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
      if (!s || typeof s !== "object") return emptySlot();
        return {
          productId: typeof s.productId === "string" ? s.productId : null,
          stock: typeof s.stock === "string" ? s.stock : "",
          price: typeof s.price === "string" ? s.price : "",
          darkText: typeof s.darkText === "boolean" ? s.darkText : false,
          customName: typeof s.customName === "string" ? s.customName : "",
        imageUrlOverride:
          typeof s.imageUrlOverride === "string" || s.imageUrlOverride === null
            ? s.imageUrlOverride
            : null,
        imagePublicId:
          typeof s.imagePublicId === "string" || s.imagePublicId === null ? s.imagePublicId : null,
          surface:
            s.surface === "" || s.surface === "FLP" || s.surface === "SEMİ LAPP." || s.surface === "MAT"
              ? s.surface
              : "",
          grade: s.grade === "" || s.grade === "1." || s.grade === "END." ? s.grade : "",
          isRec: typeof s.isRec === "boolean" ? s.isRec : false,
        };
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
        parsed.productImageAspect === "parquet"
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
        if (!s || typeof s !== "object") return emptySlot();
        return {
          productId: typeof s.productId === "string" ? s.productId : null,
          stock: typeof s.stock === "string" ? s.stock : "",
          price: typeof s.price === "string" ? s.price : "",
          darkText: typeof s.darkText === "boolean" ? s.darkText : false,
          customName: typeof s.customName === "string" ? s.customName : "",
          imageUrlOverride:
            typeof s.imageUrlOverride === "string" || s.imageUrlOverride === null
              ? s.imageUrlOverride
              : null,
          imagePublicId:
            typeof s.imagePublicId === "string" || s.imagePublicId === null ? s.imagePublicId : null,
          surface:
            s.surface === "" || s.surface === "FLP" || s.surface === "SEMİ LAPP." || s.surface === "MAT"
              ? s.surface
              : "",
          grade: s.grade === "" || s.grade === "1." || s.grade === "END." ? s.grade : "",
          isRec: typeof s.isRec === "boolean" ? s.isRec : false,
        };
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
      <aside className="w-[380px] shrink-0 border-r border-zinc-200 bg-white">
        <div className="h-full flex flex-col">
          <div className="p-5 border-b border-zinc-200">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Kulalılar Katalog Studio
                </div>
                <div className="text-xs text-zinc-500">
                  Siyah-beyaz, temiz katalog çıktısı
                </div>
                <div className="mt-3">
                  <label className="block text-[12px] font-montserrat font-bold text-zinc-900">
                    Dosya Adı
                  </label>
                  <input
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="örn. Mavi-Picasso"
                    className="mt-1 w-[220px] rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
                    aria-label="Dosya adı"
                  />
                </div>
                <div className="mt-3">
                  <label className="block text-[12px] font-montserrat font-bold text-zinc-900">
                    Taslak Yükle
                  </label>
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      if (!f) return;
                      void importDraftFile(f);
                      e.currentTarget.value = "";
                    }}
                    className="mt-1 block w-[220px] text-xs text-zinc-600 file:mr-3 file:rounded-md file:border file:border-zinc-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-800 hover:file:bg-zinc-50"
                    aria-label="Taslak yükle"
                  />
                </div>
                <div className="mt-3">
                  <label className="block text-[12px] font-montserrat font-bold text-zinc-900">
                    PDF Kuyruğu Yükle
                  </label>
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      if (!f) return;
                      void importPdfQueueFile(f);
                      e.currentTarget.value = "";
                    }}
                    className="mt-1 block w-[220px] text-xs text-zinc-600 file:mr-3 file:rounded-md file:border file:border-zinc-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-800 hover:file:bg-zinc-50"
                    aria-label="PDF kuyruğu yükle"
                  />
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={downloadJpg}
                  disabled={isDownloading || isBuildingPdf}
                  className="inline-flex items-center gap-2 justify-center rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  <Icon name="download" className="h-4 w-4" />
                  {isDownloading ? "İndiriliyor..." : "JPG İndir"}
                </button>
                <button
                  type="button"
                  onClick={() => void addOrUpdatePdfQueueItem()}
                  disabled={isDownloading || isBuildingPdf}
                  className="inline-flex items-center gap-2 justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                >
                  {pdfEditingIndex != null ? "Sayfayı Güncelle" : "PDF Listesine Ekle"}
                </button>
                <button
                  type="button"
                  onClick={exportDraftJson}
                  disabled={isDownloading || isBuildingPdf}
                  className="inline-flex items-center gap-2 justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                >
                  Taslağı Kaydet (.json)
                </button>
                <button
                  type="button"
                  onClick={exportPdfQueueJson}
                  disabled={pdfQueue.length === 0 || isDownloading || isBuildingPdf}
                  className="inline-flex items-center gap-2 justify-center rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                  title={pdfQueue.length === 0 ? "PDF kuyruğu boş" : "PDF kuyruğunu JSON olarak kaydet"}
                >
                  PDF Kuyruğunu Kaydet (.json)
                </button>
                <button
                  type="button"
                  onClick={() => void downloadPdfFromQueue()}
                  disabled={pdfQueue.length === 0 || isDownloading || isBuildingPdf}
                  className="inline-flex items-center gap-2 justify-center rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                  title={pdfQueue.length === 0 ? "PDF kuyruğu boş" : "PDF indir"}
                >
                  PDF İndir ({pdfQueue.length})
                </button>
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
                      <div key={item.id} className="flex items-center gap-3 px-3 py-2">
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
                          onClick={() => {
                            applySnapshot(item.snapshot);
                            setPdfEditingIndex(idx);
                          }}
                          disabled={isBuildingPdf}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                          title="Düzenle"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPdfQueue((prev) => prev.filter((x) => x.id !== item.id));
                            setPdfEditingIndex((cur) => {
                              if (cur == null) return null;
                              if (cur === idx) return null;
                              if (cur > idx) return cur - 1;
                              return cur;
                            });
                          }}
                          disabled={isBuildingPdf}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                          title="Sil"
                        >
                          Sil
                        </button>
                      </div>
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
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-600">Boyut</div>
                  <select
                    value={selectedTemplateSize}
                    onChange={(e) => setSelectedTemplateSize(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  >
                    {SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
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
                <option value="parquet">Parke (1:6)</option>
              </select>
            </section>


            <section className="space-y-3">
              <div className="text-sm font-semibold text-zinc-900">Ürün Ara</div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Ürün Ara..."
                  className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-zinc-400"
                />
              </div>

              <div className="text-[11px] text-zinc-500">
                products:{" "}
                <span className="font-semibold text-zinc-800">{products.length}</span> •
                filtered:{" "}
                <span className="font-semibold text-zinc-800">
                  {filteredProducts.length}
                </span>{" "}
                • loading:{" "}
                <span className="font-semibold text-zinc-800">
                  {String(isLoadingProducts)}
                </span>{" "}
                • error:{" "}
                <span className="font-semibold text-zinc-800">
                  {productsError ?? "null"}
                </span>
              </div>

              <div className="max-h-[400px] overflow-y-auto rounded-lg border border-zinc-200 bg-white">
                {productsError ? (
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
                )}
              </div>

              <div className="text-xs text-zinc-500">
                Listeden bir ürüne tıklayınca{" "}
                <span className="font-semibold text-zinc-900">
                  aktif slota
                </span>{" "}
                yerleşir.
              </div>
            </section>

            <section className="space-y-3">
              <div className="text-sm font-semibold text-zinc-900">
                Slotlar (Ürün / Stok / Fiyat)
              </div>

              <div className="space-y-3">
                {slots.map((s, idx) => {
                  const p = s.productId ? productsById.get(s.productId) : null;
                  const isActive = idx === activeSlotIndex;
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
                      <div className="flex items-start justify-between gap-3">
                        <button
                          onClick={() => setActiveSlotIndex(idx)}
                          className="text-left"
                        >
                          <div className="text-xs font-semibold text-zinc-500">
                            Slot {idx + 1}
                          </div>
                          <div className="text-sm font-semibold text-zinc-900">
                            {p ? p.name : "Ürün seçilmedi"}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {p ? `${p.size} • ${p.id}` : "—"}
                          </div>
                        </button>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => applyPriceToAll(idx)}
                            disabled={!s.productId || !s.price.trim()}
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
                            disabled={!s.productId}
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
                            disabled={!s.productId}
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
                              disabled={!s.productId}
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
                                disabled={!s.productId}
                              >
                                <option value="">Boş</option>
                                <option value="1.">1.</option>
                                <option value="END.">END.</option>
                              </select>

                              <label
                                className={[
                                  "inline-flex h-[38px] items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-800",
                                  !s.productId ? "opacity-50" : "hover:bg-zinc-50",
                                ].join(" ")}
                                title="REC"
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(s.isRec)}
                                  onChange={(e) => updateSlot(idx, { isRec: e.target.checked })}
                                  disabled={!s.productId}
                                  className="h-4 w-4 accent-zinc-900"
                                />
                                <span className="font-semibold">REC</span>
                              </label>
                            </div>
                          </label>
                        </div>

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
                              disabled={!s.productId}
                            />
                          </label>

                          <label className="space-y-1">
                            <div className="text-xs font-semibold text-zinc-600">
                              Fiyat
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
                              disabled={!s.productId}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
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
                                      crossOrigin="anonymous"
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
                                const aspectClass = aspectClassForProductImage(
                                  productImageAspect,
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
                                      {p && !hasImageError ? (
                                        <img
                                          src={imageSrcForSlot(p, slot)}
                                          alt={p.name}
                                          crossOrigin="anonymous"
                                          className="h-full w-full object-cover object-center"
                                          onError={() =>
                                            setImageErrorBySlot((prev) => ({
                                              ...prev,
                                              [idx]: true,
                                            }))
                                          }
                                          onLoad={() =>
                                            setImageErrorBySlot((prev) => {
                                              if (!prev[idx]) return prev;
                                              const next = { ...prev };
                                              delete next[idx];
                                              return next;
                                            })
                                          }
                                        />
                                      ) : (
                                        <div className="h-full w-full" />
                                      )}
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
                                      <div
                                        className={[
                                          "mt-0 font-bold text-center",
                                          isParquetSix ? "leading-[1.1]" : "leading-snug",
                                        ].join(" ")}
                                        style={{ fontSize: stockPriceFontSize }}
                                      >
                                        Stok{" "}
                                        <span className="tabular-nums font-extrabold">
                                          {slot?.stock?.trim()
                                            ? slot.stock.trim()
                                            : "—"}
                                        </span>{" "}
                                        <span className="font-extrabold">
                                          {unitName?.trim()
                                            ? unitName.trim()
                                            : "m²"}
                                        </span>
                                      </div>
                                      <div
                                        className={[
                                          "mt-0 font-bold text-center",
                                          isParquetSix ? "leading-[1.1]" : "leading-snug",
                                        ].join(" ")}
                                        style={{ fontSize: stockPriceFontSize }}
                                      >
                                        <span className="tabular-nums font-extrabold">
                                          {slot?.price?.trim()
                                            ? slot.price.trim()
                                            : "—"}
                                        </span>{" "}
                                        <span className="font-extrabold">
                                          + KDV
                                        </span>
                                      </div>
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
                          <div className="h-full w-full flex items-center justify-center overflow-hidden">
                            <div className="w-full h-full flex flex-col overflow-hidden">
                              <div className="grid grid-rows-3 h-full overflow-hidden gap-y-10 py-10">
                                {[0, 1, 2].map((idx) => {
                                  const slot = slots[idx];
                                  const p =
                                    slot?.productId != null
                                      ? productsById.get(slot.productId)
                                      : undefined;
                                  const hasImageError = Boolean(imageErrorBySlot[idx]);

                                  return (
                                    <div
                                      key={idx}
                                      className="flex flex-col items-center justify-center min-h-0 pb-1 overflow-hidden"
                                      style={{ background: canvasBg }}
                                    >
                                      <div className="w-full overflow-hidden flex items-center justify-center">
                                        <div className="h-[38vh] max-h-[560px] aspect-square mx-auto overflow-hidden">
                                          {p && !hasImageError ? (
                                            <img
                                              src={imageSrcForSlot(p, slot)}
                                              alt={p.name}
                                              crossOrigin="anonymous"
                                              className="h-full w-full object-cover"
                                              onError={() =>
                                                setImageErrorBySlot((prev) => ({
                                                  ...prev,
                                                  [idx]: true,
                                                }))
                                              }
                                              onLoad={() =>
                                                setImageErrorBySlot((prev) => {
                                                  if (!prev[idx]) return prev;
                                                  const next = { ...prev };
                                                  delete next[idx];
                                                  return next;
                                                })
                                              }
                                            />
                                          ) : (
                                            <div className="h-full w-full" />
                                          )}
                                        </div>
                                      </div>

                                      <div
                                        className={[
                                          "px-2 pt-1 pb-0 flex flex-col items-center gap-y-1",
                                          productDetailsTextColorClass,
                                        ].join(" ")}
                                      >
                                        <div
                                          className="font-semibold leading-tight tracking-wide text-center uppercase"
                                          style={{ fontSize: globalFontSize }}
                                        >
                                          {displayNameForSlot(p, slot)}
                                        </div>
                                        <div
                                          className="font-bold leading-tight text-center"
                                          style={{ fontSize: globalFontSize }}
                                        >
                                          Stok{" "}
                                          <span className="tabular-nums font-extrabold">
                                            {slot?.stock?.trim()
                                              ? slot.stock.trim()
                                              : "—"}
                                          </span>{" "}
                                          <span className="font-extrabold">
                                            {unitName?.trim() ? unitName.trim() : "m²"}
                                          </span>
                                        </div>
                                        <div
                                          className="font-bold leading-tight text-center"
                                          style={{ fontSize: globalFontSize }}
                                        >
                                          <span className="tabular-nums font-extrabold">
                                            {slot?.price?.trim()
                                              ? slot.price.trim()
                                              : "—"}
                                          </span>{" "}
                                          <span className="font-extrabold">+ KDV</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
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
                                  const aspectClass = aspectClassForProductImage(
                                    productImageAspect,
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
                                          {p && !hasImageError ? (
                                            <img
                                              src={imageSrcForSlot(p, slot)}
                                              alt={p.name}
                                              crossOrigin="anonymous"
                                              className="h-full w-full object-cover object-center"
                                              onError={() =>
                                                setImageErrorBySlot((prev) => ({
                                                  ...prev,
                                                  [idx]: true,
                                                }))
                                              }
                                              onLoad={() =>
                                                setImageErrorBySlot((prev) => {
                                                  if (!prev[idx]) return prev;
                                                  const next = { ...prev };
                                                  delete next[idx];
                                                  return next;
                                                })
                                              }
                                            />
                                          ) : (
                                            <div className="h-full w-full" />
                                          )}
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
                                        <div
                                          className="font-bold leading-tight text-center"
                                          style={{ fontSize: stockPriceFontSize }}
                                        >
                                          Stok{" "}
                                          <span className="tabular-nums font-extrabold">
                                            {slot?.stock?.trim()
                                              ? slot.stock.trim()
                                              : "—"}
                                          </span>{" "}
                                          <span className="font-extrabold">
                                            {unitName?.trim() ? unitName.trim() : "m²"}
                                          </span>
                                        </div>
                                        <div
                                          className="font-bold leading-tight text-center"
                                          style={{ fontSize: stockPriceFontSize }}
                                        >
                                          <span className="tabular-nums font-extrabold">
                                            {slot?.price?.trim()
                                              ? slot.price.trim()
                                              : "—"}
                                          </span>{" "}
                                          <span className="font-extrabold">+ KDV</span>
                                        </div>
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
                              const aspectClass = aspectClassForProductImage(
                                productImageAspect,
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
                                    {p && !hasImageError ? (
                                      <img
                                        src={imageSrcForSlot(p, slot)}
                                        alt={p.name}
                                        crossOrigin="anonymous"
                                        className="h-full w-full object-cover object-center"
                                        onError={() =>
                                          setImageErrorBySlot((prev) => ({
                                            ...prev,
                                            [idx]: true,
                                          }))
                                        }
                                        onLoad={() =>
                                          setImageErrorBySlot((prev) => {
                                            if (!prev[idx]) return prev;
                                            const next = { ...prev };
                                            delete next[idx];
                                            return next;
                                          })
                                        }
                                      />
                                    ) : (
                                      <div className="h-full w-full" />
                                    )}
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
                                    <div
                                      className="mt-3 font-bold leading-snug text-center"
                                      style={{ fontSize: stockPriceFontSize }}
                                    >
                                      Stok{" "}
                                      <span className="tabular-nums font-extrabold">
                                        {slot?.stock?.trim()
                                          ? slot.stock.trim()
                                          : "—"}
                                      </span>{" "}
                                      <span className="font-extrabold">
                                        {unitName?.trim() ? unitName.trim() : "m²"}
                                      </span>
                                    </div>
                                    <div
                                      className="mt-1 font-bold leading-snug text-center"
                                      style={{ fontSize: stockPriceFontSize }}
                                    >
                                      <span className="tabular-nums font-extrabold">
                                        {slot?.price?.trim()
                                          ? slot.price.trim()
                                          : "—"}
                                      </span>{" "}
                                      <span className="font-extrabold">+ KDV</span>
                                    </div>
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
                              const aspectClass = aspectClassForProductImage(
                                productImageAspect,
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
                                    {p && !hasImageError ? (
                                      <img
                                        src={imageSrcForSlot(p, slot)}
                                        alt={p.name}
                                        crossOrigin="anonymous"
                                        className="h-full w-full object-cover object-center"
                                        onError={() =>
                                          setImageErrorBySlot((prev) => ({
                                            ...prev,
                                            [idx]: true,
                                          }))
                                        }
                                        onLoad={() =>
                                          setImageErrorBySlot((prev) => {
                                            if (!prev[idx]) return prev;
                                            const next = { ...prev };
                                            delete next[idx];
                                            return next;
                                          })
                                        }
                                      />
                                    ) : (
                                      <div className="h-full w-full" />
                                    )}
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
                                    <div
                                      className="mt-3 font-bold leading-snug text-center"
                                      style={{ fontSize: stockPriceFontSize }}
                                    >
                                      Stok{" "}
                                      <span className="tabular-nums font-extrabold">
                                        {slot?.stock?.trim()
                                          ? slot.stock.trim()
                                          : "—"}
                                      </span>{" "}
                                      <span className="font-extrabold">
                                        {unitName?.trim() ? unitName.trim() : "m²"}
                                      </span>
                                    </div>
                                    <div
                                      className="mt-1 font-bold leading-snug text-center"
                                      style={{ fontSize: stockPriceFontSize }}
                                    >
                                      <span className="tabular-nums font-extrabold">
                                        {slot?.price?.trim()
                                          ? slot.price.trim()
                                          : "—"}
                                      </span>{" "}
                                      <span className="font-extrabold">+ KDV</span>
                                    </div>
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
                                  const aspectClass = aspectClassForProductImage(
                                    productImageAspect,
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
                                        {p && !hasImageError ? (
                                          <img
                                            src={imageSrcForSlot(p, slot)}
                                            alt={p.name}
                                            crossOrigin="anonymous"
                                            className="h-full w-full object-cover object-center"
                                            onError={() =>
                                              setImageErrorBySlot((prev) => ({
                                                ...prev,
                                                [idx]: true,
                                              }))
                                            }
                                            onLoad={() =>
                                              setImageErrorBySlot((prev) => {
                                                if (!prev[idx]) return prev;
                                                const next = { ...prev };
                                                delete next[idx];
                                                return next;
                                              })
                                            }
                                          />
                                        ) : (
                                          <div className="h-full w-full" />
                                        )}
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
                                        <div
                                          className="mt-2 font-bold leading-snug text-center"
                                          style={{ fontSize: stockPriceFontSize }}
                                        >
                                          Stok{" "}
                                          <span className="tabular-nums font-extrabold">
                                            {slot?.stock?.trim()
                                              ? slot.stock.trim()
                                              : "—"}
                                          </span>{" "}
                                          <span className="font-extrabold">
                                            {unitName?.trim()
                                              ? unitName.trim()
                                              : "m²"}
                                          </span>
                                        </div>
                                        <div
                                          className="mt-1 font-bold leading-snug text-center"
                                          style={{ fontSize: stockPriceFontSize }}
                                        >
                                          <span className="tabular-nums font-extrabold">
                                            {slot?.price?.trim()
                                              ? slot.price.trim()
                                              : "—"}
                                          </span>{" "}
                                          <span className="font-extrabold">
                                            + KDV
                                          </span>
                                        </div>
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
                                            {p && !hasImageError ? (
                                              <img
                                                src={imageSrcForSlot(p, slot)}
                                                alt={p.name}
                                                crossOrigin="anonymous"
                                                className="h-full w-full object-cover object-center"
                                                onError={() =>
                                                  setImageErrorBySlot((prev) => ({
                                                    ...prev,
                                                    [idx]: true,
                                                  }))
                                                }
                                                onLoad={() =>
                                                  setImageErrorBySlot((prev) => {
                                                    if (!prev[idx]) return prev;
                                                    const next = { ...prev };
                                                    delete next[idx];
                                                    return next;
                                                  })
                                                }
                                              />
                                            ) : (
                                              <div className="h-full w-full" />
                                            )}
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
                                          <div
                                            className="mt-0 font-bold leading-[1.1] text-center"
                                            style={{ fontSize: eightStockPriceFontSize }}
                                          >
                                            Stok{" "}
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.stock?.trim()
                                                ? slot.stock.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              {unitName?.trim()
                                                ? unitName.trim()
                                                : "m²"}
                                            </span>
                                          </div>
                                          <div
                                            className="mt-0 font-bold leading-[1.1] text-center"
                                            style={{ fontSize: eightStockPriceFontSize }}
                                          >
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.price?.trim()
                                                ? slot.price.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              + KDV
                                            </span>
                                          </div>
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
                                    const aspectClass = aspectClassForProductImage(
                                      productImageAspect,
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
                                          {p && !hasImageError ? (
                                            <img
                                              src={imageSrcForSlot(p, slot)}
                                              alt={p.name}
                                              crossOrigin="anonymous"
                                              className="h-full w-full object-cover object-center"
                                              onError={() =>
                                                setImageErrorBySlot((prev) => ({
                                                  ...prev,
                                                  [idx]: true,
                                                }))
                                              }
                                              onLoad={() =>
                                                setImageErrorBySlot((prev) => {
                                                  if (!prev[idx]) return prev;
                                                  const next = { ...prev };
                                                  delete next[idx];
                                                  return next;
                                                })
                                              }
                                            />
                                          ) : (
                                            <div className="h-full w-full" />
                                          )}
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
                                          <div
                                            className="mt-0.5 font-bold leading-snug text-center"
                                            style={{ fontSize: stockPriceFontSize }}
                                          >
                                            Stok{" "}
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.stock?.trim()
                                                ? slot.stock.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              {unitName?.trim()
                                                ? unitName.trim()
                                                : "m²"}
                                            </span>
                                          </div>
                                          <div
                                            className="mt-0 font-bold leading-snug text-center"
                                            style={{ fontSize: stockPriceFontSize }}
                                          >
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.price?.trim()
                                                ? slot.price.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              + KDV
                                            </span>
                                          </div>
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
                                  const aspectClass = aspectClassForProductImage(
                                    productImageAspect,
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
                                        {p && !hasImageError ? (
                                          <img
                                            src={imageSrcForSlot(p, slot)}
                                            alt={p.name}
                                            crossOrigin="anonymous"
                                            className="h-full w-full object-cover object-center"
                                            onError={() =>
                                              setImageErrorBySlot((prev) => ({
                                                ...prev,
                                                [idx]: true,
                                              }))
                                            }
                                            onLoad={() =>
                                              setImageErrorBySlot((prev) => {
                                                if (!prev[idx]) return prev;
                                                const next = { ...prev };
                                                delete next[idx];
                                                return next;
                                              })
                                            }
                                          />
                                        ) : (
                                          <div className="h-full w-full" />
                                        )}
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
                                        <div
                                          className="mt-0.5 font-bold leading-snug text-center"
                                          style={{ fontSize: stockPriceFontSize }}
                                        >
                                          Stok{" "}
                                          <span className="tabular-nums font-extrabold">
                                            {slot?.stock?.trim()
                                              ? slot.stock.trim()
                                              : "—"}
                                          </span>{" "}
                                          <span className="font-extrabold">
                                            {unitName?.trim()
                                              ? unitName.trim()
                                              : "m²"}
                                          </span>
                                        </div>
                                        <div
                                          className="mt-0 font-bold leading-snug text-center"
                                          style={{ fontSize: stockPriceFontSize }}
                                        >
                                          <span className="tabular-nums font-extrabold">
                                            {slot?.price?.trim()
                                              ? slot.price.trim()
                                              : "—"}
                                          </span>{" "}
                                          <span className="font-extrabold">
                                            + KDV
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : selectedTemplate === 5 &&
                          productImageAspect === "video" ? (
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
                                    const aspectClass = aspectClassForProductImage(
                                      productImageAspect,
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
                                          {p && !hasImageError ? (
                                            <img
                                              src={imageSrcForSlot(p, slot)}
                                              alt={p.name}
                                              crossOrigin="anonymous"
                                              className="h-full w-full object-cover object-center"
                                              onError={() =>
                                                setImageErrorBySlot((prev) => ({
                                                  ...prev,
                                                  [idx]: true,
                                                }))
                                              }
                                              onLoad={() =>
                                                setImageErrorBySlot((prev) => {
                                                  if (!prev[idx]) return prev;
                                                  const next = { ...prev };
                                                  delete next[idx];
                                                  return next;
                                                })
                                              }
                                            />
                                          ) : (
                                            <div className="h-full w-full" />
                                          )}
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
                                          <div
                                            className="mt-1 font-bold leading-snug text-center"
                                            style={{ fontSize: stockPriceFontSize }}
                                          >
                                            Stok{" "}
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.stock?.trim()
                                                ? slot.stock.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              {unitName?.trim()
                                                ? unitName.trim()
                                                : "m²"}
                                            </span>
                                          </div>
                                          <div
                                            className="mt-0.5 font-bold leading-snug text-center"
                                            style={{ fontSize: stockPriceFontSize }}
                                          >
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.price?.trim()
                                                ? slot.price.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              + KDV
                                            </span>
                                          </div>
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
                                    const aspectClass = aspectClassForProductImage(
                                      productImageAspect,
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
                                          {p && !hasImageError ? (
                                            <img
                                              src={imageSrcForSlot(p, slot)}
                                              alt={p.name}
                                              crossOrigin="anonymous"
                                              className="h-full w-full object-cover object-center"
                                              onError={() =>
                                                setImageErrorBySlot((prev) => ({
                                                  ...prev,
                                                  [idx]: true,
                                                }))
                                              }
                                              onLoad={() =>
                                                setImageErrorBySlot((prev) => {
                                                  if (!prev[idx]) return prev;
                                                  const next = { ...prev };
                                                  delete next[idx];
                                                  return next;
                                                })
                                              }
                                            />
                                          ) : (
                                            <div className="h-full w-full" />
                                          )}
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
                                          <div
                                            className="mt-1 font-bold leading-snug text-center"
                                            style={{ fontSize: stockPriceFontSize }}
                                          >
                                            Stok{" "}
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.stock?.trim()
                                                ? slot.stock.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              {unitName?.trim()
                                                ? unitName.trim()
                                                : "m²"}
                                            </span>
                                          </div>
                                          <div
                                            className="mt-0.5 font-bold leading-snug text-center"
                                            style={{ fontSize: stockPriceFontSize }}
                                          >
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.price?.trim()
                                                ? slot.price.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              + KDV
                                            </span>
                                          </div>
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
                                    const aspectClass = aspectClassForProductImage(
                                      productImageAspect,
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
                                          {p && !hasImageError ? (
                                            <img
                                              src={imageSrcForSlot(p, slot)}
                                              alt={p.name}
                                              crossOrigin="anonymous"
                                              className="h-full w-full object-cover object-center"
                                              onError={() =>
                                                setImageErrorBySlot((prev) => ({
                                                  ...prev,
                                                  [idx]: true,
                                                }))
                                              }
                                              onLoad={() =>
                                                setImageErrorBySlot((prev) => {
                                                  if (!prev[idx]) return prev;
                                                  const next = { ...prev };
                                                  delete next[idx];
                                                  return next;
                                                })
                                              }
                                            />
                                          ) : (
                                            <div className="h-full w-full" />
                                          )}
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
                                          <div
                                            className="mt-1 font-bold leading-snug text-center"
                                            style={{ fontSize: stockPriceFontSize }}
                                          >
                                            Stok{" "}
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.stock?.trim()
                                                ? slot.stock.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              {unitName?.trim()
                                                ? unitName.trim()
                                                : "m²"}
                                            </span>
                                          </div>
                                          <div
                                            className="mt-0.5 font-bold leading-snug text-center"
                                            style={{ fontSize: stockPriceFontSize }}
                                          >
                                            <span className="tabular-nums font-extrabold">
                                              {slot?.price?.trim()
                                                ? slot.price.trim()
                                                : "—"}
                                            </span>{" "}
                                            <span className="font-extrabold">
                                              + KDV
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
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
                              const aspectClass = aspectClassForProductImage(
                                productImageAspect,
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
                                    {p && !hasImageError ? (
                                      <img
                                        src={imageSrcForSlot(p, slot)}
                                        alt={p.name}
                                        crossOrigin="anonymous"
                                        className="h-full w-full object-cover object-center"
                                        onError={() =>
                                          setImageErrorBySlot((prev) => ({
                                            ...prev,
                                            [idx]: true,
                                          }))
                                        }
                                        onLoad={() =>
                                          setImageErrorBySlot((prev) => {
                                            if (!prev[idx]) return prev;
                                            const next = { ...prev };
                                            delete next[idx];
                                            return next;
                                          })
                                        }
                                      />
                                    ) : (
                                      // Placeholder yazı/katman yok: boş bırak.
                                      <div className="h-full w-full" />
                                    )}
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
                                    <div
                                      className="mt-2 font-bold leading-snug text-center"
                                      style={{ fontSize: stockPriceFontSize }}
                                    >
                                      Stok{" "}
                                      <span className="tabular-nums font-extrabold">
                                        {slot?.stock?.trim()
                                          ? slot.stock.trim()
                                          : "—"}
                                      </span>{" "}
                                      <span className="font-extrabold">
                                        {unitName?.trim() ? unitName.trim() : "m²"}
                                      </span>
                                    </div>
                                    <div
                                      className="mt-1 font-bold leading-snug text-center"
                                      style={{ fontSize: stockPriceFontSize }}
                                    >
                                      <span className="tabular-nums font-extrabold">
                                        {slot?.price?.trim()
                                          ? slot.price.trim()
                                          : "—"}
                                      </span>{" "}
                                      <span className="font-extrabold">+ KDV</span>
                                    </div>
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

