import { Component } from "react";

import styles from "./ViewBoundary.module.css";

/**
 * What stands in a pane whose workspace threw while it was being drawn.
 *
 * React takes down everything above an error nothing caught: one panel reading
 * a field that was not there was the whole window gone blank, the font with it
 * as far as anybody looking could tell. The font was never at risk — it is in
 * the store and in the browser's copy, and neither is drawn — but a blank
 * window does not say so.
 *
 * So each pane's workspace is drawn inside one of these. What throws takes its
 * own pane and nothing else: the other pane, the bars and the status line stay,
 * and the pane says what happened, that the font is as it was, and offers to
 * draw the view again. Going to another workspace in the pane starts over too,
 * since the boundary is made anew for each.
 *
 * A class, because catching an error in the drawing is the one thing React
 * still gives only to classes.
 */
type Props = {
  readonly children: React.ReactNode;
  /** Told what was thrown, so that it is said on the status line as other failures are. */
  readonly onError?: (error: unknown) => void;
};

type State = { readonly thrown: { readonly error: unknown } | null };

export class ViewBoundary extends Component<Props, State> {
  override state: State = { thrown: null };

  static getDerivedStateFromError(error: unknown): State {
    return { thrown: { error } };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error);
  }

  override render(): React.ReactNode {
    const { thrown } = this.state;
    if (thrown === null) return this.props.children;

    const said = thrown.error instanceof Error ? thrown.error : null;
    return (
      <div className={styles.pane} role="alert">
        <div className={styles.sheet}>
          <h2 className={styles.title}>This view stopped working.</h2>
          <p className={styles.safe}>Your font is not affected: it is saved as it was.</p>
          <div>
            <button
              type="button"
              className={styles.again}
              onClick={() => this.setState({ thrown: null })}
            >
              Try again
            </button>
          </div>
          <p className={styles.what}>
            {said === null ? String(thrown.error) : `${said.name}: ${said.message}`}
          </p>
        </div>
      </div>
    );
  }
}
