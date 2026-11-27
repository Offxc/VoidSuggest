import { deflateSync, crc32 } from "node:zlib";
import sharp from "sharp";

/** Pictures (and hostile files dressed as pictures) for the upload tests. */

const solid = (width: number, height: number, background = "#8164e3") => sharp({ create: { width, height, channels: 3, background } });

export const png = (width = 64, height = 48) => solid(width, height).png().toBuffer();
export const jpeg = (width = 64, height = 48) => solid(width, height).jpeg().toBuffer();
export const webp = (width = 64, height = 48) => solid(width, height).webp().toBuffer();

/** A photo as a phone makes it: rotated by a flag in its metadata, and carrying a name and a place. */
export const photoWithMetadata = () =>
  solid(200, 100)
    .jpeg()
    .withExif({ IFD0: { Copyright: "secret-owner-name", ImageDescription: "taken at 12 Private Road" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();

/** A genuine JPEG with a script and some PHP glued on after the end of the image. */
export async function polyglot(): Promise<Buffer> {
  return Buffer.concat([await jpeg(), Buffer.from("<script>alert('xss')</script><?php system($_GET['c']); ?>")]);
}

export const html = () => Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");
export const svg = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>');

export const gif = () => Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** A PNG header claiming a huge size (by default 12,000 by 12,000 pixels, 144 million) with almost no data: a decompression bomb. */
export function pixelBomb(width = 12_000, height = 12_000): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(1000))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An animated WebP with two frames. */
export async function animatedWebp(): Promise<Buffer> {
  const frame = (colour: string) => solid(32, 32, colour).raw().toBuffer();
  const raw = Buffer.concat([await frame("#ff0000"), await frame("#0000ff")]);
  return sharp(raw, { raw: { width: 32, height: 64, channels: 3, pageHeight: 32 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
}
