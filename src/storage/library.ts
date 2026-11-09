/**
 * 加固后的作品库存储层（schema v2）。
 *
 * - 与 `src/storage/studio.ts` 共用同一个 IndexedDB 库 `porcelain-tales-studio`
 *   和对象仓库 `artworks`（键仍是作品 id），因此旧版 v1 作品可以直接读出，
 *   不需要另建一套作品库。
 * - 写入前先校验，写入失败时抛出带错误码的 `StorageError`；调用方据此提示用户，
 *   绝不吞掉配额/编码失败后假装保存成功。
 * - 读取时按版本迁移：v1 记录保留器型、全部笔划和成品图，迁移为 v2；
 *   损坏或版本未知的记录被隔离（不删除、不阻塞整个画廊）。
 *
 * 体积与压缩取舍（实测值，合成样本）：
 * - 1080×1080 成品 PNG：约 0.3–1.5 MB（照片级细节可能更大）。
 * - 2048×2048 彩绘纹理 PNG：约 0.6 MB 起，密集笔触可到 2 MB 以上。
 * - 命令历史：每条 20 点 BRUSH 约 0.6 KB，200 条约 125 KB（纯 JSON，量级很小）。
 * - 结论：单件作品的 2 MB 目标只有在“成品图 + 少量命令”时才成立。为了压体积而
 *   截断命令历史会直接丢失作品内容，因此本模块**永不丢弃命令**：体积压力只允许
 *   通过重新编码图片（PNG/WebP）、降低纹理分辨率或去掉冗余纹理副本来解决，
 *   命令历史与成品图始终完整保存。
 */
import { del, entries, get, set } from 'idb-keyval';
import type { UseStore } from 'idb-keyval';
import { brushAction } from '../core/painting/actions';
import type {
  LegacyStroke,
  PaintingAction,
  ProfileControlPoint,
  StudioArtworkV2,
  SymmetryCount,
  UVPoint,
} from '../types/artwork';

export const STUDIO_DB_NAME = 'porcelain-tales-studio';
export const STUDIO_STORE_NAME = 'artworks';

export type StorageErrorCode =
  | 'quota'
  | 'unavailable'
  | 'corrupt'
  | 'unknown-version'
  | 'encoding'
  | 'unknown';

const USER_MESSAGES: Record<StorageErrorCode, string> = {
  quota:
    '本地存储空间不足，这次保存没有完成。请删除旧作品腾出空间，或先导出图片再重试。你仍然可以继续创作并导出图片。',
  unavailable:
    '本地作品库当前不可用（可能处于隐私模式或被浏览器禁用）。你仍然可以继续创作并导出图片。',
  corrupt:
    '这条作品数据已损坏，无法读取。其它作品不受影响，你仍然可以继续创作和导出图片。',
  'unknown-version':
    '这条作品来自更新版本的应用，当前版本无法读取。你仍然可以继续创作并导出图片。',
  encoding:
    '作品数据无法写入本地存储，这次保存没有完成。请重试，或先导出图片备份。你仍然可以继续创作并导出图片。',
  unknown:
    '本地存储读写失败，这次操作没有完成。请重试，你仍然可以继续创作并导出图片。',
};

/** 存储层错误：带机器可读的错误码和一句用户能看懂的中文说明。 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  /** 面向用户的中文说明，不泄漏内部实现细节。 */
  readonly userMessage: string;

  constructor(code: StorageErrorCode, message: string) {
    // 错误码写进 message，日志里一眼能看出是哪一类失败。
    super(`[${code}] ${message}`);
    this.name = 'StorageError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
  }
}

/** 被隔离的坏记录：仍留在库里，但不出现在画廊列表中。 */
export interface DamagedRecord {
  id: string;
  reason: string;
  code: StorageErrorCode;
}

export interface GalleryListing {
  artworks: StudioArtworkV2[];
  damaged: DamagedRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBlobLike(value: unknown): value is Blob {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  return (
    isRecord(value) &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function' &&
    isFiniteNumber((value as { size?: unknown }).size)
  );
}

function corrupt(reason: string): StorageError {
  return new StorageError('corrupt', reason);
}

function unknownVersion(): StorageError {
  return new StorageError('unknown-version', '作品版本不受支持');
}

/** 打开数据库的连接缓存；打开失败后清空缓存，保证下一次调用可以重试。 */
let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(
        new StorageError('unavailable', 'IndexedDB is not available here'),
      );
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(STUDIO_DB_NAME);
    } catch (error) {
      reject(toStorageError(error, '打开本地作品库失败'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STUDIO_STORE_NAME)) {
        db.createObjectStore(STUDIO_STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      database = null;
      reject(toStorageError(request.error, '打开本地作品库失败'));
    };
    request.onblocked = () => {
      database = null;
      reject(
        new StorageError(
          'unavailable',
          '本地作品库被其它标签页占用，暂时无法访问',
        ),
      );
    };
  });
  database.catch(() => {
    database = null;
  });
  return database;
}

