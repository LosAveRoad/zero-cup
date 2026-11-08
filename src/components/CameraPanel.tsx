import type { CameraPresetId } from '../core/export/capture';

export interface CameraPanelProps {
  preset: CameraPresetId;
  onPresetChange: (preset: CameraPresetId) => void;
  disabled?: boolean;
}

const OPTIONS: { id: CameraPresetId; label: string }[] = [
  { id: 'front', label: '正视' },
  { id: 'tilt30', label: '俯仰30°' },
  { id: 'closeup', label: '特写' },
  { id: 'free', label: '自由旋转' },
];

/**
 * The recommended camera positions of the photo stage. Pure UI: the panel only
 * reports the chosen preset, the viewport owns the camera.
 */
export function CameraPanel({
  preset,
  onPresetChange,
  disabled = false,
}: CameraPanelProps): JSX.Element {
  return (
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
  );
}
