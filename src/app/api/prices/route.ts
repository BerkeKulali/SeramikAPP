import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

/**
 * Ürün fiyat hafızası.
 *
 * Tedarikçinin ham stok dökümünde fiyat yok. Hazırlama ekranında yazılan
 * fiyatlar buraya kaydedilir; bir dahaki dökümde aynı ürün görülünce
 * fiyatı hazır gelir ve yalnız değişenler düzeltilir.
 *
 * Depolama eşleşme sözlüğüyle aynı desende: Cloudinary'de tek raw JSON.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function initCloudinary() {
  cloudinary.config({
    cloud_name: requireEnv("CLOUDINARY_CLOUD_NAME"),
    api_key: requireEnv("CLOUDINARY_API_KEY"),
    api_secret: requireEnv("CLOUDINARY_API_SECRET"),
  });
}

const FILE_ID = "banner-studio/import/prices.json";

type PriceEntry = {
  /** Ürün anahtarı: ebat|yüzey|sadeleşmiş ad. */
  key: string;
  /** Fiyat (tam sayı, metin olarak). */
  price: string;
  /** Ne yazıyordu — insan okusun diye. */
  sample: string;
  updatedAt: string;
};

function isNotFound(err: unknown): boolean {
  const httpCode = (err as { http_code?: number })?.http_code;
  if (httpCode === 404) return true;
  const msg = String(
    (err as { error?: { message?: string } })?.error?.message ??
      (err as Error)?.message ??
      "",
  ).toLowerCase();
  return msg.includes("not found") || msg.includes("can not find");
}

async function readEntries(): Promise<PriceEntry[]> {
  try {
    const resource = (await cloudinary.api.resource(FILE_ID, {
      resource_type: "raw",
    })) as { secure_url?: string };
    const url = String(resource.secure_url ?? "");
    if (!url) return [];
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? (data as PriceEntry[]) : [];
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

async function writeEntries(list: PriceEntry[]): Promise<void> {
  const json = JSON.stringify(list);
  const dataUri =
    "data:application/json;base64," + Buffer.from(json).toString("base64");
  await cloudinary.uploader.upload(dataUri, {
    resource_type: "raw",
    public_id: FILE_ID,
    overwrite: true,
    invalidate: true,
  });
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function GET() {
  try {
    initCloudinary();
    const items = await readEntries();
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Fiyatlar okunamadı" },
      { status: 500 },
    );
  }
}

/** Gövde: { items: [{ key, price, sample }] } — aynı anahtar üzerine yazar. */
export async function POST(req: Request) {
  try {
    initCloudinary();
    const body = (await req.json()) as {
      items?: { key?: string; price?: string; sample?: string }[];
    };
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!incoming.length) {
      return NextResponse.json({ error: "items gerekli" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const current = await readEntries();
    const byKey = new Map(current.map((e) => [e.key, e]));

    let changed = 0;
    for (const raw of incoming) {
      const key = str(raw.key);
      const price = str(raw.price);
      // Boş fiyat kaydedilmez: hafızadaki doğru değeri silmesin.
      if (!key || !price) continue;
      const prev = byKey.get(key);
      if (prev && prev.price === price) continue;
      byKey.set(key, {
        key,
        price,
        sample: str(raw.sample) || prev?.sample || key,
        updatedAt: now,
      });
      changed += 1;
    }

    const items = Array.from(byKey.values()).sort((a, b) =>
      a.key.localeCompare(b.key, "tr"),
    );
    if (changed) await writeEntries(items);
    return NextResponse.json({ items, changed });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Fiyatlar kaydedilemedi" },
      { status: 500 },
    );
  }
}
