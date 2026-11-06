// 照片落盘目录（STORAGE_DIR）的可写性探测。容器以 node 用户运行，目录必须在镜像里建好并归 node（infra/Dockerfile），
// 或挂命名卷；否则 mkdir/writeFile 会失败。启动时探测一次只打警告（不阻止启动：学生仍可用键盘/手写），
// 请求时再失败则返回 503，而不是 500。
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';

export type StorageProbe = { ok: true } | { ok: false; error: string };

export async function probeStorageDir(dir: string): Promise<StorageProbe> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await access(dir, constants.W_OK);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
