import { useEffect, useRef, useState } from 'react';
import { Viewport, type ViewportHandle } from './components/Viewport';
import { CameraPanel } from './components/CameraPanel';
import { ChallengePanel } from './components/ChallengePanel';
import { FiringPanel } from './components/FiringPanel';
import { ProfileEditor } from './components/ProfileEditor';
import { ToolPanel } from './components/ToolPanel';
import {
  getChallenge,
  silhouetteScore,
  type ChallengeId,
} from './core/challenges/challenges';
import {
  createProfile,
  moveControlPoint,
  type ProfileTemplateId,
} from './core/geometry/profile';
import {
  FIRING_DURATION_MS,
  firingStage,
  glazeProgress,
} from './core/materials/glaze';
import type { PaintingAction, PaintTool } from './types/artwork';
import {
  canRedo,
  canUndo,
  createHistory,
  pushAction,
  redoAction,
  undoAction,
  visibleActions,
} from './core/painting/history';
import type { StampAssetId } from './core/painting/stamps';
import type { CameraPresetId } from './core/export/capture';
import {
  deleteArtwork,
  listGallery,
  saveArtwork,
  StorageError,
  type DamagedRecord,
} from './storage/library';
import type { StudioArtworkV2 } from './types/artwork';

type Stage = 'shaping' | 'painting' | 'firing' | 'exhibition';
const stages: Stage[] = ['shaping', 'painting', 'firing', 'exhibition'];
const labels = ['拉坯', '彩绘', '烧制', '成品'];
const PROFILE_TEMPLATES: ProfileTemplateId[] = [
  'bottle',
  'meiping',
  'cup',
  'melon',
];
function ArtworkCard({
  artwork,
  onOpen,
  onDelete,
  disabled,
}: {
  disabled: boolean;
  artwork: StudioArtworkV2;
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
  const [history, setHistory] = useState(createHistory);
  const [stage, setStage] = useState<Stage>('shaping');
  const [painting, setPainting] = useState(true);
  const [tool, setTool] = useState<PaintTool>('brush');
  const [brushSize, setBrushSize] = useState(24);
  const [color, setColor] = useState('#174a94');
  const [stampAssetId, setStampAssetId] = useState<StampAssetId>('lotus');
  const [stampScale, setStampScale] = useState(1);
  const [stampRotation, setStampRotation] = useState(0);
  const [challengeId, setChallengeId] = useState<ChallengeId | undefined>(
    undefined,
  );
  const [preset, setPreset] = useState<CameraPresetId>('front');
  const [glaze, setGlaze] = useState(0);
  const [firingProgress, setFiringProgress] = useState(0);
  const [name, setName] = useState('我的第一件青花瓷');
  const [notice, setNotice] = useState('拖动二维轮廓点，开始塑造你的器型。');
  const [gallery, setGallery] = useState<StudioArtworkV2[]>([]);
  const [damaged, setDamaged] = useState<DamagedRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const viewport = useRef<ViewportHandle>(null);
  const currentId = useRef<string>(crypto.randomUUID());
  const visible = visibleActions(history);
  const challenge = challengeId ? getChallenge(challengeId) : undefined;
  const score = challenge ? silhouetteScore(profile, challenge.profile) : 0;
  const refreshGallery = () =>
    listGallery().then((listing) => {
      setGallery(listing.artworks);
      setDamaged(listing.damaged);
    });
  useEffect(() => {
    void refreshGallery().catch(() =>
      setNotice('本地作品库不可用，你仍可创作并下载图片。'),
    );
  }, []);
  useEffect(() => {
    if (stage !== 'firing') return;
    let frame = 0;
    let finished = false;
    const started = performance.now();
    const tick = () => {
      const progress = glazeProgress(
        performance.now() - started,
        FIRING_DURATION_MS,
      );
      setGlaze(progress);
      setFiringProgress(progress);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      if (finished) return;
      finished = true;
      setStage('exhibition');
      setNotice('烧制完成！为作品命名，下载或保存。');
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stage]);
  function addAction(action: PaintingAction) {
    setHistory((old) => pushAction(old, action));
    // Scale and rotation belong to one stamp only.
    if (action.type === 'STAMP') {
      setStampScale(1);
      setStampRotation(0);
    }
  }
  function reset() {
    if (!window.confirm('新建会放弃未保存的修改，继续吗？')) return;
    setProfile(createProfile());
    setName('我的第一件青花瓷');
    setPainting(true);
    setTool('brush');
    setHistory(createHistory());
    setStage('shaping');
    setGlaze(0);
    setFiringProgress(0);
    setChallengeId(undefined);
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
      const texture = await viewport.current!.texture();
      await saveArtwork({
        version: 2,
        id: currentId.current,
        name: name.trim() || '未命名作品',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        profile,
        actions: visible,
        image,
        texture,
        challengeId,
        score: challenge ? score : undefined,
      });
      await refreshGallery();
      setNotice('作品已保存到此浏览器，刷新后仍可打开。');
    } catch (error) {
      setNotice(
        error instanceof StorageError
          ? `保存失败：${error.userMessage}当前作品仍在，可重试或先下载图片。`
          : '保存失败：请检查浏览器存储空间，或先下载图片。',
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!window.confirm('删除此本地作品？')) return;
    try {
      await deleteArtwork(id);
      await refreshGallery();
      setNotice('作品已删除。');
    } catch (error) {
      setNotice(
        error instanceof StorageError
          ? `删除失败：${error.userMessage}`
          : '删除失败，请重试。',
      );
    }
  }
  function open(artwork: StudioArtworkV2) {
    if (!window.confirm('打开作品会替换当前未保存的修改，继续吗？')) return;
    currentId.current = artwork.id;
    setProfile(artwork.profile);
    setHistory({
      actions: artwork.actions,
      cursor: artwork.actions.length,
    });
    setName(artwork.name);
    setChallengeId(
      (artwork.challengeId as ChallengeId | undefined) ?? undefined,
    );
    setStage('exhibition');
    setGlaze(1);
    setFiringProgress(1);
    setNotice('已恢复器型与完整彩绘。');
  }
  return (
    <div className="app">
      <header>
        <div>
          <span className="eyebrow">PORCELAIN TALES / 青花瓷数字工坊</span>
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
              <p>拖动二维轮廓点塑形，或用滑块微调半径。</p>
              <ProfileEditor
                points={profile}
                onChange={setProfile}
                templates={PROFILE_TEMPLATES}
                onReset={() => setProfile(createProfile())}
              />
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
                          moveControlPoint(old, p.id, {
                            radius: Number(e.target.value),
                          }),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <ChallengePanel
                challenge={challenge}
                onChallengeChange={setChallengeId}
                score={challenge ? score : undefined}
                onApplyTarget={() => {
                  if (challenge) setProfile(challenge.profile);
                }}
              />
              <button
                className="sticky-action"
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
              <ToolPanel
                tool={tool}
                onToolChange={setTool}
                brushSize={brushSize}
                onBrushSizeChange={setBrushSize}
                color={color}
                onColorChange={setColor}
                stampAssetId={stampAssetId}
                onStampAssetChange={setStampAssetId}
                stampScale={stampScale}
                onStampScaleChange={setStampScale}
                stampRotation={stampRotation}
                onStampRotationChange={setStampRotation}
              />
              <div className="segmented">
                <button
                  disabled={!canUndo(history)}
                  onClick={() => setHistory(undoAction)}
                >
                  撤销
                </button>
                <button
                  disabled={!canRedo(history)}
                  onClick={() => setHistory(redoAction)}
                >
                  重做
                </button>
              </div>
              <p className="muted">
                已落笔 {history.cursor} 次 · 可撤销最近 20 步
              </p>
              <button
                className="sticky-action"
                onClick={() => {
                  setGlaze(0);
                  setFiringProgress(0);
                  setStage('firing');
                  setNotice('窑火升温中，请稍候……');
                }}
              >
                入窑烧制
              </button>
            </>
          )}
          {stage === 'firing' && (
            <FiringPanel
              progress={firingProgress}
              stage={firingStage(firingProgress)}
            />
          )}
          {stage === 'exhibition' && (
            <>
              <p>拖动查看成品。作品只保存在当前浏览器。</p>
              <CameraPanel
                preset={preset}
                onPresetChange={setPreset}
                disabled={busy}
              />
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
                onClick={() => {
                  setGlaze(0);
                  setFiringProgress(0);
                  setStage('painting');
                }}
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
            actions={visible}
            glaze={glaze}
            painting={stage === 'painting' && painting}
            tool={tool}
            brushSize={brushSize}
            color={color}
            stampAssetId={stampAssetId}
            stampScale={stampScale}
            stampRotation={stampRotation}
            preset={preset}
            onAction={addAction}
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
        {damaged.length > 0 && (
          <p className="muted">
            有 {damaged.length} 件旧作品无法读取，已隔离保存，不影响其它作品。
          </p>
        )}
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
      <footer>拉坯、彩绘、烧制、拍照与本地存档已连通；细分为后续增量。</footer>
    </div>
  );
}
