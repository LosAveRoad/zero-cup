import type { CameraPresetId } from '../core/export/capture';
import {
  GLAZE_FINISH_PRESETS,
  type GlazeFinishId,
} from '../core/materials/glaze';
import type { LightingPresetId } from '../core/materials/lighting';
import { EXHIBITION_SCENE_IDS, type ExhibitionSceneId } from '../types/artwork';

export interface CameraPanelProps {
  preset: CameraPresetId;
  onPresetChange: (preset: CameraPresetId) => void;
  lightPreset?: LightingPresetId;
  onLightPresetChange?: (preset: LightingPresetId) => void;
  exhibitionScene: ExhibitionSceneId;
  onExhibitionSceneChange: (scene: ExhibitionSceneId) => void;
  glazeFinish?: GlazeFinishId;
  onGlazeFinishChange?: (finish: GlazeFinishId) => void;
  disabled?: boolean;
}

const OPTIONS: { id: CameraPresetId; label: string }[] = [
  { id: 'front', label: '正视' },
  { id: 'tilt30', label: '俯仰30°' },
  { id: 'closeup', label: '特写' },
  { id: 'free', label: '自由旋转' },
];

const LIGHT_OPTIONS: { id: LightingPresetId; label: string }[] = [
  { id: 'studio', label: '标准展厅' },
  { id: 'warm', label: '博古暖光' },
  { id: 'celadon', label: '天青雅光' },
];

const SCENE_OPTIONS: Record<
  ExhibitionSceneId,
  { label: string; detail: string }
> = {
  neutral: { label: '素色展台', detail: '浅灰背景，便于对照器型与釉色。' },
  ink: { label: '云山留白', detail: '纸色远山与浅石展台，衬出青花纹样。' },
  lattice: { label: '木格暖阁', detail: '胡桃木格与琥珀光，适合暖釉与描金。' },
  moon: { label: '月门夜庭', detail: '冷月与深色展台，勾勒器口和肩线。' },
};

/** Scene, camera, lighting and glaze controls for the photo stage. */
export function CameraPanel({
  preset,
  onPresetChange,
  lightPreset = 'studio',
  onLightPresetChange,
  exhibitionScene,
  onExhibitionSceneChange,
  glazeFinish = 'white',
  onGlazeFinishChange,
  disabled = false,
}: CameraPanelProps): JSX.Element {
  return (
    <div className="camera-controls">
      <div className="lighting-controls">
        <span className="control-caption">展陈场景</span>
        <div
          className="segmented"
          role="group"
          aria-label="展陈场景"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}
        >
          {EXHIBITION_SCENE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={exhibitionScene === id}
              disabled={disabled}
              onClick={() => onExhibitionSceneChange(id)}
            >
              {SCENE_OPTIONS[id].label}
            </button>
          ))}
        </div>
        <small aria-live="polite">
          {SCENE_OPTIONS[exhibitionScene].detail}
        </small>
      </div>
      <div
        className="segmented"
        role="group"
        aria-label="推荐机位"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}
      >
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={preset === option.id}
            disabled={disabled}
            onClick={() => onPresetChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {onGlazeFinishChange && (
        <div className="lighting-controls">
          <span className="control-caption">名窑釉彩与开片</span>
          <div
            className="segmented"
            role="group"
            aria-label="名窑釉色"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}
          >
            {GLAZE_FINISH_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={glazeFinish === item.id}
                disabled={disabled}
                onClick={() => onGlazeFinishChange(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {onLightPresetChange && (
        <div className="lighting-controls">
          <span className="control-caption">展厅调光</span>
          <div className="segmented" role="group" aria-label="展厅灯光">
            {LIGHT_OPTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={lightPreset === item.id}
                disabled={disabled}
                onClick={() => onLightPresetChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
