import sharp from 'sharp';

export type PhotoMetadata = { capturedAt: string | null; place: { lat: number; lon: number } | null };

// Reads capture time and GPS from the original file before it is re-encoded (which drops all EXIF).
// Only the capture time and a coarse location (2 decimals, about 1 km) are kept; exact GPS is never stored.
export async function readPhotoMetadata(input: Buffer | string): Promise<PhotoMetadata> {
  try { return parseExif((await sharp(input, { limitInputPixels: 80_000_000 }).metadata()).exif); }
  catch { return { capturedAt: null, place: null }; }
}

export function parseExif(exif: Buffer | undefined): PhotoMetadata {
  const none: PhotoMetadata = { capturedAt: null, place: null };
  if (!exif || exif.length < 14) return none;
  // sharp returns the APP1 payload, which starts with "Exif\0\0" before the TIFF header.
  const start = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
  const tiff = exif.subarray(start);
  const order = tiff.subarray(0, 2).toString('latin1');
  if (order !== 'II' && order !== 'MM') return none;
  const le = order === 'II';
  const u16 = (o: number) => le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o);
  const u32 = (o: number) => le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o);
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  type Entry = { type: number; count: number; offset: number };
  function ifd(offset: number): Map<number, Entry> {
    const entries = new Map<number, Entry>();
    if (!offset || offset + 2 > tiff.length) return entries;
    const n = u16(offset);
    for (let i = 0; i < n; i++) {
      const at = offset + 2 + i * 12;
      if (at + 12 > tiff.length) break;
      const type = u16(at + 2), count = u32(at + 4);
      const size = (sizes[type] ?? 0) * count;
      const valueOffset = size <= 4 ? at + 8 : u32(at + 8);
      if (!size || valueOffset + size > tiff.length) continue;
      entries.set(u16(at), { type, count, offset: valueOffset });
    }
    return entries;
  }
  const text = (e?: Entry) => e && e.type === 2 ? tiff.subarray(e.offset, e.offset + e.count).toString('latin1').replace(/\0.*$/s, '').trim() : '';
  const rationals = (e?: Entry) => {
    if (!e || e.type !== 5) return [];
    return Array.from({ length: e.count }, (_, i) => { const d = u32(e.offset + i * 8 + 4); return d ? u32(e.offset + i * 8) / d : NaN; });
  };
  try {
    const ifd0 = ifd(u32(4));
    const exifIfd = ifd0.has(0x8769) ? ifd(u32(ifd0.get(0x8769)!.offset)) : new Map<number, Entry>();
    const gps = ifd0.has(0x8825) ? ifd(u32(ifd0.get(0x8825)!.offset)) : new Map<number, Entry>();
    // DateTimeOriginal, then DateTimeDigitized, then the file's DateTime.
    const raw = text(exifIfd.get(0x9003)) || text(exifIfd.get(0x9004)) || text(ifd0.get(0x0132));
    const offset = text(exifIfd.get(0x9011)) || text(exifIfd.get(0x9012)) || text(exifIfd.get(0x9010));
    return { capturedAt: exifDateTime(raw, offset), place: coarsePlace(text(gps.get(1)), rationals(gps.get(2)), text(gps.get(3)), rationals(gps.get(4))) };
  } catch { return none; }
}

// EXIF times are local wall-clock time ("YYYY:MM:DD HH:MM:SS"); the offset is kept when the camera recorded one.
export function exifDateTime(raw: string, offset = ''): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  const check = new Date(`${iso}Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 19) !== iso || m[1] === '0000') return null;
  return /^[+-]\d{2}:\d{2}$/.test(offset) ? iso + offset : iso;
}

function coarsePlace(latRef: string, lat: number[], lonRef: string, lon: number[]) {
  if (lat.length < 3 || lon.length < 3 || ![...lat, ...lon].every(Number.isFinite)) return null;
  const degrees = (v: number[], negative: boolean) => (negative ? -1 : 1) * (v[0] + v[1] / 60 + v[2] / 3600);
  const round = (v: number) => Math.round(v * 100) / 100;
  const result = { lat: round(degrees(lat, latRef === 'S')), lon: round(degrees(lon, lonRef === 'W')) };
  if (Math.abs(result.lat) > 90 || Math.abs(result.lon) > 180 || (result.lat === 0 && result.lon === 0)) return null;
  return result;
}
