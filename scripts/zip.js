/*
 * A minimal zip writer for one file (no dependencies): deflate with the browser's CompressionStream("deflate-raw"),
 * CRC-32, one local file header, one central directory entry, end of central directory. No Foundry globals (unit
 * tested in Node and checked with the unzip CLI).
 */

let crcTable = null;

/** CRC-32 (IEEE) of bytes. */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Whether this browser can write zips (CompressionStream with deflate-raw). */
export function canZip() {
  try {
    return typeof CompressionStream === "function" && !!new CompressionStream("deflate-raw");
  } catch {
    return false;
  }
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** MS-DOS time and date fields of a Date (local time, as zip tools expect). */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

/**
 * A zip archive holding one file. `data` is a string (written as UTF-8) or bytes. Returns the archive bytes, or null
 * when CompressionStream is missing (the caller falls back to the plain file).
 */
export async function zipOneFile(name, data, date = new Date()) {
  if (!canZip()) return null;
  const raw = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const nameBytes = new TextEncoder().encode(name);
  const deflated = await deflateRaw(raw);
  const crc = crc32(raw);
  const { time, date: day } = dosDateTime(date);
  const FLAG_UTF8 = 0x0800;

  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);              // version needed
  local.setUint16(6, FLAG_UTF8, true);
  local.setUint16(8, 8, true);               // deflate
  local.setUint16(10, time, true);
  local.setUint16(12, day, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, deflated.length, true);
  local.setUint32(22, raw.length, true);
  local.setUint16(26, nameBytes.length, true);
  local.setUint16(28, 0, true);              // extra length

  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);            // version made by
  central.setUint16(6, 20, true);            // version needed
  central.setUint16(8, FLAG_UTF8, true);
  central.setUint16(10, 8, true);
  central.setUint16(12, time, true);
  central.setUint16(14, day, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, deflated.length, true);
  central.setUint32(24, raw.length, true);
  central.setUint16(28, nameBytes.length, true);
  // extra, comment, disk, internal and external attributes, local header offset: all 0
  const centralOffset = 30 + nameBytes.length + deflated.length;
  const centralSize = 46 + nameBytes.length;

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);                 // entries on this disk
  end.setUint16(10, 1, true);                // entries in total
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralOffset, true);

  const out = new Uint8Array(centralOffset + centralSize + 22);
  let at = 0;
  for (const part of [new Uint8Array(local.buffer), nameBytes, deflated, new Uint8Array(central.buffer), nameBytes, new Uint8Array(end.buffer)]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
