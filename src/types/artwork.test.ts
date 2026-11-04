import { expectTypeOf, test } from 'vitest';
import type { ArtworkMetadata, PaintingAction } from './artwork';
test('contract supports every painting command and blob persistence', () => {
  expectTypeOf<PaintingAction['type']>().toEqualTypeOf<
    'BRUSH' | 'STAMP' | 'ERASE'
  >();
  expectTypeOf<ArtworkMetadata['snapshotBlob']>().toEqualTypeOf<Blob>();
});
