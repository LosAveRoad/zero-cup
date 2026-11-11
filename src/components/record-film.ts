import { FILM_DURATION_MS, FILM_HEIGHT, FILM_WIDTH } from './exhibition-film';

// A 15 fps stream keeps the 720p timeline from shortening when scene rendering
// cannot sustain 24 fps (for example, software-rendered Chromium).
const FRAME_RATE = 15;
const FORMATS = [
  {
    mimeType: 'video/mp4;codecs=avc1.42001f',
    audioCodec: 'mp4a.40.2',
    extension: 'mp4',
  },
  { mimeType: 'video/webm;codecs=vp8', audioCodec: 'opus', extension: 'webm' },
] as const;

const soundtrackUrl = import.meta.env.DEV
  ? `${import.meta.env.BASE_URL}src/components/film-bgm.mp3`
  : undefined;

interface Soundtrack {
  context: AudioContext;
  buffer: AudioBuffer;
}

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
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof canvas.captureStream !== 'function'
  ) {
    throw new FilmError(
      '当前浏览器不支持录制视频，请使用桌面版 Chrome 或 Edge。',
    );
  }

  canvas.width = FILM_WIDTH;
  canvas.height = FILM_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new FilmError('无法创建视频画布，请重试。');

  canvas.className = 'film-preview';
  canvas.setAttribute('aria-hidden', 'true');
  preview.appendChild(canvas);
  let audioContext: AudioContext | undefined;
  try {
    let soundtrack: Soundtrack | undefined;
    if (soundtrackUrl) {
      audioContext = new AudioContext();
      soundtrack = await loadSoundtrack(
        audioContext,
        soundtrackUrl,
        options.signal,
      );
    }

    const [format, fallback] = FORMATS.map(
      ({ mimeType, audioCodec, extension }) => ({
        mimeType: soundtrack ? `${mimeType},${audioCodec}` : mimeType,
        extension,
      }),
    ).filter(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType));
    if (!format)
      throw new FilmError(
        '当前浏览器不支持录制视频，请使用桌面版 Chrome 或 Edge。',
      );

    const encode = async (candidate: NonNullable<typeof format>) => ({
      blob: await encodeFilm(
        ctx,
        candidate.mimeType,
        options,
        draw,
        soundtrack,
      ),
      extension: candidate.extension,
    });
    try {
      return await encode(format);
    } catch (error) {
      if (!(error instanceof FilmEncodingError) || !fallback) throw error;
      options.onProgress(0);
      return await encode(fallback);
    }
  } finally {
    canvas.remove();
    if (audioContext) void audioContext.close();
    canvas.width = canvas.height = 0;
  }
}

async function loadSoundtrack(
  context: AudioContext,
  url: string,
  jobSignal: AbortSignal,
): Promise<Soundtrack | undefined> {
  const visibility = new AbortController();
  const signal = AbortSignal.any([
    jobSignal,
    visibility.signal,
    AbortSignal.timeout(8000),
  ]);
  signal.throwIfAborted();

  const checkVisibility = () => {
    if (document.hidden) {
      visibility.abort(
        new FilmError('页面切到了后台，视频生成已停止。请留在此页面重试。'),
      );
    }
  };
  let abort: (() => void) | undefined;
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });

  document.addEventListener('visibilitychange', checkVisibility);
  try {
    checkVisibility();
    const ready = context.resume();
    const load = async () => {
      const response = await fetch(url, { signal });
      if (
        response.status === 404 ||
        response.headers.get('content-type')?.includes('text/html')
      ) {
        return undefined;
      }
      if (!response.ok) throw new Error('Soundtrack unavailable');
      const [, buffer] = await Promise.all([
        ready,
        response.arrayBuffer().then((bytes) => context.decodeAudioData(bytes)),
      ]);
      return { context, buffer };
    };
    // Missing local assets are allowed even if the audio context stays suspended.
    void ready.catch(() => {});
    return await Promise.race([load(), canceled]);
  } catch (error) {
    if (jobSignal.aborted || error instanceof FilmError) throw error;
    throw new FilmError('背景音乐载入失败，请刷新页面后重试。');
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    document.removeEventListener('visibilitychange', checkVisibility);
  }
}

async function encodeFilm(
  ctx: CanvasRenderingContext2D,
  mimeType: string,
  { signal, onProgress }: FilmOptions,
  draw: (ctx: CanvasRenderingContext2D, elapsed: number) => void,
  soundtrack: Soundtrack | undefined,
): Promise<Blob> {
  signal.throwIfAborted();
  const stream = ctx.canvas.captureStream(FRAME_RATE);
  let recorder: MediaRecorder | undefined;
  let musicSource: AudioBufferSourceNode | undefined;
  let gain: GainNode | undefined;
  let musicStarted = false;

  try {
    if (soundtrack) {
      const { context, buffer } = soundtrack;
      const audio = context.createMediaStreamDestination();
      gain = context.createGain();
      musicSource = context.createBufferSource();
      musicSource.buffer = buffer;
      musicSource.connect(gain);
      gain.connect(audio);
      gain.connect(context.destination);
      for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
    }

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
        if (soundtrack && musicSource && gain) {
          const now = soundtrack.context.currentTime;
          const end = now + FILM_DURATION_MS / 1000;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.8, now + 0.14);
          gain.gain.setValueAtTime(0.8, end - 1.35);
          gain.gain.linearRampToValueAtTime(0, end);
          musicSource.start(now);
          musicStarted = true;
        }
        started = performance.now();
        frame = requestAnimationFrame(tick);
      } catch (error) {
        fail(error);
      }
    });
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (musicStarted) musicSource?.stop();
    musicSource?.disconnect();
    gain?.disconnect();
    stream.getTracks().forEach((track) => track.stop());
  }
}
