import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProductDto = {
  id: string;
  name: string;
  brand: string;
  size: string;
  image: string;
};

function isImageFile(name: string) {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function encodeSegment(seg: string) {
  // encodeURIComponent uses %20 for spaces; we keep / separators out by encoding per segment.
  return encodeURIComponent(seg);
}

async function walkRecursive(
  absDir: string,
  relParts: string[] = [],
): Promise<Array<{ relParts: string[]; filename: string }>> {
  const out: Array<{ relParts: string[]; filename: string }> = [];
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      out.push(
        ...(await walkRecursive(path.join(absDir, e.name), [...relParts, e.name])),
      );
    } else if (e.isFile() && isImageFile(e.name)) {
      out.push({ relParts, filename: e.name });
    }
  }
  return out;
}

export async function GET() {
  const publicDir = path.join(process.cwd(), "public");
  const candidates: Array<{ absRoot: string; urlPrefix: string }> = [
    {
      absRoot: path.join(publicDir, "images", "products"),
      urlPrefix: "/images/products",
    },
    {
      absRoot: path.join(publicDir, "ürünler"),
      urlPrefix: "/ürünler",
    },
  ];

  console.log("Tarama başladı...");

  let items: Array<{ relParts: string[]; filename: string }> = [];
  let urlPrefix = "/images/products";
  try {
    let picked: { absRoot: string; urlPrefix: string } = candidates[0]!;
    for (const c of candidates) {
      try {
        await fs.access(c.absRoot);
        picked = c;
        break;
      } catch {
        // try next
      }
    }
    urlPrefix = picked.urlPrefix;
    items = await walkRecursive(picked.absRoot);
  } catch {
    items = [];
  }

  const products: ProductDto[] = items.map((x) => {
    const nameNoExt = x.filename.replace(/\.[^/.]+$/, "");
    const size = x.relParts[x.relParts.length - 1] ?? "";
    const brand = x.relParts[x.relParts.length - 2] ?? "";

    const encodedPath =
      urlPrefix + "/" + [...x.relParts, x.filename].map(encodeSegment).join("/");

    const idBase = `${brand}-${size}-${x.filename}`;
    return {
      id: slugify(idBase) || idBase,
      name: nameNoExt,
      brand,
      size,
      image: encodedPath,
    };
  });

  console.log("Toplam", products.length, "ürün bulundu.");

  return NextResponse.json(products, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

