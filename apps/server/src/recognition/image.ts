// 照片上传的最小校验：只认 JPEG / PNG 的魔数，并读出宽高（存 app.photos，不解码像素）。
export type ImageKind = { mime: 'image/jpeg' | 'image/png'; ext: 'jpg' | 'png'; w: number | null; h: number | null };

export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length >= 24 && buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { mime: 'image/png', ext: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    // 扫描 SOFn 段取宽高
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1] as number;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', ext: 'jpg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return { mime: 'image/jpeg', ext: 'jpg', w: null, h: null };
  }
  return null;
}
