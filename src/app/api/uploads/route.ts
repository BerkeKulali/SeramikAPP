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

const FOLDER = "banner-studio/uploads";

function slugifyUploadBase(filename: string): string {
  const base = filename.replace(/\.[^/.]+$/, "").trim() || "gorsel";
  let s = base
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) s = "gorsel";
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/, "");
  return s;
}

function displayNameForResource(r: {
  original_filename?: string;
  public_id?: string;
}): string {
  const orig = String(r.original_filename ?? "").trim();
  if (orig) return orig;
  const pid = String(r.public_id ?? "");
  const seg = pid.split("/").pop() || pid;
  return seg || "gorsel";
}

function isPublicIdConflict(err: unknown): boolean {
  const msg = String(
    (err as { error?: { message?: string } })?.error?.message ??
      (err as Error)?.message ??
      "",
  ).toLowerCase();
  return (
    msg.includes("already exists") ||
    msg.includes("resource with given public id") ||
    (msg.includes("public id") && msg.includes("exists"))
  );
}

/** List images whose public_id starts with prefix (Admin API). Search API `folder:` does not match public_id paths like `banner-studio/uploads/foo`. */
async function listImageResourcesByPrefix(prefix: string): Promise<any[]> {
  const all: any[] = [];
  let next_cursor: string | undefined;
  const maxPerPage = 200;
  for (let page = 0; page < 10; page++) {
    const batch: {
      resources?: any[];
      next_cursor?: string;
    } = await new Promise((resolve, reject) => {
      cloudinary.api.resources(
        {
          type: "upload",
          resource_type: "image",
          prefix,
          max_results: maxPerPage,
          ...(next_cursor ? { next_cursor } : {}),
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result as { resources?: any[]; next_cursor?: string });
        },
      );
    });
    if (Array.isArray(batch.resources)) all.push(...batch.resources);
    next_cursor = batch.next_cursor;
    if (!next_cursor) break;
  }
  all.sort((a, b) => {
    const ta = new Date(String(a.created_at ?? 0)).getTime();
    const tb = new Date(String(b.created_at ?? 0)).getTime();
    return tb - ta;
  });
  return all;
}

export async function GET() {
  try {
    initCloudinary();

    const resources = await listImageResourcesByPrefix(FOLDER);
    const items = resources.map((r: any) => {
      const originalFilename = String(r.original_filename ?? "");
      const displayName = displayNameForResource({
        original_filename: originalFilename,
        public_id: r.public_id,
      });
      return {
        publicId: String(r.public_id ?? ""),
        url: String(r.secure_url ?? r.url ?? ""),
        originalFilename,
        displayName,
        bytes: typeof r.bytes === "number" ? r.bytes : null,
        width: typeof r.width === "number" ? r.width : null,
        height: typeof r.height === "number" ? r.height : null,
        createdAt: String(r.created_at ?? ""),
      };
    });

    return NextResponse.json({ folder: FOLDER, items });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Upload list failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    initCloudinary();

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    // Keep uploads reasonably sized for Vercel runtime.
    const maxBytes = 12 * 1024 * 1024;
    if (typeof file.size === "number" && file.size > maxBytes) {
      return NextResponse.json(
        { error: "File too large (max 12MB)" },
        { status: 413 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mime = file.type || "application/octet-stream";
    const dataUri = `data:${mime};base64,${base64}`;

    const clientName = file.name?.trim() || "upload";
    const slug = slugifyUploadBase(clientName);

    let uploaded: Awaited<ReturnType<typeof cloudinary.uploader.upload>> | null =
      null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const idPart = attempt === 0 ? slug : `${slug}-${attempt + 1}`;
      const publicId = `${FOLDER}/${idPart}`;
      try {
        uploaded = await cloudinary.uploader.upload(dataUri, {
          public_id: publicId,
          resource_type: "image",
          overwrite: false,
          filename_override: clientName,
          use_filename: false,
          unique_filename: false,
        });
        break;
      } catch (err) {
        if (isPublicIdConflict(err) && attempt < 24) continue;
        throw err;
      }
    }

    if (!uploaded) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const originalFilename =
      String(uploaded.original_filename ?? "").trim() || clientName;
    const displayName = displayNameForResource({
      original_filename: originalFilename,
      public_id: uploaded.public_id,
    });

    return NextResponse.json({
      publicId: uploaded.public_id,
      url: uploaded.secure_url,
      originalFilename: clientName,
      displayName,
      bytes: uploaded.bytes ?? null,
      width: uploaded.width ?? null,
      height: uploaded.height ?? null,
      createdAt: uploaded.created_at ?? "",
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Upload failed" },
      { status: 500 },
    );
  }
}

