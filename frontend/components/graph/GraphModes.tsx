import { translateGraphMode } from "./graphEncoding";
import { GraphMode } from "./types";

type GraphStyles = Record<string, string>;

export const graphModes: GraphMode[] = ["article", "similar", "entity", "compare"];

export function GraphModes({
  mode,
  onChange,
  styles
}: {
  mode: GraphMode;
  onChange: (mode: GraphMode) => void;
  styles: GraphStyles;
}) {
  return (
    <div className={styles.modeBar}>
      {graphModes.map((item) => (
        <button
          key={item}
          className={mode === item ? styles.activeMode : ""}
          onClick={() => onChange(item)}
        >
          {translateGraphMode(item)}
        </button>
      ))}
    </div>
  );
}
