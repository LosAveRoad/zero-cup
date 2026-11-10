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
  kilnTelemetryFor,
  type GlazeFinishId,
} from './core/materials/glaze';
import type {
  ExhibitionSceneId,
  PaintingAction,
  PaintTool,
  SymmetryCount,
} from './types/artwork';
import { stampAction } from './core/painting/actions';
import {
  canRedo,
  canUndo,
  createHistory,
  pushAction,
  redoAction,
  undoAction,
  visibleActions,
} from './core/painting/history';
import {
  createMasterpiecePreset,
  type MasterpiecePresetId,
} from './core/painting/strokes';
import type { StampAssetId } from './core/painting/stamps';
import type { CameraPresetId } from './core/export/capture';
import type { LightingPresetId } from './core/materials/lighting';
import {
  currentPorcelainMelodyTitle,
  playBrushSound,
  playKilnIgniteSound,
  playPorcelainChime,
  playPorcelainTapSound,
  playWheelTone,
  resetPorcelainMelody,
} from './components/sound-effects';
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

const KILN_EMBERS = Array.from({ length: 16 }, (_, i) => {
  const left = 14 + ((i * 19) % 72);
  const bottom = 2 + ((i * 7) % 24);
  const size = 4 + (i % 4);
  const duration = (1.9 + ((i * 5) % 8) * 0.16).toFixed(2);
  const delay = (-((i * 11) % 16) * 0.14).toFixed(2);
  const drift = ((i % 2 === 0 ? 1 : -1) * (10 + ((i * 7) % 14))).toFixed(0);
  return { id: i, left, bottom, size, duration, delay, drift };
});
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
  const [symmetry, setSymmetry] = useState<SymmetryCount>(1);
  const [ringBand, setRingBand] = useState(false);
  const [challengeId, setChallengeId] = useState<ChallengeId | undefined>(
    undefined,
  );
  const [preset, setPreset] = useState<CameraPresetId>('front');
  const [cameraRevision, setCameraRevision] = useState(0);
  const [lightPreset, setLightPreset] = useState<LightingPresetId>('studio');
  const [exhibitionScene, setExhibitionScene] =
    useState<ExhibitionSceneId>('neutral');
  const [glazeFinish, setGlazeFinish] = useState<GlazeFinishId>('white');
  const [autoRotate, setAutoRotate] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // The scroll prologue greets every visit; `?prologue=skip` is the explicit
  // opt-out used by automated checks so no test depends on browser internals.
  const [prologueDismissed, setPrologueDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    const params = new URLSearchParams(window.location.search);
    return params.get('prologue') === 'skip';
  });
  const [melodyTitle, setMelodyTitle] = useState(currentPorcelainMelodyTitle);
  const [glaze, setGlaze] = useState(0);
  const [firingProgress, setFiringProgress] = useState(0);
  const [name, setName] = useState('我的第一件青花瓷');
  const [notice, setNotice] = useState('拖动二维轮廓点，开始塑造你的器型。');
  const [gallery, setGallery] = useState<StudioArtworkV2[]>([]);
  const [damaged, setDamaged] = useState<DamagedRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const viewport = useRef<ViewportHandle>(null);
  const currentId = useRef<string>(crypto.randomUUID());
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);
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
      setMelodyTitle(resetPorcelainMelody());
      playPorcelainChime(soundEnabledRef.current);
      setStage('exhibition');
      setNotice('烧制完成！叩之声如磬，请为作品命名、赏析或收藏。');
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stage]);
  useEffect(() => {
    if (stage !== 'painting') return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA')
      )
        return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        setHistory(event.shiftKey ? redoAction : undoAction);
      } else if (key === 'y') {
        event.preventDefault();
        setHistory(redoAction);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stage]);
  function addAction(action: PaintingAction) {
    setHistory((old) => pushAction(old, action));
    playBrushSound(soundEnabled, action.type === 'STAMP');
    // Scale and rotation belong to one stamp only.
    if (action.type === 'STAMP') {
      setStampScale(1);
      setStampRotation(0);
    }
  }
  function applyMasterpiece(presetId: MasterpiecePresetId) {
    const presetActions = createMasterpiecePreset(presetId);
    setHistory((old) => {
      let next = old;
      for (const act of presetActions) {
        next = pushAction(next, act);
      }
      return next;
    });
    playBrushSound(soundEnabled, true);
    setNotice('已绘入传统名品青花纹饰，可继续添笔创作或直接入窑烧制。');
  }
  function imprintContourToVessel(customId: StampAssetId) {
    const targetU = viewport.current?.frontU() ?? 0.125;
    setHistory((old) =>
      pushAction(
        old,
        stampAction(targetU, 0.5, {
          assetId: customId,
          color,
          scale: stampScale,
          rotation: stampRotation,
          symmetry,
        }),
      ),
    );
    playBrushSound(soundEnabled, true);
    setNotice(
      '已提取图片轮廓并拓印于瓶身正中，也可在器物表面点击任意位置继续落印。',
    );
  }
  function reset() {
    if (!window.confirm('新建会放弃未保存的修改，继续吗？')) return;
    setProfile(createProfile());
    setName('我的第一件青花瓷');
    setPainting(true);
    setTool('brush');
    setSymmetry(1);
    setRingBand(false);
    setHistory(createHistory());
    setStage('shaping');
    setGlaze(0);
    setFiringProgress(0);
    setChallengeId(undefined);
    setPreset('front');
    setCameraRevision((rev) => rev + 1);
    setLightPreset('studio');
    setExhibitionScene('neutral');
    setGlazeFinish('white');
    setAutoRotate(false);
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
        glazeFinish,
        lightPreset,
        exhibitionScene,
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
  async function clearDamaged() {
    if (
      !window.confirm(
        `将永久删除 ${damaged.length} 条无法读取的记录，删除后无法恢复。继续吗？`,
      )
    )
      return;
    setBusy(true);
    try {
      for (const record of damaged) {
        await deleteArtwork(record.id);
      }
      await refreshGallery();
      setNotice('已清理无法读取的旧作品记录。');
    } catch {
      setNotice('清理失败，请重试。');
    } finally {
      setBusy(false);
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
      artwork.challengeId && getChallenge(artwork.challengeId)
        ? (artwork.challengeId as ChallengeId)
        : undefined,
    );
    setStage('exhibition');
    setGlaze(1);
    setFiringProgress(1);
    setGlazeFinish(artwork.glazeFinish ?? 'white');
    setLightPreset(artwork.lightPreset ?? 'studio');
    setExhibitionScene(artwork.exhibitionScene ?? 'neutral');
    setMelodyTitle(resetPorcelainMelody());
    setNotice('已恢复器型与完整彩绘。');
  }
  return (
    <div className="app">
      <div
        className={`scroll-prologue ${prologueDismissed ? 'is-open' : ''}`}
        aria-hidden={prologueDismissed}
      >
        <div className="scroll-leaf left">
          <svg
            className="scroll-watermark"
            viewBox="0 0 240 420"
            aria-hidden="true"
          >
            <path
              d="M120 30 C165 30 185 80 160 140 C135 200 195 250 175 330 C160 380 120 390 120 390 C120 390 80 380 65 330 C45 250 105 200 80 140 C55 80 75 30 120 30 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <circle
              cx="120"
              cy="220"
              r="58"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <path
              d="M78 220 Q120 172 162 220 Q120 268 78 220 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
          <svg
            className="scroll-cloud c1"
            viewBox="0 0 220 90"
            aria-hidden="true"
          >
            <path
              d="M20 65 Q45 35 80 50 Q105 20 145 42 Q180 30 200 60 Q150 75 95 66 Q50 75 20 65 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          <svg
            className="scroll-cloud c2"
            viewBox="0 0 220 90"
            aria-hidden="true"
          >
            <path
              d="M15 58 Q52 28 92 46 Q128 18 168 44 Q195 36 208 58"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
          <div className="scroll-roller" />
        </div>
        <div className="scroll-leaf right">
          <div className="scroll-roller" />
          <svg
            className="scroll-watermark"
            viewBox="0 0 240 420"
            aria-hidden="true"
          >
            <circle
              cx="120"
              cy="210"
              r="86"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle
              cx="120"
              cy="210"
              r="64"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeDasharray="5 5"
            />
            <path
              d="M120 124 Q148 168 120 210 Q92 168 120 124 Z M120 296 Q148 252 120 210 Q92 252 120 296 Z M34 210 Q78 182 120 210 Q78 238 34 210 Z M206 210 Q162 182 120 210 Q162 238 206 210 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
          <svg
            className="scroll-cloud c3"
            viewBox="0 0 220 90"
            aria-hidden="true"
          >
            <path
              d="M18 62 Q55 30 95 48 Q132 18 172 42 Q196 32 206 58"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          <svg
            className="scroll-cloud c4"
            viewBox="0 0 220 90"
            aria-hidden="true"
          >
            <path
              d="M24 64 Q60 36 96 52 Q130 24 168 46 Q192 38 204 60"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </div>
        <div className="scroll-centerpiece">
          <div className="scroll-card">
            <h2 className="scroll-title">瓷器物语</h2>
            <p className="scroll-subtitle">PORCELAIN TALES</p>
            <p className="scroll-preface">
              <span>一轮圆转塑素坯</span>
              <span>浓淡五色绘苏青</span>
              <span>入窑千度化天青</span>
              <span>轻叩成器奏五音</span>
            </p>
            <button
              type="button"
              className="scroll-seal"
              aria-label="入坊造物"
              tabIndex={prologueDismissed ? -1 : 0}
              onClick={() => {
                setPrologueDismissed(true);
                playPorcelainChime(soundEnabled);
              }}
            >
              造物
            </button>
          </div>
        </div>
      </div>
      <header>
        <div>
          <span className="eyebrow">PORCELAIN TALES</span>
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
                onChange={(nextPoints) => {
                  setProfile(nextPoints);
                  playWheelTone(soundEnabled, nextPoints[3]?.radius ?? 0.5);
                }}
                templates={PROFILE_TEMPLATES}
                targetPoints={challenge?.profile}
                onReset={() => {
                  setProfile(createProfile());
                  playWheelTone(soundEnabled, 0.5);
                }}
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
                symmetry={symmetry}
                onSymmetryChange={setSymmetry}
                ringBand={ringBand}
                onRingBandChange={setRingBand}
                onApplyMasterpiece={applyMasterpiece}
                onImprintContour={imprintContourToVessel}
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
                type="button"
                className="quiet"
                onClick={() => {
                  setStage('shaping');
                  setNotice('可继续微调器型轮廓，已绘青花纹样会自动保留。');
                }}
              >
                返回拉坯微调
              </button>
              <button
                className="sticky-action"
                onClick={() => {
                  setAutoRotate(false);
                  setGlaze(0);
                  setFiringProgress(0);
                  setStage('firing');
                  playKilnIgniteSound(soundEnabled);
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
                onPresetChange={(nextPreset) => {
                  setPreset(nextPreset);
                  setCameraRevision((rev) => rev + 1);
                }}
                lightPreset={lightPreset}
                onLightPresetChange={setLightPreset}
                exhibitionScene={exhibitionScene}
                onExhibitionSceneChange={setExhibitionScene}
                glazeFinish={glazeFinish}
                onGlazeFinishChange={setGlazeFinish}
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
            symmetry={symmetry}
            ringBand={ringBand}
            preset={preset}
            cameraRevision={cameraRevision}
            lightPreset={lightPreset}
            exhibitionScene={
              stage === 'exhibition' ? exhibitionScene : 'neutral'
            }
            glazeFinish={glazeFinish}
            autoRotate={autoRotate && stage !== 'firing'}
            wireframe={wireframe}
            onAction={addAction}
            onTapVessel={() => {
              const res = playPorcelainTapSound();
              setMelodyTitle(currentPorcelainMelodyTitle());
              return res.noteLabel;
            }}
          />
          <div className="scene-corners" aria-hidden="true">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />
          </div>
          <div className="scene-toolbar" role="group" aria-label="视口辅助工具">
            <button
              type="button"
              className="scene-pill"
              disabled={stage === 'firing'}
              onClick={() => setPrologueDismissed(false)}
            >
              ❖ 卷轴序幕
            </button>
            <button
              type="button"
              className="scene-pill"
              aria-pressed={autoRotate}
              disabled={stage === 'firing'}
              onClick={() => {
                const next = !autoRotate;
                setAutoRotate(next);
                if (next && stage === 'painting' && painting) {
                  setPainting(false);
                }
              }}
            >
              {autoRotate ? '⟳ 转盘自转中' : '↻ 转盘漫游'}
            </button>
            <button
              type="button"
              className="scene-pill"
              aria-pressed={wireframe}
              onClick={() => setWireframe(!wireframe)}
            >
              {wireframe ? '◈ 隐藏拓扑网格' : '◇ 数学网格透视'}
            </button>
            <button
              type="button"
              className="scene-pill"
              aria-pressed={soundEnabled}
              onClick={() => setSoundEnabled(!soundEnabled)}
            >
              {soundEnabled ? '♪ 瓷音开启' : '✕ 瓷音静音'}
            </button>
          </div>
          <div className="ambient-motes" aria-hidden="true">
            <span className="mote m1" />
            <span className="mote m2" />
            <span className="mote m3" />
            <span className="mote m4" />
            <span className="mote m5" />
            <span className="mote m6" />
          </div>
          {stage !== 'firing' && (
            <div className="scene-hint">
              {stage === 'painting' && painting
                ? '左键绘制 · 右键拖动旋转视角 · Ctrl+Z 撤销'
                : stage === 'exhibition'
                  ? `轻叩瓷身奏响五声${melodyTitle} · 拖动旋转 · 滚轮缩放`
                  : '拖动旋转 · 滚轮缩放'}
            </div>
          )}
          {stage === 'firing' && (
            <div className="fire-overlay" aria-hidden="true">
              <div className="kiln-flame-base" />
              <div className="kiln-hud-badge">
                <span className="kiln-hud-temp">
                  {kilnTelemetryFor(firingProgress).temperatureC} °C
                </span>
              </div>
              <div className="kiln-embers">
                {KILN_EMBERS.map((ember) => (
                  <span
                    key={ember.id}
                    className="ember"
                    style={{
                      left: `${ember.left}%`,
                      bottom: `${ember.bottom}%`,
                      width: `${ember.size}px`,
                      height: `${ember.size}px`,
                      animationDuration: `${ember.duration}s`,
                      animationDelay: `${ember.delay}s`,
                      ['--ember-drift' as string]: `${ember.drift}px`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
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
          <div className="damaged-banner">
            <p className="muted">
              有 {damaged.length} 件旧作品无法读取，已隔离保存，不影响其它作品。
            </p>
            <button
              type="button"
              className="quiet"
              disabled={busy || stage === 'firing'}
              onClick={() => void clearDamaged()}
            >
              清理损坏记录
            </button>
          </div>
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
    </div>
  );
}
