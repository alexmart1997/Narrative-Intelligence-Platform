"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArticleAnalysisResponse, AnalysisEvidenceItem, getArticleAnalysis } from "@/lib/api";
import styles from "./page.module.css";

const evidenceSections = [
  { key: "framing", title: "Framing evidence" },
  { key: "sympathy", title: "Sympathy evidence" },
  { key: "criticism", title: "Criticism evidence" },
  { key: "narrative", title: "Narrative evidence" }
];

export default function ArticleAnalysisPage() {
  const params = useParams<{ id: string }>();
  const articleId = Number(params.id);
  const [analysis, setAnalysis] = useState<ArticleAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAnalysis() {
      setLoading(true);
      setError(null);
      try {
        setAnalysis(await getArticleAnalysis(articleId));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить анализ");
      } finally {
        setLoading(false);
      }
    }

    if (Number.isFinite(articleId)) {
      loadAnalysis();
    }
  }, [articleId]);

  const selectedEvidence = useMemo(() => {
    if (!analysis) return [];
    return evidenceSections.map((section) => ({
      ...section,
      items: analysis.evidence[section.key] ?? []
    }));
  }, [analysis]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/articles">
            Back to articles
          </Link>
          <p className={styles.eyebrow}>Article analysis</p>
          <h1>Analysis #{analysis?.id ?? params.id}</h1>
        </div>
        <Link className={styles.graphButton} href={`/articles/${articleId}/graph`}>
          Open graph
        </Link>
      </header>

      {loading ? <div className={styles.state}>Loading analysis...</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      {analysis ? (
        <section className={styles.layout}>
          <article className={styles.summaryCard}>
            <div className={styles.meta}>
              <span>{analysis.sentiment}</span>
              <span>confidence {formatPercent(analysis.confidence)}</span>
            </div>
            <h2>Summary</h2>
            <p>{analysis.short_summary}</p>
            <h3>Detailed summary</h3>
            <p>{analysis.detailed_summary}</p>
          </article>

          <section className={styles.findings}>
            <Finding title="Stance" value={analysis.stance} />
            <Finding title="Framing" value={analysis.framing} />
            <Finding title="Sympathizes with" value={analysis.sympathizes_with.join(", ") || "Not specified"} />
            <Finding title="Criticizes" value={analysis.criticizes.join(", ") || "Not specified"} />
            <Finding title="Narrative hypothesis" value={analysis.narrative_hypothesis} wide />
          </section>

          <section className={styles.explain}>
            <div className={styles.sectionHeader}>
              <p className={styles.eyebrow}>Explainability</p>
              <h2>Почему система так решила?</h2>
            </div>

            <div className={styles.evidenceGrid}>
              {selectedEvidence.map((section) => (
                <EvidenceGroup key={section.key} title={section.title} items={section.items} />
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </main>
  );
}

function Finding({ title, value, wide }: { title: string; value: string; wide?: boolean }) {
  return (
    <article className={`${styles.finding} ${wide ? styles.wide : ""}`}>
      <span>{title}</span>
      <p>{value}</p>
    </article>
  );
}

function EvidenceGroup({ items, title }: { items: AnalysisEvidenceItem[]; title: string }) {
  return (
    <article className={styles.evidenceGroup}>
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className={styles.emptyEvidence}>No explicit evidence saved yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <blockquote>{item.quote}</blockquote>
              <div className={styles.evidenceMeta}>
                <span>{item.target}</span>
                <span>{formatPercent(item.confidence)}</span>
              </div>
              <p>{item.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
