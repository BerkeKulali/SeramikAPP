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

type CloudFolder = { name?: string; path?: string };

/** Root klasörleri + her birinin bir alt seviye klasörlerini düz liste olarak döndürür. */
export async function GET() {
  try {
    initCloudinary();

    const root = (await cloudinary.api.root_folders()) as {
      folders?: CloudFolder[];
    };
    const rootFolders = Array.isArray(root.folders) ? root.folders : [];

    const all: { name: string; path: string }[] = [];
    for (const f of rootFolders) {
      const path = String(f.path ?? "").trim();
      const name = String(f.name ?? path).trim();
      if (!path) continue;
      all.push({ name, path });
      try {
        const sub = (await cloudinary.api.sub_folders(path)) as {
          folders?: CloudFolder[];
        };
        for (const s of sub.folders ?? []) {
          const sp = String(s.path ?? "").trim();
          const sn = String(s.name ?? sp).trim();
          if (sp) all.push({ name: `${name}/${sn}`, path: sp });
        }
      } catch {
        // alt klasör okunamazsa sadece root ile devam et
      }
    }

    return NextResponse.json({ folders: all });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message ?? "Folder list failed" },
      { status: 500 },
    );
  }
}
