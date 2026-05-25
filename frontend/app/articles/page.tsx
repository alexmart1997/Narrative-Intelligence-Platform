"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArticleAnalysisResponse,
  ArticleListItem,
  SimilarArticleItem,
  SourceInfo,
  getArticleAnalysis,
  getArticles,
  getSimilarArticles,
  getSources
} from "@/lib/api";
import styles from "./page.module.css";

type ActionState = {
  articleId: number;
  action: "similar";
} | null;

type AnalysisMap = Record<number, ArticleAnalysisResponse | null>;

const languages = ["ru", "en"];
const materialTypes = ["news", "article", "analytics", "opinion", "interview", "unknown"];

export default function ArticlesPage() {
  return (
    <Suspense fallback={<main className={styles.page}><SkeletonDashboard /></main>}>
      <ArticlesContent />
    </Suspense>
  );
}

function ArticlesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [analysisByArticle, setAnalysisByArticle] = useState<AnalysisMap>({});
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceCode, setSourceCode] = useState("");
  const [language, setLanguage] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [showPalette, setShowPalette] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [similarByArticle, setSimilarByArticle] = useState<Record<number, SimilarArticleItem[]>>({});

  const entityId = searchParams.get("entity_id") ?? "";
  const entityName = searchParams.get("entity_name") ?? "";
  const visibleArticles = useMemo(() => articles, [articles]);

  async function loadArticles() {
    setLoading(true);
    setError(null);
    try {
      const [sourceList, articleList] = await Promise.all([
        getSources(),
        getArticles({
          sourceCode,
          language,
          q: query,
          entityId,
          entityName,
          dateFrom,
          dateTo,
          materialType
        })
      ]);
      const uniqueArticles = deduplicateArticleList(articleList.items);
      setSources(sourceList);
      setArticles(uniqueArticles);
      await hydrateAnalyses(uniqueArticles);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить статьи");
    } finally {
      setLoading(false);
    }
  }

  async function hydrateAnalyses(items: ArticleListItem[]) {
    const analyzed = items.filter((article) => article.has_analysis).slice(0, 50);
    if (analyzed.length === 0) {
      setAnalysisByArticle({});
      return;
    }

    // Анализ нужен для русских summaries, фрейминга, нарратива и сущностей в карточке.
    const results = await Promise.allSettled(
      analyzed.map(async (article) => [article.id, await getArticleAnalysis(article.id)] as const)
    );
    const next: AnalysisMap = {};
    for (const result of results) {
      if (result.status === "fulfilled") {
        next[result.value[0]] = result.value[1];
      }
    }
    setAnalysisByArticle(next);
  }

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    loadArticles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowPalette((value) => !value);
      }
      if (event.key === "Escape") setShowPalette(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleFindSimilar(articleId: number) {
    setActionState({ articleId, action: "similar" });
    setError(null);
    try {
      const response = await getSimilarArticles(articleId);
      setSimilarByArticle((current) => ({ ...current, [articleId]: response.items }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось найти похожие статьи");
    } finally {
      setActionState(null);
    }
  }

  function resetFilters() {
    setSourceCode("");
    setLanguage("");
    setMaterialType("");
    setDateFrom("");
    setDateTo("");
    setQuery("");
  }

  return (
    <main className={styles.page}>
      <section className={styles.commandBar}>
        <div className={styles.brandBlock}>
          <p className={styles.eyebrow}>Narrative Intelligence Platform</p>
          <h1>Articles</h1>
          <span>Поиск, фильтрация и переходы к ключевым сценариям: похожие материалы, граф связей, сравнение и доказательства.</span>
        </div>
        <div className={styles.commandSearch}>
          <button className={styles.searchShell} onClick={() => setShowPalette(true)}>
            <span>Поиск по статьям, участникам, фреймам и темам...</span>
            <kbd>Cmd K</kbd>
          </button>
        </div>
      </section>

      <section className={styles.filterBar} aria-label="Article filters">
        <label>
          Источник
          <select value={sourceCode} onChange={(event) => setSourceCode(event.target.value)}>
            <option value="">Все источники</option>
            {sources.map((source) => (
              <option key={source.code} value={source.code}>{source.name}</option>
            ))}
          </select>
        </label>
        <label>
          С
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          По
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          Язык
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="">Все</option>
            {languages.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Тип
          <select value={materialType} onChange={(event) => setMaterialType(event.target.value)}>
            <option value="">Все</option>
            {materialTypes.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className={styles.queryFilter}>
          Поиск
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Moldova, NATO, elections..."
          />
        </label>
        <button className={styles.applyButton} onClick={loadArticles} disabled={loading}>Применить</button>
        <button className={styles.ghostButton} onClick={resetFilters} disabled={loading}>Сбросить</button>
      </section>

      {error ? (
        <div className={styles.errorState}>
          <strong>{error}</strong>
          <button onClick={loadArticles}>Повторить</button>
        </div>
      ) : null}
      {entityId || entityName ? (
        <div className={styles.notice}>
          Фокус по сущности: <strong>{entityName || `ID ${entityId}`}</strong>
          <button onClick={() => router.push("/articles")}>Очистить</button>
        </div>
      ) : null}

      <section className={styles.feedShell}>
        <section className={styles.feed}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.panelKicker}>Articles</p>
              <h2>Материалы</h2>
            </div>
            <span>{visibleArticles.length} в ленте</span>
          </div>

          {loading ? (
            <SkeletonFeed />
          ) : visibleArticles.length === 0 ? (
            <EmptyState onReset={resetFilters} />
          ) : (
            visibleArticles.map((article) => (
              <ArticleCard
                key={article.id}
                actionState={actionState}
                analysis={analysisByArticle[article.id] ?? null}
                article={article}
                onCompare={(id) => router.push(`/articles/${id}/compare`)}
                onEvidence={(id) => router.push(`/articles/${id}/analysis`)}
                onGraph={(id) => router.push(`/articles/${id}/graph`)}
                onSimilar={handleFindSimilar}
                similar={similarByArticle[article.id]}
              />
            ))
          )}
        </section>
      </section>

      {showPalette ? (
        <CommandPalette
          articles={visibleArticles}
          onClose={() => setShowPalette(false)}
          onNavigate={(href) => {
            setShowPalette(false);
            router.push(href);
          }}
          query={query}
          setQuery={setQuery}
        />
      ) : null}
    </main>
  );
}

function ArticleCard({
  actionState,
  analysis,
  article,
  onCompare,
  onEvidence,
  onGraph,
  onSimilar,
  similar
}: {
  actionState: ActionState;
  analysis: ArticleAnalysisResponse | null;
  article: ArticleListItem;
  onCompare: (articleId: number) => void;
  onEvidence: (articleId: number) => void;
  onGraph: (articleId: number) => void;
  onSimilar: (articleId: number) => void;
  similar?: SimilarArticleItem[];
}) {
  const busy = actionState?.articleId === article.id;
  const entities = analysis?.entities.slice(0, 5) ?? [];
  const canOpenIntelligence = article.has_analysis;

  return (
    <article className={styles.articleCard}>
      <div className={styles.cardTopline}>
        <span className={styles.sourceBadge}>{article.source_name}</span>
        <span>{formatDate(article.published_at)}</span>
        <span>{article.language}</span>
        <span>{article.material_type}</span>
      </div>

      <h3>{localizedArticleTitle(article, analysis)}</h3>
      <p className={styles.summary}>{localizedArticleSummary(article, analysis)}</p>

      {analysis ? (
        <div className={styles.analysisGrid}>
          <InfoPill label="Тональность" value={analysis.sentiment} tone={analysis.sentiment} />
          <InfoPill label="Фрейминг" value={analysis.framing} />
          <InfoPill label="Нарратив" value={analysis.narrative_hypothesis} />
        </div>
      ) : null}

      {entities.length > 0 ? (
        <div className={styles.entityRow}>
          {entities.map((entity) => (
            <span key={entity.id}>{entity.name}</span>
          ))}
        </div>
      ) : null}

      <div className={styles.cardActions}>
        <button onClick={() => onSimilar(article.id)} disabled={busy || !canOpenIntelligence}>
          {busy ? "Ищу..." : "Похожие"}
        </button>
        <button onClick={() => onGraph(article.id)} disabled={!canOpenIntelligence}>Граф</button>
        <button onClick={() => onCompare(article.id)} disabled={!canOpenIntelligence}>Сравнить</button>
        <button onClick={() => onEvidence(article.id)} disabled={!canOpenIntelligence}>Доказательства</button>
      </div>

      {similar ? (
        <div className={styles.similarBox}>
          <strong>Похожие материалы</strong>
          {similar.length === 0 ? (
            <p>Хороших кандидатов нет: hybrid guard не нашел конкретных общих сущностей, ключевых слов или того же сюжета.</p>
          ) : similar.slice(0, 3).map((item) => (
            <article className={styles.similarItem} key={`${article.id}-${item.article_id}`}>
              <div>
                <span className={styles.similarClass}>{translateSimilarityClass(item.classification)}</span>
                <b>{Math.round(item.same_story_probability * 100)}%</b>
              </div>
              <strong>{item.source_name} · {truncate(item.title, 92)}</strong>
              <p>{item.similarity_reason}</p>
              <small>
                Почему похоже?
                {item.shared_entities.length > 0 ? ` Общие участники: ${item.shared_entities.slice(0, 4).join(", ")}.` : ""}
                {item.shared_keywords.length > 0 ? ` Общие ключевые слова: ${item.shared_keywords.slice(0, 5).join(", ")}.` : ""}
              </small>
            </article>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function InfoPill({ label, tone, value }: { label: string; tone?: string; value: string }) {
  return (
    <div className={styles.infoPill}>
      <span>{label}</span>
      <strong className={tone ? styles[`tone_${tone}`] ?? "" : ""}>{truncate(value, 116)}</strong>
    </div>
  );
}

function localizedArticleTitle(article: ArticleListItem, analysis: ArticleAnalysisResponse | null) {
  if (article.language === "ru") return article.title;
  return analysis?.short_summary || article.title;
}

function localizedArticleSummary(article: ArticleListItem, analysis: ArticleAnalysisResponse | null) {
  if (article.language === "ru") return analysis?.short_summary || article.text_preview || "Нет краткого описания.";
  return analysis?.detailed_summary || analysis?.short_summary || article.text_preview || "Русский перевод появится после анализа.";
}

function CommandPalette({
  articles,
  onClose,
  onNavigate,
  query,
  setQuery
}: {
  articles: ArticleListItem[];
  onClose: () => void;
  onNavigate: (href: string) => void;
  query: string;
  setQuery: (value: string) => void;
}) {
  const matches = articles
    .filter((article) => article.title.toLowerCase().includes(query.toLowerCase()) || !query)
    .slice(0, 7);
  return (
    <div className={styles.paletteBackdrop} onClick={onClose}>
      <section className={styles.palette} onClick={(event) => event.stopPropagation()}>
        <div className={styles.paletteInput}>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по статьям, участникам и фреймам..."
          />
          <kbd>Esc</kbd>
        </div>
        <div className={styles.paletteGroup}>
          <button onClick={() => onNavigate("/articles")}>Статьи</button>
          {matches[0] ? (
            <>
              <button onClick={() => onNavigate(`/articles/${matches[0].id}/graph`)}>Граф первого совпадения</button>
              <button onClick={() => onNavigate(`/articles/${matches[0].id}/compare`)}>Сравнить первое совпадение</button>
            </>
          ) : null}
        </div>
        <div className={styles.paletteResults}>
          {matches.map((article) => (
            <button key={article.id} onClick={() => onNavigate(`/articles/${article.id}/graph`)}>
              <span>{article.source_name}</span>
              <strong>{localizedArticleTitle(article, null)}</strong>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <>
      <div className={styles.skeletonHero} />
      <SkeletonFeed />
    </>
  );
}

function SkeletonFeed() {
  return (
    <div className={styles.skeletonList}>
      {Array.from({ length: 4 }).map((_, index) => (
        <div className={styles.skeletonCard} key={index}>
          <span />
          <strong />
          <p />
          <p />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className={styles.emptyState}>
      <strong>Статьи не найдены</strong>
      <p>Измени фильтры или загрузи материалы за более широкий период.</p>
      <button onClick={onReset}>Сбросить фильтры</button>
    </div>
  );
}

function deduplicateArticleList(items: ArticleListItem[]) {
  const seen = new Set<string>();
  const result: ArticleListItem[] = [];
  for (const item of items) {
    const key = articleDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function articleDedupeKey(item: ArticleListItem) {
  try {
    const url = new URL(item.url);
    url.hash = "";
    url.searchParams.delete("from");
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    return `${item.source_code ?? item.source_name}:${url.toString().replace(/\/$/, "")}`;
  } catch {
    return `${item.source_code ?? item.source_name}:${item.title.trim().toLowerCase()}:${item.published_at}`;
  }
}

function translateSimilarityClass(classification: SimilarArticleItem["classification"]) {
  const labels: Record<SimilarArticleItem["classification"], string> = {
    same_story: "тот же сюжет",
    related_context: "связанный контекст",
    not_related: "не связано"
  };
  return labels[classification];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
