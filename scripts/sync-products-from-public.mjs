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
/** Ebat klasöründe olmadığı için eklenemeyen dosyalar. */
const unsized = [];
/** size alanı yolla çelişen, düzeltilen kayıtlar. */
const repaired = [];

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
  } else {
    // Ebat klasörü yoksa ürünü UYDURMA. Eskiden size:"katalog" yazılıyordu;
    // o kayıtlar hiçbir ebat filtresine düşmediği için uygulamada
    // seçilemez hâlde kalıyordu. Bildir ve atla — dosya doğru ebat
    // klasörüne taşınınca kendiliğinden girer.
    unsized.push(norm);
    continue;
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

// Mevcut kayıtların ebadı yoluyla çelişiyorsa yoldan düzelt: iki kayıt
// 60x60 klasöründe durduğu hâlde size:"katalog" ile yazılmıştı.
for (const p of existing) {
  const seg = String(p.image || "").replace(/^\//, "").split("/");
  if (seg.length >= 4 && seg[0] === "urunler" && sizePattern.test(seg[2])) {
    const fromPath = seg[2].toLowerCase().replace(",", ".").replace(/[*-]/, "x");
    if (p.size !== fromPath) {
      repaired.push(`${p.id}: ${p.size} -> ${fromPath}`);
      p.size = fromPath;
    }
  }
}

// Görseli diskte olmayan kayıtları BİLDİR (silme — klasör geçici olarak
// bağlı olmayabilir). Dosya taşındığında eski kayıt burada görünür.
const orphans = existing.filter(
  (p) => !fs.existsSync(path.join(cwd, "public", String(p.image || "").replace(/^\//, ""))),
);

missing.sort((a, b) => a.image.localeCompare(b.image, "en"));
const merged = existing.concat(missing);

fs.writeFileSync(productsPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
console.log(
  `[sync-products] ${merged.length} products in JSON; added ${missing.length} from ${files.length} files under public/urunler`,
);
if (repaired.length) {
  console.log(`[sync-products] ebatı yoldan düzeltilen ${repaired.length} kayıt:`);
  for (const r of repaired) console.log(`   ${r}`);
}
if (orphans.length) {
  console.log(
    `\n[sync-products] GÖRSELİ BULUNAMAYAN ${orphans.length} kayıt (silinmedi):`,
  );
  for (const o of orphans) console.log(`   ${o.id}  ->  ${o.image}`);
}
if (unsized.length) {
  console.log(
    `\n[sync-products] EBAT KLASÖRÜ OLMAYAN ${unsized.length} dosya eklenmedi.`,
  );
  console.log("  Bunları marka/EBAT/dosya.png biçiminde bir klasöre taşı:");
  for (const u of unsized) console.log(`   public/urunler/${u}`);
}