/**
 * 与 `idb-keyval` 的 `createStore` 等价，但自己打开连接以便识别
 * “被占用/不可用”的情况，并保证与 studio.ts 落在同一个对象仓库上。
 */
const studioStore: UseStore = <T>(
  txMode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => T | PromiseLike<T>,
): Promise<T> =>
  openDatabase().then((db) =>
    callback(
      db.transaction(STUDIO_STORE_NAME, txMode).objectStore(STUDIO_STORE_NAME),
    ),
  );

function toStorageError(error: unknown, fallback: string): StorageError {
  if (error instanceof StorageError) return error;
  const name =
    isRecord(error) && typeof error.name === 'string' ? error.name : '';
  const legacyCode =
    isRecord(error) && isFiniteNumber(error.code) ? error.code : 0;
  const describe = (code: StorageErrorCode) =>
    new StorageError(code, name ? `${fallback}（${name}）` : fallback);
  switch (name) {
    case 'QuotaExceededError':
      return describe('quota');
    case 'DataCloneError':
      return describe('encoding');
    case 'SecurityError':
    case 'InvalidStateError':
    case 'VersionError':
    case 'NotFoundError':
      return describe('unavailable');
    case 'UnknownError':
    case 'AbortError':
      return describe('unknown');
    default:
      break;
  }
  if (legacyCode === 22) return describe('quota');
  if (legacyCode === 18) return describe('unavailable');
  return describe('unknown');
}

/** 同一 id 的写入串行化，避免并发保存互相覆盖。 */
const writeQueues = new Map<string, Promise<unknown>>();

function withIdLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(id) ?? Promise.resolve();
  const result = previous.then(task, task);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(id, settled);
  void settled.then(() => {
    if (writeQueues.get(id) === settled) writeQueues.delete(id);
  });
  return result;
}

function validateProfile(raw: unknown): ProfileControlPoint[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw corrupt('器型数据缺失');
  }
  return raw.map((point) => {
    if (!isRecord(point)) throw corrupt('器型数据损坏');
    const { id, height, radius } = point;
    if (typeof id !== 'string' || id.length === 0) {
      throw corrupt('器型数据损坏');
    }
    if (!isFiniteNumber(height) || height < 0 || height > 1) {
      throw corrupt('器型高度无效');
    }
    if (!isFiniteNumber(radius) || radius <= 0 || radius > 1) {
      throw corrupt('器型半径无效');
    }
    return { id, height, radius };
  });
}

function validatePath(raw: unknown): UVPoint[] {
  if (!Array.isArray(raw)) throw corrupt('笔划路径损坏');
  return raw.map((point) => {
    if (!isRecord(point)) throw corrupt('笔划路径损坏');
    const { u, v } = point;
    if (!isFiniteNumber(u) || !isFiniteNumber(v)) {
      throw corrupt('笔划坐标无效');
    }
    return { u, v };
  });
}

function parseSymmetry(raw: unknown): SymmetryCount | undefined {
  if (raw === 2 || raw === 4 || raw === 6 || raw === 8) return raw;
  return undefined;
}

