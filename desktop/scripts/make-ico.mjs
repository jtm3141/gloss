// Wraps a PNG in the ICO container format (PNG-compressed entries are
// accepted by Windows Vista and later). No dependencies.
import { readFileSync, writeFileSync } from "node:fs";

const [pngPath, icoPath] = process.argv.slice(2);
if (!pngPath || !icoPath) {
  console.error("usage: node make-ico.mjs <input.png> <output.ico>");
  process.exit(1);
}

const png = readFileSync(pngPath);
if (png.readUInt32BE(0) !== 0x89504e47) {
  console.error("input is not a PNG");
  process.exit(1);
}
// IHDR: width/height are big-endian uint32 at offsets 16/20.
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== height || width > 256 || width < 16) {
  console.error(`expected a square PNG 16..256px, got ${width}x${height}`);
  process.exit(1);
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image

const entry = Buffer.alloc(16);
entry.writeUInt8(width === 256 ? 0 : width, 0);
entry.writeUInt8(height === 256 ? 0 : height, 1);
entry.writeUInt8(0, 2); // color count
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12); // offset of PNG data

writeFileSync(icoPath, Buffer.concat([header, entry, png]));
console.log(`wrote ${icoPath} (${width}x${height} PNG-compressed)`);
