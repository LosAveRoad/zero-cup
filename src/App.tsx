import { useEffect, useRef, useState } from 'react';
import { Viewport, type ViewportHandle } from './components/Viewport';
import { CameraPanel } from './components/CameraPanel';
import { FilmError } from './components/record-film';
import { ChallengePanel } from './components/ChallengePanel';
import { FiringPanel } from './components/FiringPanel';
import { ProfileEditor } from './components/ProfileEditor';
import { ToolPanel } from './components/ToolPanel';
import { WikiPanel } from './components/WikiPanel';
import {
  getChallenge,
  silhouetteScore,
  type ChallengeId,
} from './core/challenges/challenges';
import {
  createProfile,
  VESSEL_HEIGHT_SCALE_RANGE,
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
  type RotaryPatternId,
} from './core/painting/strokes';
import { STAMP_ASSETS, type StampAssetId } from './core/painting/stamps';
import type { CameraPresetId } from './core/export/capture';
import type { LightingPresetId } from './core/materials/lighting';
import {
  playBrushSound,
  playKilnIgniteSound,
  playPorcelainChime,
  playPorcelainTapSound,
  playWheelTone,
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
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [profile, setProfile] = useState(createProfile);
  const [heightScale, setHeightScale] = useState<number>(
    VESSEL_HEIGHT_SCALE_RANGE.default,
  );
  const [history, setHistory] = useState(createHistory);
  const [stage, setStage] = useState<Stage>('shaping');
  const [toolPanelMode, setToolPanelMode] = useState<'draw' | 'template'>(
    'draw',
  );
  const [tool, setTool] = useState<PaintTool>('brush');
  const [brushSize, setBrushSize] = useState(24);
  const [color, setColor] = useState('#174a94');
  const [inkConcentration, setInkConcentration] = useState(100);
  const [brushOpacity, setBrushOpacity] = useState(1);
  const [stampAssetId, setStampAssetId] = useState<StampAssetId>(
    STAMP_ASSETS[0].id,
  );
  const [stampScale, setStampScale] = useState(1);
  const [stampRotation, setStampRotation] = useState(0);
  const [rotaryPattern, setRotaryPattern] =
    useState<RotaryPatternId>('linked-wave');
  const [rotaryPatternSize, setRotaryPatternSize] = useState(1.8);
  const [symmetry, setSymmetry] = useState<SymmetryCount>(1);
  const [challengeId, setChallengeId] = useState<ChallengeId | undefined>(
    undefined,
  );
  const [wikiOpen, setWikiOpen] = useState(false);
  const [preset, setPreset] = useState<CameraPresetId>('front');
  const [cameraRevision, setCameraRevision] = useState(0);
  const [lightPreset, setLightPreset] = useState<LightingPresetId>('studio');
  const [exhibitionScene, setExhibitionScene] =
    useState<ExhibitionSceneId>('ink');
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
  const [glaze, setGlaze] = useState(0);
  const [firingProgress, setFiringProgress] = useState(0);
  const [name, setName] = useState('我的第一件青花瓷');
  const [notice, setNotice] = useState('');
  const [gallery, setGallery] = useState<StudioArtworkV2[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [damaged, setDamaged] = useState<DamagedRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [multipleScenes, setMultipleScenes] = useState(true);
  const [videoProgress, setVideoProgress] = useState<number>();
  const videoJob = useRef<AbortController>();
  const viewport = useRef<ViewportHandle>(null);
  const currentId = useRef<string>(crypto.randomUUID());
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);
  const visible = visibleActions(history);
  const challenge = challengeId ? getChallenge(challengeId) : undefined;
  const score = challenge ? silhouetteScore(profile, challenge.profile) : 0;
  function chooseOpeningGoal(id: ChallengeId | undefined) {
    setChallengeId(id);
    setProfile(
      id ? (getChallenge(id)?.profile ?? createProfile()) : createProfile(),
    );
    setHeightScale(VESSEL_HEIGHT_SCALE_RANGE.default);
    setWikiOpen(false);
    setPrologueDismissed(true);
    playPorcelainChime(soundEnabled);
  }
  function chooseWikiGoal(id: ChallengeId | undefined) {
    chooseOpeningGoal(id);
  }
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
      playPorcelainChime(soundEnabledRef.current);
      setStage('exhibition');
      setNotice('');
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
  }
  function applyMasterpiece(presetId: MasterpiecePresetId) {
    const presetActions = createMasterpiecePreset(
      presetId,
      viewport.current?.frontU() ?? 0,
      profile,
      heightScale,
    );
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
  function reset() {
    if (!window.confirm('新建会放弃未保存的修改，继续吗？')) return;
    setProfile(createProfile());
    setHeightScale(VESSEL_HEIGHT_SCALE_RANGE.default);
    setName('我的第一件青花瓷');
    setToolPanelMode('draw');
    setTool('brush');
    setBrushSize(24);
    setColor('#174a94');
    setInkConcentration(100);
    setBrushOpacity(1);
    setSymmetry(1);
    setHistory(createHistory());
    setStage('shaping');
    setGlaze(0);
    setFiringProgress(0);
    setChallengeId(undefined);
    setWikiOpen(true);
    setPrologueDismissed(true);
    setPreset('front');
    setCameraRevision((rev) => rev + 1);
    setLightPreset('studio');
    setExhibitionScene('ink');
    setGlazeFinish('white');
    setAutoRotate(false);
    currentId.current = crypto.randomUUID();
    setNotice('请选择本次创作的器形。');
  }
  async function download() {
    setBusy(true);
    try {
      const blob = await viewport.current!.snapshot(name);
      downloadBlob(blob, 'porcelain-tales.png');
      setNotice('1080×1080 PNG 已导出。');
    } catch {
      setNotice('图片导出失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function generateVideo() {
    if (busy || videoJob.current) return;
    const job = new AbortController();
    videoJob.current = job;
    setBusy(true);
    setVideoProgress(0);
    setNotice('正在生成演示视频，请保持此页面在前台。');
    try {
      const result = await viewport.current!.video({
        name,
        multipleScenes,
        signal: job.signal,
        onProgress: setVideoProgress,
      });
      downloadBlob(result.blob, `porcelain-tales.${result.extension}`);
      setNotice(`演示视频已导出（${result.extension.toUpperCase()}）。`);
    } catch (error) {
      if (job.signal.aborted) setNotice('已取消视频生成。');
      else if (error instanceof FilmError) setNotice(error.message);
      else setNotice('视频生成失败，请重试。');
    } finally {
      videoJob.current = undefined;
      setVideoProgress(undefined);
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
        heightScale,
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
    setHeightScale(artwork.heightScale ?? VESSEL_HEIGHT_SCALE_RANGE.default);
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
    setExhibitionScene(artwork.exhibitionScene ?? 'ink');
    setNotice('');
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
            <div
              className="scroll-goals"
              role="group"
              aria-label="选择创作方式"
            >
              <button
                type="button"
                className="scroll-seal"
                tabIndex={prologueDismissed ? -1 : 0}
                onClick={() => chooseOpeningGoal(undefined)}
              >
                自由创作
              </button>
              <button
                type="button"
                className="scroll-encyclopedia"
                tabIndex={prologueDismissed ? -1 : 0}
                aria-label="器型百科：浏览所有器型"
                onClick={() => setWikiOpen(true)}
              >
                <span className="encyclopedia-stamp" aria-hidden="true">
                  百
                </span>
                <span>
                  <strong>器型百科</strong>
                  <small>浏览器型介绍 · 选择创作目标</small>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <header>
        <div className="brand-lockup">
          <h1 aria-label="瓷器物语">瓷器物语</h1>
        </div>
        <div className="header-actions" role="group" aria-label="作品操作">
          <button
            type="button"
            className="header-gallery"
            aria-expanded={galleryOpen}
            onClick={() => setGalleryOpen(true)}
          >
            我的作品 <span>{gallery.length}</span>
          </button>
          <button
            type="button"
            className="header-new-work"
            disabled={stage === 'firing' || busy}
            onClick={reset}
          >
            新建作品
          </button>
        </div>
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
          {stage === 'shaping' ? (
            <h2 data-step="01" aria-label="01 拉坯工作台">
              拉坯工作台
            </h2>
          ) : (
            <h2 data-step={`0${stages.indexOf(stage) + 1}`}>
              {labels[stages.indexOf(stage)]}工作台
            </h2>
          )}
          {stage === 'shaping' && (
            <>
              <ProfileEditor
                points={profile}
                heightScale={heightScale}
                onHeightScaleChange={setHeightScale}
                onChange={(nextPoints) => {
                  setProfile(nextPoints);
                  playWheelTone(soundEnabled, nextPoints[3]?.radius ?? 0.5);
                }}
                targetPoints={challenge?.profile}
                onReset={() => {
                  setProfile(challenge?.profile ?? createProfile());
                  setHeightScale(VESSEL_HEIGHT_SCALE_RANGE.default);
                  playWheelTone(soundEnabled, 0.5);
                }}
              />
              <ChallengePanel
                challenge={challenge}
                score={challenge ? score : undefined}
              />
              <button
                className="sticky-action"
                onClick={() => {
                  setStage('painting');
                  setNotice('');
                }}
              >
                定型进入彩绘
              </button>
            </>
          )}
          {stage === 'painting' && (
            <>
              <ToolPanel
                mode={toolPanelMode}
                onModeChange={setToolPanelMode}
                tool={tool}
                onToolChange={(nextTool) => {
                  setTool(nextTool);
                  setAutoRotate(nextTool === 'rotary');
                }}
                brushSize={brushSize}
                onBrushSizeChange={setBrushSize}
                color={color}
                onColorChange={setColor}
                brushOpacity={brushOpacity}
                onBrushOpacityChange={setBrushOpacity}
                inkConcentration={inkConcentration}
                onInkConcentrationChange={setInkConcentration}
                stampAssetId={stampAssetId}
                onStampAssetChange={setStampAssetId}
                stampScale={stampScale}
                onStampScaleChange={setStampScale}
                stampRotation={stampRotation}
                onStampRotationChange={setStampRotation}
                symmetry={symmetry}
                onSymmetryChange={setSymmetry}
                rotaryPattern={rotaryPattern}
                onRotaryPatternChange={setRotaryPattern}
                rotaryPatternSize={rotaryPatternSize}
                onRotaryPatternSizeChange={setRotaryPatternSize}
                onApplyMasterpiece={applyMasterpiece}
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
                  disabled={videoProgress !== undefined}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button disabled={busy} onClick={() => void download()}>
                下载 PNG
              </button>
              <label className="film-scenes">
                <input
                  type="checkbox"
                  checked={multipleScenes}
                  disabled={busy}
                  onChange={(event) => setMultipleScenes(event.target.checked)}
                />
                串联三个展陈场景
              </label>
              <button disabled={busy} onClick={() => void generateVideo()}>
                生成演示视频
              </button>
              {videoProgress !== undefined && (
                <div className="video-progress">
                  <progress
                    aria-label="视频生成进度"
                    max={100}
                    value={videoProgress}
                  />
                  <button
                    className="quiet"
                    type="button"
                    onClick={() => videoJob.current?.abort()}
                  >
                    取消生成
                  </button>
                </div>
              )}
              <button disabled={busy} onClick={() => void save()}>
                保存到藏品
              </button>
            </>
          )}
        </aside>
        <section className="scene" aria-label="创作视口">
          <Viewport
            ref={viewport}
            profile={profile}
            heightScale={heightScale}
            actions={visible}
            glaze={glaze}
            painting={stage === 'painting'}
            showPedestal={stage === 'exhibition'}
            tool={tool}
            brushSize={brushSize}
            color={color}
            brushOpacity={brushOpacity}
            stampAssetId={stampAssetId}
            stampScale={stampScale}
            stampRotation={stampRotation}
            rotaryPattern={rotaryPattern}
            rotaryPatternSize={rotaryPatternSize}
            symmetry={tool === 'stamp' ? symmetry : 1}
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
              disabled={stage === 'firing' || videoProgress !== undefined}
              onClick={() => setPrologueDismissed(false)}
            >
              ❖ 卷轴序幕
            </button>
            <button
              type="button"
              className="scene-pill"
              aria-pressed={autoRotate}
              disabled={stage === 'firing' || videoProgress !== undefined}
              onClick={() => {
                const next = !autoRotate;
                setAutoRotate(next);
              }}
            >
              {autoRotate ? '⟳ 转盘自转中' : '↻ 转盘漫游'}
            </button>
            <button
              type="button"
              className="scene-pill"
              aria-pressed={wireframe}
              disabled={videoProgress !== undefined}
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
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {prologueDismissed && (
        <button
          type="button"
          className="wiki-toggle"
          aria-label="器型百科"
          aria-expanded={wikiOpen}
          onClick={() => setWikiOpen((open) => !open)}
        >
          <span aria-hidden="true">百</span>
          <small>百科</small>
        </button>
      )}
      <WikiPanel
        currentChallengeId={challenge?.id}
        open={wikiOpen}
        onClose={() => setWikiOpen(false)}
        onSelectChallenge={chooseWikiGoal}
      />
      {galleryOpen && (
        <div
          className="gallery-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGalleryOpen(false);
          }}
        >
          <section
            className="gallery"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gallery-title"
          >
            <div className="gallery-heading">
              <div>
                <span className="eyebrow">LOCAL COLLECTION</span>
                <h2 id="gallery-title">我的作品</h2>
              </div>
              <div className="gallery-heading-actions">
                <span>本地收藏 / {gallery.length}</span>
                <button
                  type="button"
                  className="quiet gallery-close"
                  aria-label="关闭我的作品"
                  onClick={() => setGalleryOpen(false)}
                >
                  ×
                </button>
              </div>
            </div>
            {damaged.length > 0 && (
              <div className="damaged-banner">
                <p className="muted">
                  有 {damaged.length}{' '}
                  件旧作品无法读取，已隔离保存，不影响其它作品。
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
              <p className="muted">完成第一件作品后，可在这里继续创作。</p>
            ) : (
              <div className="gallery-grid">
                {gallery.map((a) => (
                  <ArtworkCard
                    key={a.id}
                    artwork={a}
                    disabled={busy || stage === 'firing'}
                    onOpen={() => {
                      setGalleryOpen(false);
                      open(a);
                    }}
                    onDelete={() => void remove(a.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