function validateActions(raw: unknown): PaintingAction[] {
  if (!Array.isArray(raw)) throw corrupt('彩绘命令缺失');
  return raw.map((action) => {
    if (!isRecord(action)) throw corrupt('彩绘命令损坏');
    switch (action.type) {
      case 'BRUSH': {
        const path = validatePath(action.path);
        if (typeof action.color !== 'string') throw corrupt('画笔颜色无效');
        if (
          !isFiniteNumber(action.opacity) ||
          action.opacity < 0 ||
          action.opacity > 1
        ) {
          throw corrupt('画笔浓度无效');
        }
        if (!isFiniteNumber(action.size) || action.size <= 0) {
          throw corrupt('画笔粗细无效');
        }
        const symmetry = parseSymmetry(action.symmetry);
        return {
          type: 'BRUSH',
          path,
          color: action.color,
          opacity: action.opacity,
          size: action.size,
          ...(symmetry ? { symmetry } : {}),
        };
      }
      case 'STAMP': {
        if (!isFiniteNumber(action.u) || !isFiniteNumber(action.v)) {
          throw corrupt('印章坐标无效');
        }
        if (typeof action.assetId !== 'string' || action.assetId.length === 0) {
          throw corrupt('印章资源无效');
        }
        if (typeof action.color !== 'string') throw corrupt('印章颜色无效');
        if (!isFiniteNumber(action.scale) || action.scale <= 0) {
          throw corrupt('印章缩放无效');
        }
        if (!isFiniteNumber(action.rotation)) throw corrupt('印章旋转无效');
        const symmetry = parseSymmetry(action.symmetry);
        return {
          type: 'STAMP',
          u: action.u,
          v: action.v,
          assetId: action.assetId,
          color: action.color,
          scale: action.scale,
          rotation: action.rotation,
          ...(symmetry ? { symmetry } : {}),
        };
      }
      case 'ERASE': {
        const path = validatePath(action.path);
        if (!isFiniteNumber(action.size) || action.size <= 0) {
          throw corrupt('橡皮擦粗细无效');
        }
        return { type: 'ERASE', path, size: action.size };
      }
      default:
        throw corrupt('未知的彩绘命令类型');
    }
  });
}

function validateImage(raw: unknown): Blob {
  if (!isBlobLike(raw)) throw corrupt('成品图片缺失');
  return raw;
}

/**
 * 校验并规范化一条 v2 记录。
 * 字段不合法时抛出 `StorageError('corrupt')`；版本无法识别时抛出
 * `StorageError('unknown-version')`（v1 请走 `migrateArtwork`）。
 */
export function validateArtwork(raw: unknown): StudioArtworkV2 {
  if (!isRecord(raw)) throw corrupt('作品数据不是对象');
  if (raw.version !== 2) {
    if (raw.version === 1) throw corrupt('记录不是 v2 结构');
    throw unknownVersion();
  }
  const { id, name } = raw;
  if (typeof id !== 'string' || id.length === 0) {
    throw corrupt('作品缺少 id');
  }
  if (typeof name !== 'string') throw corrupt('作品名称无效');
  if (!isFiniteNumber(raw.createdAt)) throw corrupt('作品创建时间无效');
  const createdAt = raw.createdAt;
  const updatedAt = isFiniteNumber(raw.updatedAt)
    ? Math.max(raw.updatedAt, createdAt)
    : createdAt;
  const artwork: StudioArtworkV2 = {
    version: 2,
    id,
    name,
    createdAt,
    updatedAt,
    profile: validateProfile(raw.profile),
    actions: validateActions(raw.actions),
    image: validateImage(raw.image),
  };
  if (raw.texture !== undefined) artwork.texture = validateImage(raw.texture);
  if (raw.challengeId !== undefined) {
    if (typeof raw.challengeId !== 'string') throw corrupt('挑战标识无效');
    artwork.challengeId = raw.challengeId;
  }
  if (raw.score !== undefined) {
    if (!isFiniteNumber(raw.score)) throw corrupt('挑战分数无效');
    artwork.score = raw.score;
  }
  return artwork;
}

function validateLegacyStrokes(raw: unknown): LegacyStroke[] {
  if (!Array.isArray(raw)) throw corrupt('旧版笔划数据缺失');
  return raw.map((stroke) => {
    if (!isRecord(stroke)) throw corrupt('旧版笔划数据损坏');
    if (!isFiniteNumber(stroke.size) || stroke.size <= 0) {
      throw corrupt('旧版笔划粗细无效');
    }
    if (typeof stroke.color !== 'string') throw corrupt('旧版笔划颜色无效');
    return {
      points: validatePath(stroke.points),
      size: stroke.size,
      color: stroke.color,
    };
  });
}

/**
 * 接受 v1 或 v2 记录，返回合法的 v2 记录。
 * v1 → v2 保留器型、每一条笔划（转成 BRUSH 命令）和成品图，`updatedAt = createdAt`。
 * 版本无法识别时抛出 `StorageError('unknown-version')`，数据损坏时抛出
 * `StorageError('corrupt')`。
 */
export function migrateArtwork(raw: unknown): StudioArtworkV2 {
  if (!isRecord(raw)) throw corrupt('作品数据不是对象');
  if (raw.version === 2) return validateArtwork(raw);
  if (raw.version !== 1) throw unknownVersion();
  const { id, name } = raw;
  if (typeof id !== 'string' || id.length === 0) throw corrupt('作品缺少 id');
  if (typeof name !== 'string') throw corrupt('作品名称无效');
  if (!isFiniteNumber(raw.createdAt)) throw corrupt('作品创建时间无效');
  const createdAt = raw.createdAt;
  const strokes = validateLegacyStrokes(raw.strokes);
  const actions = strokes.map((stroke) =>
    brushAction(stroke.points, {
      size: stroke.size,
      color: stroke.color,
      opacity: 1,
    }),
  );
  return validateArtwork({
    version: 2,
    id,
    name,
    createdAt,
    updatedAt: createdAt,
    profile: raw.profile,
    actions,
    image: raw.image,
  });
}

