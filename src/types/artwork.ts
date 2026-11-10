/** PRD §6.2. Persisted replay history must not be truncated to the undo limit. */
export interface ProfileControlPoint {
  id: string;
  height: number;
  radius: number;
}
export interface UVPoint {
  u: number;
  v: number;
}

/** The mutually exclusive painting tools of the studio. */
export type PaintTool = 'brush' | 'eraser' | 'stamp';
export type SymmetryCount = 1 | 2 | 4 | 6 | 8;
export type PaintingAction =
  | {
      type: 'BRUSH';
      path: UVPoint[];
      color: string;
      opacity: number;
      size: number;
      symmetry?: SymmetryCount;
    }
  | {
      type: 'STAMP';
      u: number;
      v: number;
      assetId: string;
      color: string;
      scale: number;
      rotation: number;
      symmetry?: SymmetryCount;
    }
  | { type: 'ERASE'; path: UVPoint[]; size: number };
export interface ArtworkMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  profilePoints: ProfileControlPoint[];
  actionHistory: PaintingAction[];
  thumbnailBlob: Blob;
  snapshotBlob: Blob;
  challengeId?: string;
  score?: number;
}

/** Legacy stroke shape persisted by schema v1. */
export interface LegacyStroke {
  points: UVPoint[];
  size: number;
  color: string;
}

/** Schema v1 record. Read-only: migrated forward on read, never written again. */
export interface StudioArtworkV1 {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  profile: ProfileControlPoint[];
  strokes: LegacyStroke[];
  image: Blob;
}

/** Finished-glaze presets offered in the exhibition stage. */
export type GlazeFinishId = 'white' | 'celadon' | 'crackle' | 'gilded';

/** Exhibition lighting presets offered in the exhibition stage. */
export type LightingPresetId = 'studio' | 'warm' | 'celadon';

export const EXHIBITION_SCENE_IDS = [
  'neutral',
  'ink',
  'lattice',
  'moon',
] as const;
export type ExhibitionSceneId = (typeof EXHIBITION_SCENE_IDS)[number];

/** Schema v2 record. The only shape the app writes. */
export interface StudioArtworkV2 {
  version: 2;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  profile: ProfileControlPoint[];
  actions: PaintingAction[];
  image: Blob;
  texture?: Blob;
  challengeId?: string;
  score?: number;
  /** Finished-glaze preset; absent on records saved before it existed (white). */
  glazeFinish?: GlazeFinishId;
  /** Exhibition light rig; absent on records saved before it existed (studio). */
  lightPreset?: LightingPresetId;
  /** Display setting for the live exhibit and photo. Older works use neutral. */
  exhibitionScene?: ExhibitionSceneId;
}

export const STUDIO_SCHEMA_VERSION = 2;
export type StudioArtwork = StudioArtworkV2;
export type StudioArtworkRecord = StudioArtworkV1 | StudioArtworkV2;
