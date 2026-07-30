"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { toPng } from "html-to-image";
import productsData from "@/src/data/products.json";

type SaleRecord = {
  id: string;
  date: string;
  productName: string;
  brand: string;
  size: string;
  surface: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  total: number;
  customer: string;
  note: string;
  source: "form" | "banner";
  createdAt: string;
};

type Product = {
  id: string;
  name: string;
  brand: string;
  size: string;
  image: string;
};

const products = productsData as Product[];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtMoney(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtNum(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("tr-TR", {
    maximumFractionDigits: 2,
  });
}

function parseNum(v: string): number {
  const n = parseFloat(String(v ?? "").replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// SheetJS'i çalışma anında CDN'den yükler (npm bağımlılığı yok).
let xlsxPromise: Promise<XLSXLib> | null = null;
type XLSXLib = {
  utils: {
    aoa_to_sheet: (rows: (string | number)[][]) => unknown;
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
  };
  writeFile: (wb: unknown, filename: string) => void;
};
function loadXLSX(): Promise<XLSXLib> {
  const w = window as unknown as { XLSX?: XLSXLib };
  if (w.XLSX) return Promise.resolve(w.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise<XLSXLib>((resolve, reject) => {
      const s = document.createElement("script");
      s.src =
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.async = true;
      s.onload = () => {
        const ww = window as unknown as { XLSX?: XLSXLib };
        if (ww.XLSX) resolve(ww.XLSX);
        else reject(new Error("Excel kütüphanesi yüklenemedi"));
      };
      s.onerror = () => reject(new Error("Excel kütüphanesi yüklenemedi"));
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Görsel yüklenemedi"));
    img.src = src;
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function SalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyExport, setBusyExport] = useState<"" | "xlsx" | "pdf">("");

  // Satır düzenleme
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eBrand, setEBrand] = useState("");
  const [eSize, setESize] = useState("");
  const [eSurface, setESurface] = useState("");
  const [eGrade, setEGrade] = useState("");
  const [eQty, setEQty] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eCustomer, setECustomer] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Form
  const [fProduct, setFProduct] = useState("");
  const [fBrand, setFBrand] = useState("");
  const [fSize, setFSize] = useState("");
  const [fSurface, setFSurface] = useState("");
  const [fGrade, setFGrade] = useState("");
  const [fQty, setFQty] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [fDate, setFDate] = useState(todayStr());
  const [fCustomer, setFCustomer] = useState("");
  const [fNote, setFNote] = useState("");

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [search, setSearch] = useState("");

  const pdfStageRef = useRef<HTMLDivElement | null>(null);

  async function loadSales() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/sales", { cache: "no-store" });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ? ` – ${body.error}` : "";
        } catch {}
        throw new Error(`Satışlar yüklenemedi (${res.status})${detail}`);
      }
      const data = (await res.json()) as { items?: SaleRecord[] };
      setSales(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setError((e as Error)?.message ?? "Satışlar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSales();
  }, []);

  function onProductChange(value: string) {
    setFProduct(value);
    const match = products.find(
      (p) => p.name.toLowerCase() === value.trim().toLowerCase(),
    );
    if (match) {
      setFBrand((b) => (b ? b : match.brand));
      setFSize((sz) => (sz ? sz : match.size));
    }
  }

  const computedTotal = useMemo(() => {
    const q = parseNum(fQty);
    const p = parseNum(fPrice);
    return Math.round(q * p * 100) / 100;
  }, [fQty, fPrice]);

  const brands = useMemo(() => {
    const set = new Set<string>();
    for (const s of sales) if (s.brand) set.add(s.brand);
    return Array.from(set).sort();
  }, [sales]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (dateFrom && s.date < dateFrom) return false;
      if (dateTo && s.date > dateTo) return false;
      if (brandFilter && s.brand !== brandFilter) return false;
      if (q) {
        const hay = `${s.productName} ${s.brand} ${s.size} ${s.customer} ${s.note}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sales, dateFrom, dateTo, brandFilter, search]);

  const totals = useMemo(() => {
    let qty = 0;
    let rev = 0;
    for (const s of filtered) {
      qty += s.quantity;
      rev += s.total;
    }
    return { count: filtered.length, qty, rev };
  }, [filtered]);

  async function addSale() {
    const payload = {
      date: fDate || todayStr(),
      productName: fProduct.trim(),
      brand: fBrand.trim(),
      size: fSize.trim(),
      surface: fSurface,
      grade: fGrade,
      quantity: parseNum(fQty),
      unitPrice: parseNum(fPrice),
      customer: fCustomer.trim(),
      note: fNote.trim(),
      source: "form" as const,
    };
    if (!payload.productName && !payload.customer && computedTotal <= 0) {
      setError("En az ürün adı ya da miktar/fiyat girin.");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ? ` – ${body.error}` : "";
        } catch {}
        throw new Error(`Kaydedilemedi (${res.status})${detail}`);
      }
      const data = (await res.json()) as { items?: SaleRecord[] };
      setSales(Array.isArray(data?.items) ? data.items : []);
      // formu sıfırla (tarih kalsın)
      setFProduct("");
      setFBrand("");
      setFSize("");
      setFSurface("");
      setFGrade("");
      setFQty("");
      setFPrice("");
      setFCustomer("");
      setFNote("");
    } catch (e) {
      setError((e as Error)?.message ?? "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSale(id: string) {
    if (!confirm("Bu satış kaydı silinsin mi?")) return;
    try {
      setError(null);
      const res = await fetch(`/api/sales?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Silinemedi (${res.status})`);
      const data = (await res.json()) as { items?: SaleRecord[] };
      setSales(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setError((e as Error)?.message ?? "Silinemedi");
    }
  }

  function startEdit(s: SaleRecord) {
    setEditingId(s.id);
    setEBrand(s.brand ?? "");
    setESize(s.size ?? "");
    setESurface(s.surface ?? "");
    setEGrade(s.grade ?? "");
    setEQty(String(s.quantity ?? ""));
    setEPrice(String(s.unitPrice ?? ""));
    setECustomer(s.customer ?? "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEBrand("");
    setESize("");
    setESurface("");
    setEGrade("");
    setEQty("");
    setEPrice("");
    setECustomer("");
  }

  async function saveEdit(id: string) {
    try {
      setEditSaving(true);
      setError(null);
      const res = await fetch("/api/sales", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          brand: eBrand.trim(),
          size: eSize.trim(),
          surface: eSurface,
          grade: eGrade,
          quantity: parseNum(eQty),
          unitPrice: parseNum(ePrice),
          customer: eCustomer.trim(),
        }),
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body?.error ? ` – ${body.error}` : "";
        } catch {}
        throw new Error(`Güncellenemedi (${res.status})${detail}`);
      }
      const data = (await res.json()) as { items?: SaleRecord[] };
      setSales(Array.isArray(data?.items) ? data.items : []);
      cancelEdit();
    } catch (e) {
      setError((e as Error)?.message ?? "Güncellenemedi");
    } finally {
      setEditSaving(false);
    }
  }

  function rangeLabel(): string {
    if (dateFrom && dateTo) return `${dateFrom} — ${dateTo}`;
    if (dateFrom) return `${dateFrom} sonrası`;
    if (dateTo) return `${dateTo} öncesi`;
    return "Tüm kayıtlar";
  }

  async function exportExcel() {
    if (filtered.length === 0) {
      setError("Dışa aktarılacak kayıt yok.");
      return;
    }
    try {
      setBusyExport("xlsx");
      setError(null);
      const XLSX = await loadXLSX();
      const header = [
        "Tarih",
        "Ürün",
        "Marka",
        "Boyut",
        "Yüzey",
        "Sınıf",
        "Miktar (m²)",
        "Birim Fiyat",
        "Toplam",
        "Müşteri",
        "Açıklama",
      ];
      const rows: (string | number)[][] = [header];
      for (const s of filtered) {
        rows.push([
          s.date,
          s.productName,
          s.brand,
          s.size,
          s.surface,
          s.grade,
          s.quantity,
          s.unitPrice,
          s.total,
          s.customer,
          s.note,
        ]);
      }
      rows.push([]);
      rows.push(["", "", "", "", "", "TOPLAM", totals.qty, "", totals.rev, "", ""]);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Satışlar");
      XLSX.writeFile(wb, `satis-raporu-${todayStr()}.xlsx`);
    } catch (e) {
      setError((e as Error)?.message ?? "Excel oluşturulamadı");
    } finally {
      setBusyExport("");
    }
  }

  function buildPageHtml(
    pageRows: SaleRecord[],
    pageIndex: number,
    pageCount: number,
    withTotals: boolean,
  ): string {
    const tr = pageRows
      .map(
        (s) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${s.date}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:600;">${escapeHtml(
          s.productName || "—",
        )}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(s.brand)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(s.size)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(s.surface)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(s.grade)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmtNum(
          s.quantity,
        )}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${fmtMoney(
          s.unitPrice,
        )}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:700;">${fmtMoney(
          s.total,
        )}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(s.customer)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(s.note)}</td>
      </tr>`,
      )
      .join("");

    const totalsRow = withTotals
      ? `
      <tr>
        <td colspan="6" style="padding:10px 8px;text-align:right;font-weight:700;border-top:2px solid #111;">TOPLAM</td>
        <td style="padding:10px 8px;text-align:right;font-weight:700;border-top:2px solid #111;">${fmtNum(
          totals.qty,
        )} m²</td>
        <td style="border-top:2px solid #111;"></td>
        <td style="padding:10px 8px;text-align:right;font-weight:800;border-top:2px solid #111;">${fmtMoney(
          totals.rev,
        )} ₺</td>
        <td colspan="2" style="border-top:2px solid #111;"></td>
      </tr>`
      : "";

    const head =
      pageIndex === 0
        ? `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;">
        <div>
          <div style="font-size:22px;font-weight:800;letter-spacing:.5px;">KULALILAR — Satış Raporu</div>
          <div style="font-size:12px;color:#555;margin-top:2px;">Dönem: ${escapeHtml(
            rangeLabel(),
          )} • ${filtered.length} kayıt • Oluşturma: ${todayStr()}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;color:#555;">Toplam Ciro</div>
          <div style="font-size:20px;font-weight:800;">${fmtMoney(totals.rev)} ₺</div>
          <div style="font-size:12px;color:#555;">${fmtNum(totals.qty)} m²</div>
        </div>
      </div>`
        : `<div style="font-size:12px;color:#777;margin-bottom:8px;">KULALILAR — Satış Raporu (devam)</div>`;

    return `
    <div style="width:1000px;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;padding:28px 30px;box-sizing:border-box;">
      ${head}
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#111;color:#fff;">
            <th style="padding:8px;text-align:left;">Tarih</th>
            <th style="padding:8px;text-align:left;">Ürün</th>
            <th style="padding:8px;text-align:left;">Marka</th>
            <th style="padding:8px;text-align:left;">Boyut</th>
            <th style="padding:8px;text-align:left;">Yüzey</th>
            <th style="padding:8px;text-align:left;">Sınıf</th>
            <th style="padding:8px;text-align:right;">Miktar</th>
            <th style="padding:8px;text-align:right;">Birim ₺</th>
            <th style="padding:8px;text-align:right;">Toplam ₺</th>
            <th style="padding:8px;text-align:left;">Müşteri</th>
            <th style="padding:8px;text-align:left;">Açıklama</th>
          </tr>
        </thead>
        <tbody>
          ${tr}
          ${totalsRow}
        </tbody>
      </table>
      <div style="margin-top:10px;font-size:10px;color:#999;text-align:right;">Sayfa ${
        pageIndex + 1
      } / ${pageCount}</div>
    </div>`;
  }

  async function exportPDF() {
    if (filtered.length === 0) {
      setError("Dışa aktarılacak kayıt yok.");
      return;
    }
    const stage = pdfStageRef.current;
    if (!stage) return;
    try {
      setBusyExport("pdf");
      setError(null);
      const rowsPerPage = 20;
      const pages = chunk(filtered, rowsPerPage);
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 20;

      for (let i = 0; i < pages.length; i++) {
        const html = buildPageHtml(pages[i], i, pages.length, i === pages.length - 1);
        stage.innerHTML = html;
        const node = stage.firstElementChild as HTMLElement;
        const dataUrl = await toPng(node, {
          pixelRatio: 2,
          backgroundColor: "#ffffff",
        });
        const img = await loadImage(dataUrl);
        const imgW = pageW - margin * 2;
        const imgH = (imgW * img.height) / img.width;
        if (i > 0) pdf.addPage();
        pdf.addImage(
          dataUrl,
          "PNG",
          margin,
          margin,
          imgW,
          Math.min(imgH, pageH - margin * 2),
        );
      }
      stage.innerHTML = "";
      pdf.save(`satis-raporu-${todayStr()}.pdf`);
    } catch (e) {
      setError((e as Error)?.message ?? "PDF oluşturulamadı");
    } finally {
      setBusyExport("");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Satışlar / Raporlar</h1>
            <p className="text-sm text-zinc-500">
              Satış kayıtları Cloudinary&apos;de saklanır. Yönetim için Excel /
              PDF olarak dışa aktarın.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            ← Studio
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
          {/* Form */}
          <div className="h-fit rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 text-sm font-bold text-zinc-800">
              Yeni satış kaydı
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-xs font-semibold text-zinc-600">
                Ürün
                <input
                  list="product-list"
                  value={fProduct}
                  onChange={(e) => onProductChange(e.target.value)}
                  placeholder="Ürün adı (katalogtan seçebilirsiniz)"
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                />
              </label>
              <datalist id="product-list">
                {products.slice(0, 1200).map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.brand} • {p.size}
                  </option>
                ))}
              </datalist>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-zinc-600">
                  Marka
                  <input
                    value={fBrand}
                    onChange={(e) => setFBrand(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  />
                </label>
                <label className="text-xs font-semibold text-zinc-600">
                  Boyut
                  <input
                    value={fSize}
                    onChange={(e) => setFSize(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-zinc-600">
                  Yüzey
                  <select
                    value={fSurface}
                    onChange={(e) => setFSurface(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  >
                    <option value="">Boş</option>
                    <option value="FLP">FLP</option>
                    <option value="SEMİ LAPP.">SEMİ LAPP.</option>
                    <option value="MAT">MAT</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-zinc-600">
                  Sınıf
                  <select
                    value={fGrade}
                    onChange={(e) => setFGrade(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  >
                    <option value="">Boş</option>
                    <option value="1.">1.</option>
                    <option value="END.">END.</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-zinc-600">
                  Miktar (m²)
                  <input
                    inputMode="decimal"
                    value={fQty}
                    onChange={(e) => setFQty(e.target.value)}
                    placeholder="örn. 51.2"
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  />
                </label>
                <label className="text-xs font-semibold text-zinc-600">
                  Birim Fiyat (₺)
                  <input
                    inputMode="decimal"
                    value={fPrice}
                    onChange={(e) => setFPrice(e.target.value)}
                    placeholder="örn. 279"
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold text-zinc-600">
                  Tarih
                  <input
                    type="date"
                    value={fDate}
                    onChange={(e) => setFDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  />
                </label>
                <div className="flex flex-col justify-end">
                  <div className="text-xs font-semibold text-zinc-600">Toplam</div>
                  <div className="mt-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-bold text-zinc-900">
                    {fmtMoney(computedTotal)} ₺
                  </div>
                </div>
              </div>

              <label className="text-xs font-semibold text-zinc-600">
                Müşteri
                <input
                  value={fCustomer}
                  onChange={(e) => setFCustomer(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                />
              </label>
              <label className="text-xs font-semibold text-zinc-600">
                Açıklama
                <input
                  value={fNote}
                  onChange={(e) => setFNote(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                />
              </label>

              <button
                type="button"
                onClick={() => void addSale()}
                disabled={saving}
                className="mt-1 rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {saving ? "Kaydediliyor…" : "Satışı kaydet"}
              </button>
            </div>
          </div>

          {/* Liste + raporlar */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-zinc-50 px-3 py-2">
                <div className="text-[11px] font-semibold text-zinc-500">
                  Kayıt
                </div>
                <div className="text-lg font-bold">{totals.count}</div>
              </div>
              <div className="rounded-xl bg-zinc-50 px-3 py-2">
                <div className="text-[11px] font-semibold text-zinc-500">
                  Toplam m²
                </div>
                <div className="text-lg font-bold">{fmtNum(totals.qty)}</div>
              </div>
              <div className="col-span-2 rounded-xl bg-emerald-50 px-3 py-2">
                <div className="text-[11px] font-semibold text-emerald-700">
                  Toplam Ciro
                </div>
                <div className="text-lg font-bold text-emerald-800">
                  {fmtMoney(totals.rev)} ₺
                </div>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-zinc-600">
                Başlangıç
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="mt-1 block rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
                />
              </label>
              <label className="text-xs font-semibold text-zinc-600">
                Bitiş
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="mt-1 block rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
                />
              </label>
              <label className="text-xs font-semibold text-zinc-600">
                Marka
                <select
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  className="mt-1 block rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400"
                >
                  <option value="">Tümü</option>
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 text-xs font-semibold text-zinc-600">
                Ara
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ürün, müşteri, açıklama…"
                  className="mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-400"
                />
              </label>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void exportExcel()}
                disabled={busyExport !== "" || filtered.length === 0}
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                {busyExport === "xlsx" ? "Excel hazırlanıyor…" : "Excel (.xlsx) indir"}
              </button>
              <button
                type="button"
                onClick={() => void exportPDF()}
                disabled={busyExport !== "" || filtered.length === 0}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              >
                {busyExport === "pdf" ? "PDF hazırlanıyor…" : "PDF indir"}
              </button>
              <button
                type="button"
                onClick={() => void loadSales()}
                disabled={loading}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
              >
                {loading ? "Yükleniyor…" : "Yenile"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                    <th className="py-2 pr-2 font-semibold">Tarih</th>
                    <th className="py-2 pr-2 font-semibold">Ürün</th>
                    <th className="py-2 pr-2 font-semibold">Marka</th>
                    <th className="py-2 pr-2 font-semibold">Boyut</th>
                    <th className="py-2 pr-2 font-semibold">Yüzey</th>
                    <th className="py-2 pr-2 font-semibold">Sınıf</th>
                    <th className="py-2 pr-2 text-right font-semibold">m²</th>
                    <th className="py-2 pr-2 text-right font-semibold">Birim ₺</th>
                    <th className="py-2 pr-2 text-right font-semibold">Toplam ₺</th>
                    <th className="py-2 pr-2 font-semibold">Müşteri</th>
                    <th className="py-2 pr-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={11}
                        className="py-8 text-center text-sm text-zinc-500"
                      >
                        {loading ? "Yükleniyor…" : "Kayıt yok."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((s) =>
                      editingId === s.id ? (
                        <tr
                          key={s.id}
                          className="border-b border-zinc-100 align-top bg-amber-50/60"
                        >
                          <td className="py-2 pr-2 whitespace-nowrap">{s.date}</td>
                          <td className="py-2 pr-2 font-semibold">
                            {s.productName || "—"}
                            {s.note ? (
                              <span className="block text-xs font-normal text-zinc-400">
                                {s.note}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              value={eBrand}
                              onChange={(e) => setEBrand(e.target.value)}
                              className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-zinc-500"
                            />
                          </td>
                          <td className="py-2 pr-2 whitespace-nowrap">
                            <input
                              value={eSize}
                              onChange={(e) => setESize(e.target.value)}
                              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-zinc-500"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <select
                              value={eSurface}
                              onChange={(e) => setESurface(e.target.value)}
                              className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-sm outline-none focus:border-zinc-500"
                            >
                              <option value="">Boş</option>
                              <option value="FLP">FLP</option>
                              <option value="SEMİ LAPP.">SEMİ LAPP.</option>
                              <option value="MAT">MAT</option>
                            </select>
                          </td>
                          <td className="py-2 pr-2">
                            <select
                              value={eGrade}
                              onChange={(e) => setEGrade(e.target.value)}
                              className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-sm outline-none focus:border-zinc-500"
                            >
                              <option value="">Boş</option>
                              <option value="1.">1.</option>
                              <option value="END.">END.</option>
                            </select>
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <input
                              inputMode="decimal"
                              value={eQty}
                              onChange={(e) => setEQty(e.target.value)}
                              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-sm outline-none focus:border-zinc-500"
                            />
                          </td>
                          <td className="py-2 pr-2 text-right">
                            <input
                              inputMode="decimal"
                              value={ePrice}
                              onChange={(e) => setEPrice(e.target.value)}
                              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-sm outline-none focus:border-zinc-500"
                            />
                          </td>
                          <td className="py-2 pr-2 text-right font-bold">
                            {fmtMoney(
                              Math.round(parseNum(eQty) * parseNum(ePrice) * 100) / 100,
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              value={eCustomer}
                              onChange={(e) => setECustomer(e.target.value)}
                              className="w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-zinc-500"
                            />
                          </td>
                          <td className="py-2 pr-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => void saveEdit(s.id)}
                              disabled={editSaving}
                              className="mr-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                            >
                              {editSaving ? "Kaydediliyor…" : "Kaydet"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={editSaving}
                              className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-300 disabled:opacity-50"
                            >
                              İptal
                            </button>
                          </td>
                        </tr>
                      ) : (
                        <tr
                          key={s.id}
                          className="border-b border-zinc-100 align-top"
                        >
                          <td className="py-2 pr-2 whitespace-nowrap">{s.date}</td>
                          <td className="py-2 pr-2 font-semibold">
                            {s.productName || "—"}
                            {s.note ? (
                              <span className="block text-xs font-normal text-zinc-400">
                                {s.note}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-2">{s.brand}</td>
                          <td className="py-2 pr-2 whitespace-nowrap">{s.size}</td>
                          <td className="py-2 pr-2 whitespace-nowrap">{s.surface}</td>
                          <td className="py-2 pr-2 whitespace-nowrap">{s.grade}</td>
                          <td className="py-2 pr-2 text-right">{fmtNum(s.quantity)}</td>
                          <td className="py-2 pr-2 text-right">{fmtMoney(s.unitPrice)}</td>
                          <td className="py-2 pr-2 text-right font-bold">
                            {fmtMoney(s.total)}
                          </td>
                          <td className="py-2 pr-2">{s.customer}</td>
                          <td className="py-2 pr-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => startEdit(s)}
                              className="mr-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-800"
                            >
                              Düzenle
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteSale(s.id)}
                              className="rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:border-red-300 hover:text-red-600"
                            >
                              Sil
                            </button>
                          </td>
                        </tr>
                      ),
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* PDF üretimi için ekran dışı sahne */}
      <div
        ref={pdfStageRef}
        aria-hidden
        style={{
          position: "fixed",
          left: "-10000px",
          top: 0,
          width: "1000px",
          pointerEvents: "none",
          opacity: 0,
        }}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
