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

export async function GET() {
  try {
    initCloudinary();

    const result = await cloudinary.search
      .expression(`folder:${FOLDER} AND resource_type:image`)
      .sort_by("created_at", "desc")
      .max_results(60)
      .execute();

    const items = Array.isArray(result?.resources)
      ? result.resources.map((r: any) => ({
          publicId: String(r.public_id ?? ""),
          url: String(r.secure_url ?? r.url ?? ""),
          originalFilename: String(r.original_filename ?? ""),
          bytes: typeof r.bytes === "number" ? r.bytes : null,
          width: typeof r.width === "number" ? r.width : null,
          height: typeof r.height === "number" ? r.height : null,
          createdAt: String(r.created_at ?? ""),
        }))
      : [];

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

    const uploaded = await cloudinary.uploader.upload(dataUri, {
      folder: FOLDER,
      resource_type: "image",
      use_filename: true,
      unique_filename: true,
    });

    return NextResponse.json({
      publicId: uploaded.public_id,
      url: uploaded.secure_url,
      originalFilename: uploaded.original_filename ?? "",
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

