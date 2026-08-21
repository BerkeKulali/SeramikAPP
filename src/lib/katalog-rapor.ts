/**
 * Katalog boşluk raporu.
 *
 * İki soruya cevap verir:
 *   1. Hangi ebatta kaç ürün var, hangileri boş? (menü dürüst olsun)
 *   2. Stokta olup fotoğrafı olmayan ürünler hangileri? (çekim listesi)
 *
 * İkincisi asıl işi yapan: içe aktarma zaten her satırı katalogla
 * eşlemeye çalışıyor, eşleşmeyenler doğrudan çekim listesidir.
 */

import type { CatalogProduct, ImportResult, ImportRow } from "./stok-import";

/* ------------------------------ ebat denetimi ------------------------------ */

export type SizeAudit = {
  size: string;
  count: number;
  /** "bos" = hiç ürün yok · "ince" = 5 ve altı · "dolu" */
  level: "bos" | "ince" | "dolu";
};

export type SizeReport = {
  rows: SizeAudit[];
  empty: string[];
  thin: string[];
  /**
   * Katalogda olup menüde bulunmayan ebatlar. Seçici ebada göre süzdüğü
   * için bu kayıtlara pratikte ulaşılamaz — sessizce kaybolurlar.
   */
  orphans: SizeAudit[];
};

export function auditSizes(
  products: CatalogProduct[],
  menuSizes: readonly string[],
): SizeReport {
  const counts = new Map<string, number>();
  products.forEach((p) => counts.set(p.size, (counts.get(p.size) ?? 0) + 1));

  const rows: SizeAudit[] = menuSizes.map((size) => {
    const count = counts.get(size) ?? 0;
    return {
      size,
      count,
      level: count === 0 ? "bos" : count <= 5 ? "ince" : "dolu",
    };
  });

  const inMenu = new Set(menuSizes);
  const orphans: SizeAudit[] = Array.from(counts.entries())
    .filter(([size]) => !inMenu.has(size))
    .map(([size, count]) => ({ size, count, level: "ince" as const }))
    .sort((a, b) => b.count - a.count);

  return {
    rows,
    empty: rows.filter((r) => r.level === "bos").map((r) => r.size),
    thin: rows.filter((r) => r.level === "ince").map((r) => r.size),
    orphans,
  };
}

/** Katalogda ürün adı gibi durmayan kayıtlar — afişte aynen basılırlar. */
const JUNK_NAME =
  /screenshot|ekran\s*g[oö]r[uü]nt[uü]s[uü]|whatsapp|image[\s_-]?\d|img[\s_-]?\d|photo[\s_-]?\d|untitled|adsız|copy|kopya|^\d+$/i;

export function findJunkNames(products: CatalogProduct[]): CatalogProduct[] {
  return products.filter((p) => JUNK_NAME.test(p.name));
}

/* ------------------------------ çekim listesi ------------------------------ */

export type ShootingItem = {
  name: string;
  size: string;
  /** "yok" = hiçbir ebatta bulunamadı · "baska-ebat" = yalnız başka ebatta var */
  reason: "yok" | "baska-ebat";
  /** Başka ebatta bulunduysa hangi ebatta. */
  foundAt: string;
  stock: string;
  price: string;
  page: string;
};

/**
 * İçe aktarma sonucundan fotoğrafı eksik ürünleri çıkarır.
 * pick: kullanıcının önizlemede yaptığı seçimler (satır anahtarı -> ürün).
 */
export function shootingList(
  result: ImportResult,
  pick: Record<string, string>,
  products: CatalogProduct[],
): ShootingItem[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: ShootingItem[] = [];
  const seen = new Set<string>();

  const push = (r: ImportRow, reason: ShootingItem["reason"], foundAt: string) => {
    const name = r.fallbackName || r.cleaned;
    const dedupe = `${name}|${r.size}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({
      name,
      size: r.size,
      reason,
      foundAt,
      stock: r.stock,
      price: r.price,
      page: r.page,
    });
  };

  result.pages.forEach((pg) =>
    pg.rows.forEach((r) => {
      const chosenId = pick[r.key] ?? "";
      const chosen = chosenId ? byId.get(chosenId) : undefined;
      if (!chosen) {
        push(r, "yok", "");
      } else if (r.size && chosen.size !== r.size) {
        push(r, "baska-ebat", chosen.size);
      }
    }),
  );

  // Hiç fotoğrafı olmayanlar önce — onlar acil.
  return out.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === "yok" ? -1 : 1;
    return a.name.localeCompare(b.name, "tr");
  });
}

/* --------------------------------- CSV --------------------------------- */

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel'in Türkçe kurulumu noktalı virgül bekler; BOM olmadan Türkçe bozulur. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function shootingListCsv(items: ShootingItem[]): string {
  return toCsv(
    ["Ürün", "İstenen ebat", "Durum", "Mevcut ebat", "Stok m²", "Fiyat", "Sayfa"],
    items.map((i) => [
      i.name,
      i.size,
      i.reason === "yok" ? "Fotoğraf yok" : "Başka ebatta var",
      i.foundAt,
      i.stock,
      i.price,
      i.page,
    ]),
  );
}

export function sizeAuditCsv(rows: SizeAudit[]): string {
  return toCsv(
    ["Ebat", "Ürün sayısı", "Durum"],
    rows.map((r) => [
      r.size,
      r.count,
      r.level === "bos" ? "ÜRÜN YOK" : r.level === "ince" ? "az ürün" : "yeterli",
    ]),
  );
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
