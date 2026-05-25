type GraphStyles = Record<string, string>;

export function GraphBreadcrumbs({
  focusEntity,
  onReset,
  styles
}: {
  focusEntity: { id: number; name: string } | null;
  onReset: () => void;
  styles: GraphStyles;
}) {
  if (!focusEntity) return null;

  return (
    <div className={styles.focusBanner}>
      <strong>Фокус на объекте</strong>
      <span>{focusEntity.name}</span>
      <button onClick={onReset}>Показать исходную статью</button>
    </div>
  );
}
