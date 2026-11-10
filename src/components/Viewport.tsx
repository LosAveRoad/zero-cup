import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { createStudio, type StudioOptions } from './studio-renderer';
import type { FilmOptions, recordFilm } from './record-film';
export interface ViewportHandle {
  snapshot(name: string): Promise<Blob>;
  video(options: FilmOptions): ReturnType<typeof recordFilm>;
  texture(): Promise<Blob>;
  frontU(): number;
}
export const Viewport = forwardRef<ViewportHandle, StudioOptions>(
  function Viewport(options, ref) {
    const host = useRef<HTMLDivElement>(null);
    const studio = useRef<ReturnType<typeof createStudio>>();
    const [error, setError] = useState('');
    useEffect(() => {
      try {
        studio.current = createStudio(host.current!);
      } catch {
        setError('无法启动 WebGL。请启用浏览器硬件加速后刷新。');
      }
      return () => {
        studio.current?.dispose();
        studio.current = undefined;
      };
    }, []);
    useEffect(() => {
      studio.current?.update(options);
    }, [options]);
    useImperativeHandle(
      ref,
      () => ({
        snapshot: async (name) => {
          if (!studio.current) throw new Error('三维视口尚未就绪');
          return studio.current.snapshot(name);
        },
        video: async (options) => {
          if (!studio.current) throw new Error('三维视口尚未就绪');
          return studio.current.video(options);
        },
        texture: async () => {
          if (!studio.current) throw new Error('三维视口尚未就绪');
          return studio.current.texture();
        },
        frontU: () => studio.current?.frontU() ?? 0.125,
      }),
      [],
    );
    return (
      <div className="viewport" ref={host}>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  },
);
