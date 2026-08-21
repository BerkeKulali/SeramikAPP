import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

/**
 * Excel içe aktarmasında elle yapılan eşleşmeleri kalıcı tutar.
 *
 * Önizlemede bir ürünü katalogdan seçtiğinde bu seçim buraya yazılır ve
 * bir dahaki içe aktarmada aynı ham ad görülünce doğrudan uygulanır.
 * Böylece her ay aynı üç düzeltmeyi tekrar yapmak gerekmez.
 *
 * Depolama taslaklarla aynı desende: Cloudinary'de tek bir raw JSON.
 * Uygulama yayındayken kendi dosyalarına yazamaz, bu yüzden repo içi
 * bir dosya kullanılmıyor.
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

const FILE_ID = "banner-studio/import/matches.json";

type MatchEntry = {
  /** Normalize edilmiş Excel adı — anahtar. */
  key: string;
  /** Kullanıcının seçtiği katalog ürünü. "" = bilerek eşleştirilmedi. */
  productId: string;
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

async function readEntries(): Promise<MatchEntry[]> {
  try {
    const resource = (await cloudinary.api.resource(FILE_ID, {
      resource_type: "raw",
    })) as { secure_url?: string };
    const url = String(resource.secure_url ?? "");
    if (!url) return [];
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? (data as MatchEntry[]) : [];
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

async function writeEntries(list: MatchEntry[]): Promise<void> {
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
      { error: (e as Error)?.message ?? "Eşleşmeler okunamadı" },
      { status: 500 },
    );
  }
}

/** Gövde: { items: [{ key, productId, sample }] } — aynı anahtar üzerine yazar. */
export async function POST(req: Request) {
  try {
    initCloudinary();
    const body = (await req.json()) as {
      items?: { key?: string; productId?: string; sample?: string }[];
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
      if (!key) continue;
      const productId = str(raw.productId);
      const prev = byKey.get(key);
      if (prev && prev.productId === productId) continue;
      byKey.set(key, {
        key,
        productId,
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
      { error: (e as Error)?.message ?? "Eşleşmeler kaydedilemedi" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    initCloudinary();
    const url = new URL(req.url);
    const key = str(url.searchParams.get("key"));
    if (!key) return NextResponse.json({ error: "key gerekli" }, { status: 400 });
    const items = (await readEntries()).filter((e) => e.key !== key);
    await writeEntries(items);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Silinemedi" },
      { status: 500 },
    );
  }
}
