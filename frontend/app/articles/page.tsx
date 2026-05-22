"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArticleListItem,
  SimilarArticleItem,
  SourceInfo,
  analyzeArticle,
  getArticles,
  getSimilarArticles,
  getSources
} from "@/lib/api";
import styles from "./page.module.css";

type ActionState = {
  articleId: number;
  action: ArticleAction;
} | null;

type ArticleAction = "analysis" | "analyze" | "compare" | "graph" | "similar";

export default function ArticlesPage() {
  const router = useRouter();
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceCode, setSourceCode] = useState("");
  const [language, setLanguage] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>(null);
  const [similarByArticle, setSimilarByArticle] = useState<Record<number, SimilarArticleItem[]>>({});

  const languages = useMemo(() => ["ru", "en"], []);

  async function loadArticles() {
    setLoading(true);
    setError(null);
    try {
      const [sourceList, articleList] = await Promise.all([
        getSources(),
        getArticles({ sourceCode, language, q: query })
      ]);
      setSources(sourceList);
      setArticles(articleList.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить статьи");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadArticles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAnalyze(articleId: number) {
    setActionState({ articleId, action: "analyze" });
    setError(null);
    try {
      await analyzeArticle(articleId);
      await loadArticles();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось выполнить анализ");
    } finally {
      setActionState(null);
    }
  }

  function handleOpenGraph(articleId: number) {
    router.push(`/articles/${articleId}/graph`);
  }

  function handleCompare(articleId: number) {
    router.push(`/articles/${articleId}/compare`);
  }

  function handleOpenAnalysis(articleId: number) {
    router.push(`/articles/${articleId}/analysis`);
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

  function actionLabel(articleId: number, action: ArticleAction) {
    if (actionState?.articleId === articleId && actionState.action === action) {
      return "Loading...";
    }
    if (action === "analysis") return "Open analysis";
    if (action === "analyze") return "Analyze";
    if (action === "compare") return "Compare";
    if (action === "graph") return "Open graph";
    return "Find similar";
  }

  return (
    <main className={styles.page}>
      <section className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Narrative Intelligence</p>
          <h1>Articles</h1>
        </div>
        <button className={styles.primaryButton} onClick={loadArticles} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </section>

      <section className={styles.filters} aria-label="Article filters">
        <label>
          Source
          <select value={sourceCode} onChange={(event) => setSourceCode(event.target.value)}>
            <option value="">All sources</option>
            {sources.map((source) => (
              <option key={source.code} value={source.code}>
                {source.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Language
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="">All languages</option>
            {languages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.searchLabel}>
          Search title/text
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. elections, Молдавия, Meta"
          />
        </label>

        <button className={styles.primaryButton} onClick={loadArticles} disabled={loading}>
          Apply
        </button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.content}>
        <div className={styles.list}>
          {loading ? (
            <div className={styles.loading}>Loading articles...</div>
          ) : articles.length === 0 ? (
            <div className={styles.empty}>No articles found.</div>
          ) : (
            articles.map((article) => (
              <article className={styles.card} key={article.id}>
                <div className={styles.cardMeta}>
                  <span>{article.source_name}</span>
                  <span>{article.language}</span>
                  <span>{formatDate(article.published_at)}</span>
                </div>
                <h2>{article.title}</h2>
                <p>{article.text_preview}</p>
                <div className={styles.actions}>
                  <button
                    onClick={() => handleAnalyze(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "analyze")}
                  </button>
                  <button
                    onClick={() => handleOpenAnalysis(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "analysis")}
                  </button>
                  <button
                    onClick={() => handleOpenGraph(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "graph")}
                  </button>
                  <button
                    onClick={() => handleCompare(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "compare")}
                  </button>
                  <button
                    onClick={() => handleFindSimilar(article.id)}
                    disabled={actionState !== null}
                  >
                    {actionLabel(article.id, "similar")}
                  </button>
                </div>
                {similarByArticle[article.id] ? (
                  <div className={styles.similar}>
                    <h3>Similar articles</h3>
                    {similarByArticle[article.id].length === 0 ? (
                      <p>No similar articles yet.</p>
                    ) : (
                      <ul>
                        {similarByArticle[article.id].map((item) => (
                          <li key={`${article.id}-${item.article_id}`}>
                            <strong>{item.source_name}</strong> · {item.title} · score{" "}
                            {item.score.toFixed(3)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>

        <aside className={styles.graphPanel}>
          <h2>Graph view</h2>
          <p>
            Use <strong>Open graph</strong> to inspect the article, source,
            entities, narrative and relations in an interactive canvas.
          </p>
        </aside>
      </section>
    </main>
  );
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
