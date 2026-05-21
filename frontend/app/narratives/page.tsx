"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  NarrativeDetailResponse,
  NarrativeListItem,
  getNarrative,
  getNarratives
} from "@/lib/api";
import styles from "./page.module.css";

type NarrativeCard = NarrativeListItem & {
  confidence: number;
  topSources: Array<{ name: string; count: number }>;
};

export default function NarrativesPage() {
  const [narratives, setNarratives] = useState<NarrativeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadNarratives() {
    setLoading(true);
    setError(null);
    try {
      const list = await getNarratives();
      const details = await Promise.all(list.map((item) => getNarrative(item.id)));
      setNarratives(details.map(toNarrativeCard));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить нарративы");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNarratives();
  }, []);

  const totalEvidence = useMemo(
    () => narratives.reduce((sum, narrative) => sum + narrative.evidence_count, 0),
    [narratives]
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} href="/">
            Back home
          </Link>
          <p className={styles.eyebrow}>Narrative Intelligence</p>
          <h1>Narratives</h1>
          <p className={styles.subtitle}>
            Discovered storylines grouped from article analysis hypotheses.
          </p>
        </div>
        <button className={styles.primaryButton} onClick={loadNarratives} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </header>

      <section className={styles.summary}>
        <Stat label="Narratives" value={narratives.length.toString()} />
        <Stat label="Supporting articles" value={totalEvidence.toString()} />
        <Stat label="Avg confidence" value={formatPercent(average(narratives.map((item) => item.confidence)))} />
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {loading ? <div className={styles.state}>Loading narratives...</div> : null}
      {!loading && !error && narratives.length === 0 ? (
        <div className={styles.state}>
          No narratives found yet. Run <code>POST /narratives/discover</code> after analyzing articles.
        </div>
      ) : null}

      <section className={styles.grid}>
        {narratives.map((narrative) => (
          <article className={styles.card} key={narrative.id}>
            <div className={styles.cardHeader}>
              <div>
                <p className={styles.cardMeta}>Narrative #{narrative.id}</p>
                <h2>{narrative.title}</h2>
              </div>
              <span className={`${styles.confidence} ${confidenceClass(narrative.confidence)}`}>
                {formatPercent(narrative.confidence)}
              </span>
            </div>

            <p className={styles.description}>{narrative.description}</p>

            <div className={styles.frame}>
              <span>Frame</span>
              <p>{narrative.frame}</p>
            </div>

            <div className={styles.details}>
              <div>
                <span>Supporting articles</span>
                <strong>{narrative.evidence_count}</strong>
              </div>
              <div>
                <span>Top sources</span>
                {narrative.topSources.length === 0 ? (
                  <strong>None</strong>
                ) : (
                  <ul className={styles.sources}>
                    {narrative.topSources.map((source) => (
                      <li key={source.name}>
                        {source.name} <em>{source.count}</em>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <Link className={styles.graphButton} href={`/narratives/${narrative.id}/graph`}>
              Open narrative graph
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function toNarrativeCard(detail: NarrativeDetailResponse): NarrativeCard {
  return {
    ...detail,
    evidence_count: detail.evidence.length,
    confidence: average(detail.evidence.map((item) => item.confidence)),
    topSources: topSources(detail)
  };
}

function topSources(detail: NarrativeDetailResponse) {
  const counts = new Map<string, number>();
  for (const evidence of detail.evidence) {
    counts.set(evidence.source_name, (counts.get(evidence.source_name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 3);
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function confidenceClass(value: number) {
  if (value >= 0.7) return styles.high;
  if (value <= 0.4) return styles.low;
  return styles.medium;
}
