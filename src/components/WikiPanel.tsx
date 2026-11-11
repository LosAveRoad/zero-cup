import { useEffect, useState } from 'react';
import { getArtworkResearch } from '../core/wiki/research';
import { CHALLENGES, type ChallengeId } from '../core/challenges/challenges';

export interface WikiPanelProps {
  currentChallengeId?: ChallengeId;
  open: boolean;
  onClose: () => void;
  onSelectChallenge: (id: ChallengeId | undefined) => void;
}

export function WikiPanel({
  currentChallengeId,
  open,
  onClose,
  onSelectChallenge,
}: WikiPanelProps) {
  const [activeChallengeId, setActiveChallengeId] =
    useState<ChallengeId | null>(currentChallengeId ?? null);
  const activeChallenge = CHALLENGES.find(
    (challenge) => challenge.id === activeChallengeId,
  );
  const research = activeChallengeId
    ? getArtworkResearch(activeChallengeId)
    : undefined;

  useEffect(() => {
    if (!open) {
      setActiveChallengeId(currentChallengeId ?? null);
    }
  }, [currentChallengeId, open]);

  if (!open) return null;

  return (
    <section className="wiki-panel" role="dialog" aria-label="器型百科">
      <header className="wiki-panel-header">
        <div>
          <span className="eyebrow">CRAFT ENCYCLOPEDIA</span>
          <h2>
            {activeChallenge
              ? `${activeChallenge.name} · 器型百科`
              : '器型百科'}
          </h2>
        </div>
        <button
          type="button"
          className="wiki-close quiet"
          aria-label="关闭器型百科"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {activeChallenge ? (
        <div className="wiki-content" key={activeChallenge.id}>
          <button
            type="button"
            className="wiki-back quiet"
            onClick={() => setActiveChallengeId(null)}
          >
            ← 返回器型目录
          </button>
          <button
            type="button"
            className="wiki-select-goal"
            onClick={() => onSelectChallenge(activeChallenge.id)}
          >
            以{activeChallenge.name}为目标创作
          </button>

          {research && (
            <div className="wiki-research">
              <section
                className="wiki-article"
                aria-labelledby="wiki-article-title"
              >
                <div className="wiki-section-heading">
                  <span>01</span>
                  <h3 id="wiki-article-title">相关维基百科摘录</h3>
                </div>
                <h4>{research.article.title}</h4>
                <p className="wiki-extract">{research.article.extract}</p>
              </section>

              <section
                className="wiki-museum"
                aria-labelledby="wiki-museum-title"
              >
                <div className="wiki-section-heading">
                  <span>02</span>
                  <h3 id="wiki-museum-title">博物馆馆藏图像</h3>
                </div>
                {research.objects.length > 0 ? (
                  <div className="wiki-object-grid">
                    {research.objects.map((object) => (
                      <figure key={object.id} className="wiki-object">
                        <a
                          href={object.objectUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`查看馆藏：${object.title}`}
                        >
                          <img src={object.imageUrl} alt={object.title} />
                        </a>
                        <figcaption>
                          <a
                            href={object.objectUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {object.title}
                          </a>
                          {object.date && <span>{object.date}</span>}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="muted">暂未找到带公开领域图片的相关馆藏。</p>
                )}
                <p className="wiki-attribution">
                  青花纹饰参考：
                  <a
                    href={research.objects[0]?.objectUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    馆藏页面
                  </a>
                </p>
              </section>
            </div>
          )}
        </div>
      ) : (
        <div className="wiki-content" key="directory">
          <p className="wiki-intro">
            浏览器型典故与馆藏资料，选定目标后即可开始创作。
          </p>
          <div className="wiki-directory">
            <article className="wiki-directory-card">
              <div className="wiki-directory-copy">
                <span className="wiki-directory-mark" aria-hidden="true">
                  自
                </span>
                <div>
                  <h3>自由创作</h3>
                  <p>不限定器型，按照自己的构想塑形。</p>
                </div>
              </div>
              <div className="wiki-directory-actions">
                <button
                  type="button"
                  onClick={() => onSelectChallenge(undefined)}
                >
                  选择创作：自由创作
                </button>
              </div>
            </article>
            {CHALLENGES.map((challenge) => (
              <article className="wiki-directory-card" key={challenge.id}>
                <div className="wiki-directory-copy">
                  <span className="wiki-directory-mark" aria-hidden="true">
                    器
                  </span>
                  <div>
                    <h3>{challenge.name}</h3>
                    <p>{challenge.description}</p>
                  </div>
                </div>
                <div className="wiki-directory-actions">
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setActiveChallengeId(challenge.id)}
                  >
                    阅读百科：{challenge.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectChallenge(challenge.id)}
                  >
                    选择创作：{challenge.name}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
