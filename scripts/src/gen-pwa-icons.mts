// Regenerate Lyra PWA icons from the source SVGs.
// Run: pnpm --filter @workspace/scripts run gen-pwa-icons
//
// Outputs to artifacts/lyrics-viewer/public/pwa-icons/:
//   - icon-192.png        (any-purpose, 192x192)
//   - icon-512.png        (any-purpose, 512x512)
//   - maskable-192.png    (maskable,    192x192)
//   - maskable-512.png    (maskable,    512x512)
//   - apple-touch-icon.png (180x180, used by iOS Safari for "Add to Home Screen")
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const sourceDir = resolve(repoRoot, "artifacts/lyrics-viewer/src/assets/pwa-source");
const outDir = resolve(repoRoot, "artifacts/lyrics-viewer/public/pwa-icons");

async function rasterise(svgPath: string, size: number, outName: string): Promise<void> {
  const svg = await readFile(svgPath);
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(outDir, outName), png);
  console.log(`  wrote ${outName} (${size}x${size}, ${png.length} bytes)`);
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const iconSrc = resolve(sourceDir, "icon.svg");
  const maskableSrc = resolve(sourceDir, "maskable.svg");

  console.log("Generating PWA icons...");
  await rasterise(iconSrc, 192, "icon-192.png");
  await rasterise(iconSrc, 512, "icon-512.png");
  await rasterise(maskableSrc, 192, "maskable-192.png");
  await rasterise(maskableSrc, 512, "maskable-512.png");
  // Apple touch icon: iOS Safari uses this for "Add to Home Screen".
  // Use the rounded-square (non-maskable) source so the corners look right on iOS.
  await rasterise(iconSrc, 180, "apple-touch-icon.png");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
