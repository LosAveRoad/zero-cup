import type { ChallengeId } from '../challenges/challenges';

export interface WikiArticle {
  title: string;
  url: string;
  extract: string;
}

export interface MuseumArtwork {
  id: number;
  title: string;
  date: string;
  objectUrl: string;
  imageUrl: string;
  credit: string;
}

export interface ArtworkResearch {
  article: WikiArticle;
  objects: MuseumArtwork[];
}

const OPEN_ACCESS_CREDIT = 'CC0';

/** Fixed text, museum records, and bundled image paths; no catalogue API is queried at runtime. */
export const ARTWORK_RESEARCH: Record<ChallengeId, ArtworkResearch> = {
  yuhuchun: {
    article: {
      title: '青花瓷',
      url: 'https://zh.wikipedia.org/wiki/%E9%9D%92%E8%8A%B1%E7%93%B7',
      extract:
        '青花瓷（英语：blue-and-white porcelain）是源于中国、遍行世界的一种白地蓝花的高温釉下彩瓷器，常简称青花（blue-and-white），也用来指代该装饰工艺。该品种清新明快，质朴大方，不仅是工业化之前影响最广的瓷器，还被视为中华民族审美理念的代表。',
    },
    objects: [
      {
        id: 50463,
        title: '青花缠枝莲纹瓶',
        date: '16世纪',
        objectUrl: 'https://www.metmuseum.org/art/collection/search/50463',
        imageUrl: '/images/encyclopedia/yuhuchun.jpg',
        credit: OPEN_ACCESS_CREDIT,
      },
    ],
  },
  meiping: {
    article: {
      title: '梅瓶',
      url: 'https://zh.wikipedia.org/wiki/%E6%A2%85%E7%93%B6',
      extract:
        '梅瓶，也稱經瓶，瓷器型制，用途為酒器、花器。最早出現在唐朝，宋遼时期較為流行，約定俗稱為梅瓶。其名根據民國時期許之衡所撰《飲流齋說瓷》一書所稱：「口徑之小，僅與梅之瘦骨相稱，故名梅瓶也。」',
    },
    objects: [
      {
        id: 47621,
        title: '青花桃石榴佛手纹梅瓶',
        date: '17世纪末至18世纪初',
        objectUrl: 'https://www.metmuseum.org/art/collection/search/47621',
        imageUrl: '/images/encyclopedia/meiping.jpg',
        credit: OPEN_ACCESS_CREDIT,
      },
    ],
  },
  yazhbei: {
    article: {
      title: '青花瓷',
      url: 'https://zh.wikipedia.org/wiki/%E9%9D%92%E8%8A%B1%E7%93%B7',
      extract:
        '青花瓷（英语：blue-and-white porcelain）是源于中国、遍行世界的一种白地蓝花的高温釉下彩瓷器，常简称青花（blue-and-white），也用来指代该装饰工艺。该品种清新明快，质朴大方，不仅是工业化之前影响最广的瓷器，还被视为中华民族审美理念的代表。',
    },
    objects: [
      {
        id: 48028,
        title: '青花马纹杯',
        date: '17世纪初',
        objectUrl: 'https://www.metmuseum.org/art/collection/search/48028',
        imageUrl: '/images/encyclopedia/cup-with-horses.jpg',
        credit: OPEN_ACCESS_CREDIT,
      },
    ],
  },
};

export function getArtworkResearch(challengeId: ChallengeId): ArtworkResearch {
  return ARTWORK_RESEARCH[challengeId];
}
