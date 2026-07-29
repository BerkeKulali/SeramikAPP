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

const SALES_PUBLIC_ID = "banner-studio/sales/sales-log.json";

export type SaleRecord = {
  id: string;
  date: string; // YYYY-MM-DD
  productName: string;
  brand: string;
  size: string;
  quantity: number; // m2
  unitPrice: number;
  total: number;
  customer: string;
  note: string;
  source: "form" | "banner";
  createdAt: string; // ISO
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

/** Cloudinary'deki raw JSON'u sürüm bazlı (bayat CDN'e takılmadan) okur. */
async function readSalesLog(): Promise<SaleRecord[]> {
  try {
    const resource = (await cloudinary.api.resource(SALES_PUBLIC_ID, {
      resource_type: "raw",
    })) as { secure_url?: string };
    const url = String(resource.secure_url ?? "");
    if (!url) return [];
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? (data as SaleRecord[]) : [];
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
}

async function writeSalesLog(sales: SaleRecord[]): Promise<void> {
  const json = JSON.stringify(sales, null, 2);
  const dataUri =
    "data:application/json;base64," + Buffer.from(json).toString("base64");
  await cloudinary.uploader.upload(dataUri, {
    resource_type: "raw",
    public_id: SALES_PUBLIC_ID,
    overwrite: true,
    invalidate: true,
  });
}

function num(v: unknown): number {
  const n =
    typeof v === "number"
      ? v
      : parseFloat(String(v ?? "").replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function GET() {
  try {
    initCloudinary();
    const sales = await readSalesLog();
    sales.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    return NextResponse.json(
      { items: sales },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Sales read failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    initCloudinary();
    const body = (await req.json()) as
      | Partial<SaleRecord>
      | { items?: Partial<SaleRecord>[] };

    const incoming: Partial<SaleRecord>[] = Array.isArray(
      (body as { items?: Partial<SaleRecord>[] }).items,
    )
      ? (body as { items: Partial<SaleRecord>[] }).items
      : [body as Partial<SaleRecord>];

    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const cleaned: SaleRecord[] = incoming
      .map((raw, i): SaleRecord => {
        const quantity = num(raw.quantity);
        const unitPrice = num(raw.unitPrice);
        const total =
          raw.total != null && num(raw.total) > 0
            ? num(raw.total)
            : Math.round(quantity * unitPrice * 100) / 100;
        return {
          id:
            str(raw.id) ||
            `${Date.now().toString(36)}-${i}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
          date: str(raw.date) || today,
          productName: str(raw.productName),
          brand: str(raw.brand),
          size: str(raw.size),
          quantity,
          unitPrice,
          total,
          customer: str(raw.customer),
          note: str(raw.note),
          source: raw.source === "banner" ? "banner" : "form",
          createdAt: str(raw.createdAt) || now.toISOString(),
        };
      })
      .filter((s) => s.productName || s.customer || s.total > 0);

    if (cleaned.length === 0) {
      return NextResponse.json(
        { error: "Kaydedilecek geçerli satış yok" },
        { status: 400 },
      );
    }

    const current = await readSalesLog();
    const next = [...current, ...cleaned];
    await writeSalesLog(next);

    return NextResponse.json({ added: cleaned.length, items: next });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Sales write failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    initCloudinary();
    const body = (await req.json()) as Partial<SaleRecord> & { id?: string };
    const id = str(body.id);
    if (!id) {
      return NextResponse.json({ error: "id gerekli" }, { status: 400 });
    }

    const current = await readSalesLog();
    const idx = current.findIndex((s) => s.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Kayıt bulunamadı" }, { status: 404 });
    }

    const existing = current[idx];
    const quantity =
      body.quantity != null ? num(body.quantity) : existing.quantity;
    const unitPrice =
      body.unitPrice != null ? num(body.unitPrice) : existing.unitPrice;
    const customer =
      body.customer != null ? str(body.customer) : existing.customer;
    const total = Math.round(quantity * unitPrice * 100) / 100;

    const updated: SaleRecord = {
      ...existing,
      quantity,
      unitPrice,
      total,
      customer,
    };

    const next = [...current];
    next[idx] = updated;
    await writeSalesLog(next);

    return NextResponse.json({ item: updated, items: next });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Sales update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    initCloudinary();
    const url = new URL(req.url);
    const id = str(url.searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "id gerekli" }, { status: 400 });
    }
    const current = await readSalesLog();
    const next = current.filter((s) => s.id !== id);
    await writeSalesLog(next);
    return NextResponse.json({ removed: current.length - next.length, items: next });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Sales delete failed" },
      { status: 500 },
    );
  }
}