async function readRaw(id: string): Promise<unknown> {
  try {
    return await get<unknown>(id, studioStore);
  } catch (error) {
    throw toStorageError(error, '读取作品失败');
  }
}

function resolveCreatedAt(existing: unknown, fallback: number): number {
  if (
    isRecord(existing) &&
    isFiniteNumber(existing.createdAt) &&
    existing.createdAt > 0
  ) {
    return existing.createdAt;
  }
  return fallback;
}

function resolveStoredUpdatedAt(existing: unknown): number {
  if (isRecord(existing) && isFiniteNumber(existing.updatedAt)) {
    return existing.updatedAt;
  }
  return 0;
}

/**
 * 保存一件作品。
 *
 * - 写入前先校验，非法数据不会落库（v1 输入会先迁移成 v2 再落库）。
 * - 同一 id 重复保存时保留库里原有的 `createdAt`。
 * - `updatedAt` 由存储层统一盖章：取“当前时间”，并保证严格大于库里上一次的
 *   `updatedAt`（同一毫秒内连存两次也能分出先后）。调用方传入的 `updatedAt`
 *   只用于读取时的规范化，保存时会被当前时间覆盖。
 * - 配额不足映射为 `StorageError('quota')`，存储不可用映射为
 *   `StorageError('unavailable')`，数据无法克隆映射为 `StorageError('encoding')`。
 *   这些失败都可重试，且不会清空调用方当前的作品。
 */
export async function saveArtwork(artwork: StudioArtworkV2): Promise<void> {
  const validated = migrateArtwork(artwork);
  await withIdLock(validated.id, async () => {
    const existing = await readRaw(validated.id);
    const createdAt = resolveCreatedAt(existing, validated.createdAt);
    const updatedAt = Math.max(
      Date.now(),
      resolveStoredUpdatedAt(existing) + 1,
    );
    const record: StudioArtworkV2 = { ...validated, createdAt, updatedAt };
    try {
      await set(record.id, record, studioStore);
    } catch (error) {
      throw toStorageError(error, '保存作品失败');
    }
  });
}

/**
 * 读取一件作品；库里没有时返回 `undefined`。
 * v1 记录会在读取时迁移成 v2（不改动库里的原始数据，下次保存时由调用方写回 v2）。
 * 记录损坏或版本未知时抛出 `StorageError`。
 */
export async function getArtwork(
  id: string,
): Promise<StudioArtworkV2 | undefined> {
  const raw = await readRaw(id);
  if (raw === undefined || raw === null) return undefined;
  return migrateArtwork(raw);
}

/** 删除一件作品；记录不存在时也不报错。 */
export async function deleteArtwork(id: string): Promise<void> {
  await withIdLock(id, async () => {
    try {
      await del(id, studioStore);
    } catch (error) {
      throw toStorageError(error, '删除作品失败');
    }
  });
}

/**
 * 列出画廊：好作品按创建时间从新到旧排列，坏记录被隔离到 `damaged`。
 * 单条坏记录不会让整个列表失败；只有数据库本身不可用时才会抛错。
 *
 * `damaged` 里的记录仍然保留在库里（不会自动删除用户数据），`id` 就是它在
 * 对象仓库中的键，可以直接交给 `deleteArtwork` 让用户手动清理。
 */
export async function listGallery(): Promise<GalleryListing> {
  let rows: [IDBValidKey, unknown][];
  try {
    rows = await entries<IDBValidKey, unknown>(studioStore);
  } catch (error) {
    throw toStorageError(error, '读取作品库失败');
  }
  const artworks: StudioArtworkV2[] = [];
  const damaged: DamagedRecord[] = [];
  for (const [key, raw] of rows) {
    try {
      artworks.push(migrateArtwork(raw));
    } catch (error) {
      const storageError = toStorageError(error, '读取作品失败');
      damaged.push({
        id: String(key),
        reason: storageError.message,
        code: storageError.code,
      });
    }
  }
  artworks.sort(
    (a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt,
  );
  return { artworks, damaged };
}

/** 把字节数写成人类可读的体积，例如 `1.2 MB`。 */
export function describeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
