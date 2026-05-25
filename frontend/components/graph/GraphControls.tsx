import { VisualFilters } from "./types";

type GraphStyles = Record<string, string>;

export function GraphControls({
  filters,
  styles,
  updateFilter
}: {
  filters: VisualFilters;
  styles: GraphStyles;
  updateFilter: <K extends keyof VisualFilters>(key: K, value: VisualFilters[K]) => void;
}) {
  return (
    <details className={styles.filterPanel}>
      <summary>Фильтры</summary>
      <div className={styles.filterBody}>
      <label>
        <input type="checkbox" checked={filters.showEntities} onChange={(event) => updateFilter("showEntities", event.target.checked)} />
        сущности
      </label>
      <label>
        <input type="checkbox" checked={filters.showArticles} onChange={(event) => updateFilter("showArticles", event.target.checked)} />
        статьи
      </label>
      <label>
        <input type="checkbox" checked={filters.showSources} onChange={(event) => updateFilter("showSources", event.target.checked)} />
        источники
      </label>
      <label>
        <input type="checkbox" checked={filters.showNarratives} onChange={(event) => updateFilter("showNarratives", event.target.checked)} />
        гипотезы
      </label>
      <label>
        <input type="checkbox" checked={filters.showWeakEdges} onChange={(event) => updateFilter("showWeakEdges", event.target.checked)} />
        все связи
      </label>
      <label>
        уверенность
        <input
          type="range"
          min="0"
          max="0.95"
          step="0.05"
          value={filters.confidenceThreshold}
          onChange={(event) => updateFilter("confidenceThreshold", Number(event.target.value))}
        />
      </label>
      <label>
        подписи
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          value={filters.labelDensity}
          onChange={(event) => updateFilter("labelDensity", Number(event.target.value))}
        />
      </label>
      </div>
    </details>
  );
}
