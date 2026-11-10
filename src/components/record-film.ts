import { FILM_DURATION_MS, FILM_HEIGHT, FILM_WIDTH } from './exhibition-film';

const FRAME_RATE = 30;
const FORMATS = [
  { mimeType: 'video/mp4;codecs=avc1.42001f', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
] as const;

export class FilmError extends Error {}

class FilmEncodingError extends FilmError {
  constructor(message = '视频编码失败，请重试。') {
    super(message);
  }
}

export interface FilmOptions {
  name: string;
  multipleScenes: boolean;
  signal: AbortSignal;
  onProgress: (percent: number) => void;
}

export async function recordFilm(
  options: FilmOptions,
  preview: HTMLDivElement,
  draw: (ctx: CanvasRenderingContext2D, elapsed: number) => void,
) {
  const canvas = document.createElement('canvas');
  const [format, fallback] =
    typeof MediaRecorder !== 'undefined' &&
    typeof canvas.captureStream === 'function'
      ? FORMATS.filter(({ mimeType }) =>
          MediaRecorder.isTypeSupported(mimeType),
        )
      : [];
  if (!format) {
    throw new FilmError(
      '当前浏览器不支持录制视频，请使用桌面版 Chrome 或 Edge。',
    );
  }

  canvas.width = FILM_WIDTH;
  canvas.height = FILM_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new FilmError('无法创建视频画布，请重试。');

  const encode = async (candidate: (typeof FORMATS)[number]) => ({
    blob: await encodeFilm(ctx, candidate.mimeType, options, draw),
    extension: candidate.extension,
  });

  canvas.className = 'film-preview';
  canvas.setAttribute('aria-hidden', 'true');
  preview.appendChild(canvas);
  try {
    return await encode(format);
  } catch (error) {
    if (!(error instanceof FilmEncodingError) || !fallback) throw error;
    options.onProgress(0);
    return await encode(fallback);
  } finally {
    canvas.remove();
    canvas.width = canvas.height = 0;
  }
}

async function encodeFilm(
  ctx: CanvasRenderingContext2D,
  mimeType: string,
  { signal, onProgress }: FilmOptions,
  draw: (ctx: CanvasRenderingContext2D, elapsed: number) => void,
): Promise<Blob> {
  signal.throwIfAborted();
  const stream = ctx.canvas.captureStream(FRAME_RATE);
  let recorder: MediaRecorder | undefined;

  try {
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000,
      });
    } catch {
      throw new FilmEncodingError();
    }
    const encoder = recorder;

    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      let frame = 0;
      let stopTimeout = 0;
      let finished = false;
      let lastFrame = -Infinity;
      let lastPercent = 0;
      let started = 0;

      function cleanup() {
        cancelAnimationFrame(frame);
        window.clearTimeout(stopTimeout);
        document.removeEventListener('visibilitychange', visibilityChanged);
        signal.removeEventListener('abort', abort);
        encoder.ondataavailable = encoder.onerror = encoder.onstop = null;
      }

      function fail(error: unknown) {
        cleanup();
        reject(error);
      }

      function abort() {
        fail(signal.reason);
      }

      function visibilityChanged() {
        if (document.hidden) {
          fail(
            new FilmError('页面切到了后台，视频生成已停止。请留在此页面重试。'),
          );
        }
      }

      const tick = (now: number) => {
        const elapsed = Math.max(0, now - started);
        try {
          if (elapsed >= FILM_DURATION_MS) {
            encoder.stop();
            finished = true;
            onProgress(100);
            stopTimeout = window.setTimeout(
              () => fail(new FilmEncodingError('视频编码超时，请重试。')),
              5000,
            );
            return;
          }
          if (elapsed - lastFrame >= 1000 / FRAME_RATE - 3) {
            draw(ctx, elapsed);
            lastFrame = elapsed;
            const percent =
              Math.floor((100 * elapsed) / FILM_DURATION_MS / 5) * 5;
            if (percent !== lastPercent) {
              lastPercent = percent;
              onProgress(percent);
            }
          }
          frame = requestAnimationFrame(tick);
        } catch (error) {
          fail(error);
        }
      };

      encoder.ondataavailable = ({ data }) => {
        if (data.size) chunks.push(data);
      };
      encoder.onerror = () => fail(new FilmEncodingError());
      encoder.onstop = () => {
        cleanup();
        if (!finished || chunks.length === 0) {
          reject(new FilmEncodingError('视频录制未完成，请重试。'));
          return;
        }
        resolve(new Blob(chunks, { type: mimeType }));
      };
      document.addEventListener('visibilitychange', visibilityChanged);
      signal.addEventListener('abort', abort, { once: true });
      if (document.hidden) {
        visibilityChanged();
        return;
      }

      try {
        draw(ctx, 0);
        try {
          encoder.start();
        } catch {
          throw new FilmEncodingError();
        }
        started = performance.now();
        frame = requestAnimationFrame(tick);
      } catch (error) {
        fail(error);
      }
    });
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
  }
}
