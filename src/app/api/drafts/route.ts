import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

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

const DRAFTS_DIR = "banner-studio/drafts";
const INDEX_ID = `${DRAFTS_DIR}/index.json`;

type DraftSummary = {
  id: string;
  title: string;
  savedAt: string;
  size: string;
  manufacturer: string;
  productNames: string[];
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

async function readRawJson<T>(publicId: string, fallback: T): Promise<T> {
  try {
    const resource = (await cloudinary.api.resource(publicId, {
      resource_type: "raw",
    })) as { secure_url?: string };
    const url = String(resource.secure_url ?? "");
    if (!url) return fallback;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return fallback;
    const data = await r.json();
    return (data ?? fallback) as T;
  } catch (e) {
    if (isNotFound(e)) return fallback;
    throw e;
  }
}

async function writeRawJson(publicId: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  const dataUri =
    "data:application/json;base64," + Buffer.from(json).toString("base64");
  await cloudinary.uploader.upload(dataUri, {
    resource_type: "raw",
    public_id: publicId,
    overwrite: true,
    invalidate: true,
  });
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET(req: Request) {
  try {
    initCloudinary();
    const url = new URL(req.url);
    const id = str(url.searchParams.get("id"));

    if (id) {
      const draft = await readRawJson<Record<string, unknown> | null>(
        `${DRAFTS_DIR}/${id}.json`,
        null,
      );
      if (!draft) {
        return NextResponse.json({ error: "Bulunamadı" }, { status: 404 });
      }
      return NextResponse.json({ draft });
    }

    const index = await readRawJson<DraftSummary[]>(INDEX_ID, []);
    const items = Array.isArray(index) ? index : [];
    items.sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Drafts read failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    initCloudinary();
    const body = (await req.json()) as {
      id?: string;
      title?: string;
      size?: string;
      manufacturer?: string;
      productNames?: string[];
      draft?: unknown;
    };

    if (!body || typeof body.draft !== "object" || body.draft === null) {
      return NextResponse.json({ error: "draft gerekli" }, { status: 400 });
    }

    const id = str(body.id) || makeId();
    const summary: DraftSummary = {
      id,
      title: str(body.title) || "Afiş",
      savedAt: new Date().toISOString(),
      size: str(body.size),
      manufacturer: str(body.manufacturer),
      productNames: Array.isArray(body.productNames)
        ? body.productNames.map(str).filter(Boolean)
        : [],
    };

    // Tam draft'ı yaz
    await writeRawJson(`${DRAFTS_DIR}/${id}.json`, body.draft);

    // Index'i güncelle (aynı id varsa değiştir)
    const index = await readRawJson<DraftSummary[]>(INDEX_ID, []);
    const list = (Array.isArray(index) ? index : []).filter((x) => x.id !== id);
    list.push(summary);
    await writeRawJson(INDEX_ID, list);

    list.sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
    return NextResponse.json({ id, items: list });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Draft save failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    initCloudinary();
    const url = new URL(req.url);
    const id = str(url.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "id gerekli" }, { status: 400 });

    try {
      await cloudinary.uploader.destroy(`${DRAFTS_DIR}/${id}.json`, {
        resource_type: "raw",
        invalidate: true,
      });
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }

    const index = await readRawJson<DraftSummary[]>(INDEX_ID, []);
    const list = (Array.isArray(index) ? index : []).filter((x) => x.id !== id);
    await writeRawJson(INDEX_ID, list);

    list.sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
    return NextResponse.json({ items: list });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Draft delete failed" },
      { status: 500 },
    );
  }
}
