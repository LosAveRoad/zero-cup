import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { createStudio, type StudioOptions } from './studio-renderer';
export interface ViewportHandle {
  snapshot(name: string): Promise<Blob>;
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
