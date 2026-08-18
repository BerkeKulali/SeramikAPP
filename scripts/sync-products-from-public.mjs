/**
 * App lists products from src/data/products.json (see /api/products).
 * New files under public/urunler do not appear until added here — run:
 *   npm run sync:products
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.join(__dirname, "..");
const root = path.join(cwd, "public/urunler");
const productsPath = path.join(cwd, "src/data/products.json");

const existing = JSON.parse(fs.readFileSync(productsPath, "utf8"));
const byImage = new Set(existing.map((p) => p.image.replace(/^\//, "")));

const exts = new Set([".png", ".jpg", ".jpeg", ".webp", ".PNG", ".JPG"]);
const files = [];

function walk(dir, rel = "") {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, r);
    else if (exts.has(path.extname(ent.name))) files.push(r);
  }
}
walk(root);

// Ondalıklı ebatlar da geçerli: 7.5x15, 5x30 ...
const sizePattern = /^\d+(?:[.,]\d+)?[x*-]\d+(?:[.,]\d+)?$/i;
const missing = [];

function slug(s) {
  return s
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "urun";
}

for (const rel of files) {
  const norm = rel.split(path.sep).join("/");
  if (byImage.has(`urunler/${norm}`)) continue;

  const parts = norm.split("/");
  let brand, size, base;
  if (parts.length >= 3 && sizePattern.test(parts[1])) {
    brand = parts[0];
    // Klasör adı büyük/küçük harf veya virgüllü olabilir: 30X60, 7,5x15 ...
    size = parts[1].toLowerCase().replace(",", ".").replace(/[*-]/, "x");
    base = parts.slice(2).join("/");
  } else if (parts.length === 2) {
    brand = parts[0];
    size = "katalog";
    base = parts[1];
  } else {
    console.error("Unexpected path (need brand/size/file or brand/file):", norm);
    process.exit(1);
  }

  const name = base.replace(/\.[^.]+$/, "");
  const idBase = `${brand}-${size}-${slug(base)}`;
  let id = idBase;
  let n = 0;
  const ids = new Set(existing.map((p) => p.id));
  while (ids.has(id) || missing.some((m) => m.id === id)) {
    n += 1;
    id = `${idBase}-${n}`;
  }

  missing.push({
    id,
    name,
    brand,
    size,
    image: `/urunler/${norm}`,
  });
}

missing.sort((a, b) => a.image.localeCompare(b.image, "en"));
const merged = existing.concat(missing);

fs.writeFileSync(productsPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
console.log(
  `[sync-products] ${merged.length} products in JSON; added ${missing.length} from ${files.length} files under public/urunler`,
);
