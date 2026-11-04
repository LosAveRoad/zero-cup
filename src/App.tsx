import { useEffect, useRef, useState } from 'react';
import { Viewport, type ViewportHandle } from './components/Viewport';
import { createProfile } from './core/geometry/profile';
import { appendStroke, type Stroke } from './core/painting/strokes';
import {
  deleteArtwork,
  listArtworks,
  saveArtwork,
  type StudioArtwork,
} from './storage/studio';

type Stage = 'shaping' | 'painting' | 'firing' | 'exhibition';
const stages: Stage[] = ['shaping', 'painting', 'firing', 'exhibition'];
const labels = ['拉坯', '彩绘', '烧制', '成品'];
function ArtworkCard({
  artwork,
  onOpen,
  onDelete,
  disabled,
}: {
  disabled: boolean;
  artwork: StudioArtwork;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(artwork.image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [artwork.image]);
  return (
    <article className="artwork">
      <img src={url} alt={artwork.name} />
      <h3>{artwork.name}</h3>
      <button disabled={disabled} onClick={onOpen}>
        打开作品
      </button>
      <button disabled={disabled} className="quiet" onClick={onDelete}>
        删除
      </button>
    </article>
  );
}
export function App() {
  const [profile, setProfile] = useState(createProfile);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [cursor, setCursor] = useState(0);
  const [stage, setStage] = useState<Stage>('shaping');
  const [painting, setPainting] = useState(true);
  const [brushSize, setBrushSize] = useState(24);
  const [color, setColor] = useState('#174a94');
  const [name, setName] = useState('我的第一件青花瓷');
  const [notice, setNotice] = useState('拖动左侧滑块，开始塑造你的器型。');
  const [gallery, setGallery] = useState<StudioArtwork[]>([]);
  const [busy, setBusy] = useState(false);
  const viewport = useRef<ViewportHandle>(null);
  const currentId = useRef<string>(crypto.randomUUID());
  const visible = strokes.slice(0, cursor);
  useEffect(() => {
    void listArtworks()
      .then(setGallery)
      .catch(() => setNotice('本地作品库不可用，你仍可创作并下载图片。'));
  }, []);
  useEffect(() => {
    if (stage !== 'firing') return;
    const timer = setTimeout(() => {
      setStage('exhibition');
      setNotice('烧制完成！为作品命名，下载或保存。');
    }, 2500);
    return () => clearTimeout(timer);
  }, [stage]);
  function addStroke(stroke: Stroke) {
    setStrokes((old) => {
      const next = appendStroke(old, cursor, stroke);
      setCursor(next.length);
      return next;
    });
  }
  function reset() {
    if (!window.confirm('新建会放弃未保存的修改，继续吗？')) return;
    setProfile(createProfile());
    setName('我的第一件青花瓷');
    setPainting(true);
    setStrokes([]);
    setCursor(0);
    setStage('shaping');
    currentId.current = crypto.randomUUID();
    setNotice('新作品已准备好。');
  }
  async function download() {
    setBusy(true);
    try {
      const blob = await viewport.current!.snapshot(name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'porcelain-tales.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('1080×1080 PNG 已导出。');
    } catch {
      setNotice('图片导出失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const image = await viewport.current!.snapshot(name);
      await saveArtwork({
        version: 1,
        id: currentId.current,
        name: name.trim() || '未命名作品',
        createdAt: Date.now(),
        profile,
        strokes: visible,
        image,
      });
      setGallery(await listArtworks());
      setNotice('作品已保存到此浏览器，刷新后仍可打开。');
    } catch {
      setNotice('保存失败：请检查浏览器存储空间，或先下载图片。');
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm('删除此本地作品？')) return;
    try {
      await deleteArtwork(id);
      setGallery(await listArtworks());
      setNotice('作品已删除。');
    } catch {
      setNotice('删除失败，请重试。');
    }
  }
  function open(artwork: StudioArtwork) {
    if (!window.confirm('打开作品会替换当前未保存的修改，继续吗？')) return;
    currentId.current = artwork.id;
    setProfile(artwork.profile);
    setStrokes(artwork.strokes);
    setCursor(artwork.strokes.length);
    setName(artwork.name);
    setStage('exhibition');
    setNotice('已恢复器型与完整彩绘。');
  }
  return (
    <div className="app">
      <header>
        <div>
          <span className="eyebrow">PORCELAIN TALES / 可运行基础版</span>
          <h1>瓷器物语</h1>
        </div>
        <button
          className="quiet"
          disabled={stage === 'firing' || busy}
          onClick={reset}
        >
          新建作品
        </button>
      </header>
      <nav aria-label="制作阶段">
        {labels.map((label, i) => (
          <span
            key={label}
            aria-current={stages[i] === stage ? 'step' : undefined}
          >
            <b>0{i + 1}</b> {label}
          </span>
        ))}
      </nav>
      <div className="workspace">
        <aside>
          <h2>{labels[stages.indexOf(stage)]}工作台</h2>
          {stage === 'shaping' && (
            <>
              <p>调整八个截面半径，右侧实时旋转成型。</p>
              <div className="sliders">
                {[...profile].reverse().map((p) => (
                  <label key={p.id}>
                    截面 {Number(p.id.split('-')[1]) + 1}
                    <input
                      aria-label={`截面 ${Number(p.id.split('-')[1]) + 1} 半径`}
                      type="range"
                      min="0.08"
                      max="0.9"
                      step="0.01"
                      value={p.radius}
                      onChange={(e) =>
                        setProfile((old) =>
                          old.map((point) =>
                            point.id === p.id
                              ? { ...point, radius: Number(e.target.value) }
                              : point,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                onClick={() => {
                  setStage('painting');
                  setNotice('在器物上按住左键绘制，切换旋转模式查看另一面。');
                }}
              >
                定型进入彩绘
              </button>
            </>
          )}
          {stage === 'painting' && (
            <>
              <p>在器物表面画线；切换视角后可继续画另一面。</p>
              <div className="segmented">
                <button
                  aria-pressed={painting}
                  onClick={() => setPainting(true)}
                >
                  绘制模式
                </button>
                <button
                  aria-pressed={!painting}
                  onClick={() => setPainting(false)}
                >
                  旋转视角
                </button>
              </div>
              <label>
                笔刷粗细
                <select
                  aria-label="笔刷粗细"
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                >
                  <option value={12}>细</option>
                  <option value={24}>中</option>
                  <option value={48}>粗</option>
                </select>
              </label>
              <label>
                青花浓度
                <select
                  aria-label="青花浓度"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                >
                  <option value="#174a94">浓青</option>
                  <option value="#547fb2">中青</option>
                  <option value="#9ab6d5">淡青</option>
                </select>
              </label>
              <div className="segmented">
                <button
                  disabled={cursor === 0 || cursor <= strokes.length - 20}
                  onClick={() => setCursor(cursor - 1)}
                >
                  撤销
                </button>
                <button
                  disabled={cursor === strokes.length}
                  onClick={() => setCursor(cursor + 1)}
                >
                  重做
                </button>
              </div>
              <p className="muted">已落笔 {cursor} 次 · 可撤销最近 20 步</p>
              <button
                onClick={() => {
                  setStage('firing');
                  setNotice('窑火升温中，请稍候……');
                }}
              >
                入窑烧制
              </button>
            </>
          )}
          {stage === 'firing' && (
            <div className="firing">
              <span>◉</span>
              <h3>窑火正盛</h3>
              <p>正在为青花覆上一层亮釉……</p>
            </div>
          )}
          {stage === 'exhibition' && (
            <>
              <p>拖动查看成品。作品只保存在当前浏览器。</p>
              <label>
                作品名称
                <input
                  aria-label="作品名称"
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button disabled={busy} onClick={() => void download()}>
                下载 PNG
              </button>
              <button disabled={busy} onClick={() => void save()}>
                保存到藏品
              </button>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => setStage('painting')}
              >
                继续彩绘
              </button>
            </>
          )}
        </aside>
        <section className="scene" aria-label="创作视口">
          <Viewport
            ref={viewport}
            profile={profile}
            strokes={visible}
            fired={stage === 'exhibition'}
            painting={stage === 'painting' && painting}
            brushSize={brushSize}
            color={color}
            onStroke={addStroke}
          />
          <div className="scene-hint">
            {stage === 'painting' && painting
              ? '左键绘制 · 旋转模式查看另一面'
              : '拖动旋转 · 滚轮缩放'}
          </div>
          {stage === 'firing' && <div className="fire-overlay" />}
        </section>
      </div>
      <p role="status" className="notice">
        {notice}
      </p>
      <section className="gallery">
        <div className="gallery-heading">
          <h2>我的藏瓷阁</h2>
          <span>本地收藏 / {gallery.length}</span>
        </div>
        {gallery.length === 0 ? (
          <p className="muted">完成第一件作品，存入你的藏瓷阁。</p>
        ) : (
          <div className="gallery-grid">
            {gallery.map((a) => (
              <ArtworkCard
                key={a.id}
                artwork={a}
                disabled={busy || stage === 'firing'}
                onOpen={() => open(a)}
                onDelete={() => void remove(a.id)}
              />
            ))}
          </div>
        )}
      </section>
      <footer>
        基础版已打通创作闭环；二维轮廓拖拽、印章、橡皮擦、挑战和精细材质将基于此逐步完善。
      </footer>
    </div>
  );
}
