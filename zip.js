// Minimal ZIP (STORE, no compression) builder in JS. Produces a valid
// .zip with one entry; the zip is rebuilt per download with a fresh random
// comment, so the served file's SHA-256 differs every time (same trick the
// PHP build used: rotate the bytes, not just the name).
(function () {
  function crc32(buf) {
    let table = crc32.table;
    if (!table) {
      table = crc32.table = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
    }
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ (-1)) >>> 0;
  }
  function u16(v){ return [v & 255, (v >>> 8) & 255]; }
  function u32(v){ return [v & 255, (v>>>8)&255, (v>>>16)&255, (v>>>24)&255]; }

  // buildZip(zipName, innerName, innerBytes, comment) -> Uint8Array
  window.buildZip = function (zipName, innerName, innerBytes, comment) {
    const enc = new TextEncoder();
    const nameB = enc.encode(innerName);
    const crc = crc32(innerBytes);
    const size = innerBytes.length;

    // Local file header
    const lfh = new Uint8Array([
      0x50,0x4B,0x03,0x04,  // sig
      ...u16(20),           // version needed (2.0)
      ...u16(0x0800),       // flags: bit 11 (data descriptor) so size at EOCD/central
      ...u16(0),            // method 0 = store
      ...u16(0), ...u16(0), // mod time/date (0)
      ...u32(crc),
      ...u32(size),         // compressed size
      ...u32(size),         // uncompressed size
      ...u16(nameB.length), ...u16(0), // name len, extra len
    ]);
    // Central directory header
    const cdh = new Uint8Array([
      0x50,0x4B,0x01,0x02,
      ...u16(20),           // version made by
      ...u16(20),           // version needed
      ...u16(0x0800),       // flags
      ...u16(0),            // method store
      ...u16(0), ...u16(0), // time/date
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameB.length), ...u16(0), ...u16(0), // name/extra/comment len
      ...u16(0), ...u16(0), // disk start, internal attr
      ...u32(0),            // external attr
      ...u32(0),            // local header offset
    ]);
    const cdSize = cdh.length + nameB.length;
    const lfhSize = lfh.length + nameB.length;
    const commentB = enc.encode(comment || "");

    const total = lfhSize + size + cdSize + 22 + commentB.length;
    const out = new Uint8Array(total);
    let o = 0;
    out.set(lfh, o); o += lfh.length;
    out.set(nameB, o); o += nameB.length;
    out.set(innerBytes, o); o += size;            // file data
    // central directory
    const cdOff = o;
    out.set(cdh, o); o += cdh.length;
    out.set(nameB, o); o += nameB.length;
    // EOCD
    out.set([0x50,0x4B,0x05,0x06, 0,0, 0,0], o); o += 8;
    out.set(u16(1), o); o += 2;   // entries on disk
    out.set(u16(1), o); o += 2;   // total entries
    out.set(u32(cdSize), o); o += 4;
    out.set(u32(cdOff), o); o += 4;
    out.set(u16(commentB.length), o); o += 2;
    if (commentB.length) { out.set(commentB, o); o += commentB.length; }
    return out;
  };
})();
