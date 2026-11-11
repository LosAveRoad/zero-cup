import { describe, expect, it } from 'vitest';
import { CHALLENGES } from '../challenges/challenges';
import { ARTWORK_RESEARCH, getArtworkResearch } from './research';

describe('static artwork encyclopedia', () => {
  it('stores cited article excerpts and bundled museum image references for every vessel', () => {
    for (const challenge of CHALLENGES) {
      const research = getArtworkResearch(challenge.id);

      expect(research.article.title).toBeTruthy();
      expect(research.article.url).toMatch(/^https:\/\/zh\.wikipedia\.org\//);
      expect(research.article.extract.length).toBeGreaterThan(40);
      expect(research.objects).toHaveLength(1);
      expect(research.objects[0].imageUrl).toMatch(
        /^\/images\/encyclopedia\/[a-z-]+\.jpg$/,
      );
      expect(research.objects[0].objectUrl).toMatch(
        /^https:\/\/www\.metmuseum\.org\/art\/collection\/search\//,
      );
      expect(research.objects[0].credit).toBe('CC0');
    }
  });

  it('keeps the three fixed vessel entries in the local catalogue', () => {
    expect(Object.keys(ARTWORK_RESEARCH).sort()).toEqual([
      'meiping',
      'yazhbei',
      'yuhuchun',
    ]);
    expect(getArtworkResearch('meiping').article.title).toBe('梅瓶');
    expect(getArtworkResearch('meiping').objects[0].title).toBe(
      '青花桃石榴佛手纹梅瓶',
    );
    expect(getArtworkResearch('yuhuchun').objects[0].id).toBe(50463);
    expect(getArtworkResearch('yuhuchun').objects[0].title).toBe(
      '青花缠枝莲纹瓶',
    );
  });
});
