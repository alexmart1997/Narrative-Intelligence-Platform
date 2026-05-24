"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArticleAnalysisResponse,
  ArticleListItem,
  NarrativeListItem,
  SimilarArticleItem,
  SourceInfo,
  analyzeArticle,
  detectArticleEvent,
  discoverNarratives,
  embedArticle,
  getArticleAnalysis,
  getArticles,
  getNarratives,
  getSimilarArticles,
  getSources,
  precomputeIntelligence
} from "@/lib/api";
import styles from "./page.module.css";

type ActionState = {
  articleId: number;
  action: ArticleAction;
} | null;

type ArticleAction = "analysis" | "analyze" | "compare" | "event" | "graph" | "similar";
type DensityMode = "compact" | "comfortable" | "analyst";
type StatusFilter = "" | "analyzed" | "not_analyzed";
type GlobalAction = "discover_narratives" | "precompute" | null;

type AnalysisMap = Record<number, ArticleAnalysisResponse | null>;

const languages = ["ru", "en"];
const materialTypes = ["news", "article", "analytics", "opinion", "interview", "unknown"];
const sentiments = ["positive", "negative", "neutral", "mixed"];

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
  const [narratives, setNarratives] = useState<NarrativeListItem[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceCode, setSourceCode] = useState("");
  const [language, setLanguage] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [sentimentFilter, setSentimentFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [density, setDensity] = useState<DensityMode>("comfortable");
  const [showPalette, setShowPalette] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [globalAction, setGlobalAction] = useState<GlobalAction>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [noticeByArticle, setNoticeByArticle] = useState<Record<number, string>>({});
  const [similarByArticle, setSimilarByArticle] = useState<Record<number, SimilarArticleItem[]>>({});

  const entityId = searchParams.get("entity_id") ?? "";
  const entityName = searchParams.get("entity_name") ?? "";

  const visibleArticles = useMemo(() => {
    return articles.filter((article) => {
      const analysis = analysisByArticle[article.id];
      if (statusFilter === "analyzed" && !article.has_analysis) return false;
      if (statusFilter === "not_analyzed" && article.has_analysis) return false;
      if (sentimentFilter && analysis?.sentiment !== sentimentFilter) return false;
      return true;
    });
  }, [analysisByArticle, articles, sentimentFilter, statusFilter]);

  const metrics = useMemo(() => buildMetrics(visibleArticles, sources, narratives, analysisByArticle), [
    analysisByArticle,
    narratives,
    sources,
    visibleArticles
  ]);
  const timeline = useMemo(() => buildTimeline(visibleArticles), [visibleArticles]);
  const sourceMix = useMemo(() => topCounts(visibleArticles.map((article) => article.source_name), 5), [visibleArticles]);
  const topNarrativeHypotheses = useMemo(() => {
    return topCounts(
      visibleArticles
        .map((article) => analysisByArticle[article.id]?.narrative_hypothesis)
        .filter(Boolean) as string[],
      5
    );
  }, [analysisByArticle, visibleArticles]);
  const spotlight = useMemo(() => pickSpotlight(visibleArticles), [visibleArticles]);

  async function loadArticles() {
    setLoading(true);
    setError(null);
    try {
      const [sourceList, articleList, narrativeList] = await Promise.all([
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
        }),
        getNarratives().catch(() => [] as NarrativeListItem[])
      ]);
      setSources(sourceList);
      setArticles(articleList.items);
      setNarratives(narrativeList);
      await hydrateAnalyses(articleList.items);
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

    // Анализы загружаем отдельно и не считаем ошибкой, если часть статей еще не имеет evidence/analysis.
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

  async function handleAnalyze(articleId: number) {
    setActionState({ articleId, action: "analyze" });
    setActionMessage("Running LLM analysis...");
    setError(null);
    setNoticeByArticle((current) => ({ ...current, [articleId]: "" }));
    try {
      await analyzeArticle(articleId);
      setActionMessage("Creating vector embedding...");
      await embedArticle(articleId);
      setActionMessage("Detecting event link...");
      await detectArticleEvent(articleId);
      await loadArticles();
      setNoticeByArticle((current) => ({
        ...current,
        [articleId]: "Analysis complete: entities, narrative, embedding and event matching were updated."
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выполнить анализ");
    } finally {
      setActionState(null);
      setActionMessage(null);
    }
  }

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

  async function handlePrecompute() {
    setGlobalAction("precompute");
    setError(null);
    setActionMessage("Precomputing graph and similarity cache...");
    try {
      const result = await precomputeIntelligence({
        dateFrom,
        dateTo,
        sourceCode,
        language,
        limit: 100
      });
      setActionMessage(`Precompute complete: ${result.cached_graphs} graphs, ${result.cached_similar} similarity caches.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выполнить precompute");
    } finally {
      setGlobalAction(null);
    }
  }

  async function handleDiscoverNarratives() {
    setGlobalAction("discover_narratives");
    setError(null);
    setActionMessage("Discovering narratives across analyzed articles...");
    try {
      const result = await discoverNarratives();
      setActionMessage(`Narrative discovery complete: ${result.created_narratives} narratives from ${result.total_analyses} analyses.`);
      const narrativeList = await getNarratives().catch(() => [] as NarrativeListItem[]);
      setNarratives(narrativeList);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось найти нарративы");
    } finally {
      setGlobalAction(null);
    }
  }

  function resetFilters() {
    setSourceCode("");
    setLanguage("");
    setMaterialType("");
    setStatusFilter("");
    setSentimentFilter("");
    setDateFrom("");
    setDateTo("");
    setQuery("");
  }

  return (
    <main className={`${styles.page} ${styles[`density_${density}`]}`}>
      <section className={styles.commandBar}>
        <div className={styles.brandBlock}>
          <p className={styles.eyebrow}>Narrative Intelligence Platform</p>
          <h1>Центр анализа новостей</h1>
          <span>Источники, события, участники, фрейминг и нарративы в одном спокойном аналитическом потоке.</span>
        </div>
        <div className={styles.commandSearch}>
          <button className={styles.searchShell} onClick={() => setShowPalette(true)}>
            <span>Поиск по статьям, событиям, участникам и нарративам...</span>
            <kbd>Cmd K</kbd>
          </button>
          <div className={styles.quickActions}>
            <button onClick={handlePrecompute} disabled={globalAction !== null}>
              {globalAction === "precompute" ? "Считаю..." : "Подготовить графы"}
            </button>
            <button onClick={handleDiscoverNarratives} disabled={globalAction !== null}>
              {globalAction === "discover_narratives" ? "Ищу..." : "Найти нарративы"}
            </button>
            <Link href="/narratives">Нарративы</Link>
          </div>
        </div>
        <div className={styles.densitySwitch} aria-label="Density switch">
          {(["compact", "comfortable", "analyst"] as DensityMode[]).map((item) => (
            <button
              key={item}
              className={density === item ? styles.activeDensity : ""}
              onClick={() => setDensity(item)}
            >
              {capitalize(item)}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.metricsGrid}>
        {metrics.map((metric) => (
          <div className={styles.metricCard} key={metric.label}>
            <span className={styles.metricIcon}>{metric.icon}</span>
            <p>{metric.label}</p>
            <strong>{metric.value}</strong>
            <small>{metric.trend}</small>
          </div>
        ))}
      </section>

      <section className={styles.timelinePanel}>
        <div>
          <p className={styles.panelKicker}>Timeline</p>
          <h2>Публикации по дням</h2>
        </div>
        <div className={styles.timelineBars}>
          {timeline.length > 0 ? timeline.map((item) => (
            <span
              key={item.day}
              title={`${item.day}: ${item.count}`}
              style={{ height: `${Math.max(12, item.height)}%` }}
            />
          )) : <p>Пока нет данных</p>}
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
        <label>
          Статус
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="">Все</option>
            <option value="analyzed">Проанализировано</option>
            <option value="not_analyzed">Без анализа</option>
          </select>
        </label>
        <label>
          Тональность
          <select value={sentimentFilter} onChange={(event) => setSentimentFilter(event.target.value)}>
            <option value="">Все</option>
            {sentiments.map((item) => <option key={item} value={item}>{item}</option>)}
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
          <button onClick={loadArticles}>Retry</button>
        </div>
      ) : null}
      {entityId || entityName ? (
        <div className={styles.notice}>
          Entity focus: <strong>{entityName || `ID ${entityId}`}</strong>
          <button onClick={() => router.push("/articles")}>Clear</button>
        </div>
      ) : null}
      {actionMessage ? <div className={styles.notice}>{actionMessage}</div> : null}

      <section className={styles.dashboardGrid}>
        <section className={styles.feed}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.panelKicker}>Intelligence Feed</p>
              <h2>Лента материалов</h2>
            </div>
            <span>{visibleArticles.length} видно</span>
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
                notice={noticeByArticle[article.id]}
                onAnalyze={handleAnalyze}
                onCompare={(id) => router.push(`/articles/${id}/compare`)}
                onEvidence={(id) => router.push(`/articles/${id}/analysis`)}
                onEvent={(eventId) => router.push(`/events/${eventId}`)}
                onGraph={(id) => router.push(`/articles/${id}/graph`)}
                onSimilar={handleFindSimilar}
                similar={similarByArticle[article.id]}
              />
            ))
          )}
        </section>

        <aside className={styles.insightPanel}>
          <InsightCard title="Главное событие" kicker="Активный фокус">
            {spotlight ? (
              <>
                <strong>{spotlight.title}</strong>
                <p>{spotlight.source_name} · {formatDate(spotlight.published_at)}</p>
                <span className={spotlight.has_event ? styles.positiveBadge : styles.neutralBadge}>
                  {spotlight.has_event ? "событие связано" : "ожидает события"}
                </span>
              </>
            ) : <EmptyMini label="No event signal yet" />}
          </InsightCard>

          <InsightCard title="Топ нарративов" kicker="Гипотезы">
            {topNarrativeHypotheses.length > 0 ? (
              <div className={styles.rankList}>
                {topNarrativeHypotheses.map((item) => (
                  <span key={item.label}><b>{item.count}</b>{truncate(item.label, 82)}</span>
                ))}
              </div>
            ) : narratives.length > 0 ? (
              <div className={styles.rankList}>
                {narratives.slice(0, 5).map((item) => (
                  <Link href={`/narratives/${item.id}/graph`} key={item.id}><b>{item.evidence_count}</b>{truncate(item.title, 82)}</Link>
                ))}
              </div>
            ) : <EmptyMini label="Run narrative discovery to populate this panel" />}
          </InsightCard>

          <InsightCard title="Источники" kicker="Распределение">
            {sourceMix.length > 0 ? (
              <div className={styles.sourceMix}>
                {sourceMix.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <i style={{ width: `${Math.max(8, item.percent)}%` }} />
                    <b>{item.count}</b>
                  </div>
                ))}
              </div>
            ) : <EmptyMini label="No sources in current filter" />}
          </InsightCard>

          <InsightCard title="Сигнал системы" kicker="AI insight">
            <div className={styles.callout}>
              <strong>{buildAiInsight(visibleArticles, analysisByArticle)}</strong>
              <p>Используй сравнение и 3D-граф, чтобы увидеть различия фрейминга и общих участников.</p>
            </div>
          </InsightCard>
        </aside>
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
  notice,
  onAnalyze,
  onCompare,
  onEvidence,
  onEvent,
  onGraph,
  onSimilar,
  similar
}: {
  actionState: ActionState;
  analysis: ArticleAnalysisResponse | null;
  article: ArticleListItem;
  notice?: string;
  onAnalyze: (articleId: number) => void;
  onCompare: (articleId: number) => void;
  onEvidence: (articleId: number) => void;
  onEvent: (eventId: number) => void;
  onGraph: (articleId: number) => void;
  onSimilar: (articleId: number) => void;
  similar?: SimilarArticleItem[];
}) {
  const busy = actionState !== null;
  const entities = analysis?.entities.slice(0, 5) ?? [];
  return (
    <article className={styles.articleCard}>
      <div className={styles.cardTopline}>
        {article.source_code ? (
          <Link className={styles.sourceBadge} href={`/sources/${article.source_code}/profile`}>{article.source_name}</Link>
        ) : <span className={styles.sourceBadge}>{article.source_name}</span>}
        <span>{formatDate(article.published_at)}</span>
        <span>{article.language}</span>
        <span>{article.material_type}</span>
        <span className={article.has_analysis ? styles.positiveBadge : styles.warningBadge}>
          {article.has_analysis ? "анализ есть" : "без анализа"}
        </span>
        {article.has_event ? <span className={styles.eventBadge}>событие</span> : null}
      </div>

      <h3>{localizedArticleTitle(article, analysis)}</h3>
      <p className={styles.summary}>{localizedArticleSummary(article, analysis)}</p>

      <div className={styles.analysisGrid}>
        <InfoPill label="Тональность" value={analysis?.sentiment ?? "—"} tone={analysis?.sentiment ?? "neutral"} />
        <InfoPill label="Фрейминг" value={analysis?.framing ?? "Фрейминг появится после анализа"} />
        <InfoPill label="Нарратив" value={analysis?.narrative_hypothesis ?? "Запусти анализ, чтобы получить нарратив"} />
      </div>

      <div className={styles.entityRow}>
        {entities.length > 0 ? entities.map((entity) => (
          <span key={entity.id}>{entity.name}</span>
        )) : <span className={styles.mutedChip}>сущности ожидают анализа</span>}
      </div>

      <div className={styles.cardActions}>
        <button onClick={() => onAnalyze(article.id)} disabled={busy}>
          {actionState?.articleId === article.id && actionState.action === "analyze" ? "Анализ..." : "Анализ"}
        </button>
        <button onClick={() => onGraph(article.id)} disabled={busy}>3D-граф</button>
        <button onClick={() => onCompare(article.id)} disabled={busy}>Сравнить</button>
        <button onClick={() => article.event_id && onEvent(article.event_id)} disabled={busy || !article.event_id}>Событие</button>
        <button onClick={() => onEvidence(article.id)} disabled={busy || !article.has_analysis}>Доказательства</button>
        <button onClick={() => onSimilar(article.id)} disabled={busy}>Похожие</button>
      </div>

      {notice ? <div className={styles.successState}>{notice}</div> : null}
      {similar ? (
        <div className={styles.similarBox}>
          <strong>Similar coverage</strong>
          {similar.length === 0 ? (
            <p>No similar articles found. Create embeddings first.</p>
          ) : similar.slice(0, 3).map((item) => (
            <span key={`${article.id}-${item.article_id}`}>
              {item.source_name} · {truncate(item.title, 92)} · {item.score.toFixed(3)}
            </span>
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

function InsightCard({ children, kicker, title }: { children: ReactNode; kicker: string; title: string }) {
  return (
    <section className={styles.insightCard}>
      <p className={styles.panelKicker}>{kicker}</p>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function EmptyMini({ label }: { label: string }) {
  return <p className={styles.emptyMini}>{label}</p>;
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
            placeholder="Search articles, events, entities, narratives..."
          />
          <kbd>Esc</kbd>
        </div>
        <div className={styles.paletteGroup}>
          <button onClick={() => onNavigate("/narratives")}>Open narratives</button>
          <button onClick={() => onNavigate("/articles")}>Reset article feed</button>
        </div>
        <div className={styles.paletteResults}>
          {matches.map((article) => (
            <button key={article.id} onClick={() => onNavigate(`/articles/${article.id}/graph`)}>
              <span>{article.source_name}</span>
              <strong>{article.title}</strong>
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
      <strong>No articles found</strong>
      <p>Adjust filters, import sources, or run ingestion for a broader period.</p>
      <button onClick={onReset}>Reset filters</button>
    </div>
  );
}

function buildMetrics(
  articles: ArticleListItem[],
  sources: SourceInfo[],
  narratives: NarrativeListItem[],
  analysisByArticle: AnalysisMap
) {
  const analyzed = articles.filter((article) => article.has_analysis).length;
  const avgConfidence = average(
    Object.values(analysisByArticle)
      .map((analysis) => analysis?.confidence)
      .filter((value): value is number => typeof value === "number")
  );
  return [
    { icon: "AR", label: "Articles", value: articles.length.toString(), trend: `${analyzed} analyzed` },
    { icon: "EV", label: "Events", value: articles.filter((article) => article.has_event).length.toString(), trend: "linked coverage" },
    { icon: "NR", label: "Narratives", value: narratives.length ? narratives.length.toString() : "—", trend: narratives.length ? "discovered" : "run discovery" },
    { icon: "SO", label: "Sources", value: sources.length ? sources.length.toString() : "—", trend: "available adapters" },
    { icon: "AI", label: "Unprocessed", value: articles.filter((article) => !article.has_analysis).length.toString(), trend: "need analysis" },
    { icon: "CF", label: "Avg Confidence", value: Number.isFinite(avgConfidence) ? formatPercent(avgConfidence) : "—", trend: "analysis confidence" }
  ];
}

function buildTimeline(articles: ArticleListItem[]) {
  const counts = new Map<string, number>();
  for (const article of articles) {
    const day = new Date(article.published_at).toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const max = Math.max(...Array.from(counts.values()), 0);
  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-18)
    .map(([day, count]) => ({ day, count, height: max ? (count / max) * 100 : 0 }));
}

function topCounts(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const max = Math.max(...Array.from(counts.values()), 1);
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count, percent: (count / max) * 100 }));
}

function pickSpotlight(articles: ArticleListItem[]) {
  return [...articles].sort((left, right) => {
    const eventDelta = Number(right.has_event) - Number(left.has_event);
    if (eventDelta) return eventDelta;
    return new Date(right.published_at).getTime() - new Date(left.published_at).getTime();
  })[0];
}

function buildAiInsight(articles: ArticleListItem[], analysisByArticle: AnalysisMap) {
  const sentiments = new Set(Object.values(analysisByArticle).map((analysis) => analysis?.sentiment).filter(Boolean));
  const narratives = new Set(Object.values(analysisByArticle).map((analysis) => analysis?.narrative_hypothesis).filter(Boolean));
  if (sentiments.size >= 3 || narratives.size >= 3) {
    return "High narrative divergence detected across recent political coverage.";
  }
  if (articles.some((article) => !article.has_analysis)) {
    return "Several articles still need LLM analysis before narrative confidence can stabilize.";
  }
  return articles.length ? "Coverage is ready for graph inspection and cross-source comparison." : "No coverage loaded for the current filter.";
}

function average(values: number[]) {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function capitalize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
