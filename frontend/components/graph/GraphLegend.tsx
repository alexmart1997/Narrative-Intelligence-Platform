import { nodeTypes } from "./graphEncoding";

type GraphStyles = Record<string, string>;

export function GraphLegend({ styles }: { styles: GraphStyles }) {
  return (
    <div className={styles.legend}>
      {nodeTypes.map((item) => (
        <span key={item.type}>
          <i className={`${styles.legendDot} ${styles[item.type]}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
