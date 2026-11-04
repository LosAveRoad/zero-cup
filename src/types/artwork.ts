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
export type PaintingAction =
  | {
      type: 'BRUSH';
      path: UVPoint[];
      color: string;
      opacity: number;
      size: number;
    }
  | {
      type: 'STAMP';
      u: number;
      v: number;
      assetId: string;
      color: string;
      scale: number;
      rotation: number;
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
