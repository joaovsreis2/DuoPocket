'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const iconDir = path.join(root, 'assets', 'icons');
const source = path.join(iconDir, 'app-icon.svg');
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  await fs.mkdir(iconDir, { recursive: true });
  const pngs = [];

  for (const size of sizes) {
    const target = path.join(iconDir, `app-${size}.png`);
    await sharp(source).resize(size, size).png().toFile(target);
    pngs.push(target);
  }

  const pngToIcoModule = await import('png-to-ico');
  const pngToIco = pngToIcoModule.default || pngToIcoModule;
  const ico = await pngToIco(pngs);
  await fs.writeFile(path.join(iconDir, 'app.ico'), ico);
  process.stdout.write(`Ícones gerados em ${iconDir}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
