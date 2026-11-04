import { createStore, del, get, set, values } from 'idb-keyval';
import type { ProfileControlPoint } from '../types/artwork';
import type { Stroke } from '../core/painting/strokes';
export interface StudioArtwork {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  profile: ProfileControlPoint[];
  strokes: Stroke[];
  image: Blob;
}
const store = createStore('porcelain-tales-studio', 'artworks');
export const saveArtwork = (artwork: StudioArtwork) =>
  set(artwork.id, artwork, store);
export const getArtwork = (id: string) => get<StudioArtwork>(id, store);
export const deleteArtwork = (id: string) => del(id, store);
export const listArtworks = async () =>
  (await values<StudioArtwork>(store)).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
