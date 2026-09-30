import type { FontDocument } from "@typewright/font-model";
import type { TextSettings } from "@typewright/view";
import { useState } from "react";

import { MAX_PROOF_SIZE, MIN_PROOF_SIZE } from "../limits.js";
import {
  LADDERS,
  type ProofBlock,
  isPlainBlock,
  ladderBlocks,
  withBlockAdded,
  withBlockRemoved,
  withBlockSettings,
  withBlockSize,
} from "../proof-blocks.js";
import { BarMenu } from "./BarMenu.js";
import { XIcon } from "./icons.js";
import { FeatureSwitches } from "./FeatureSwitches.js";
import { NumberField } from "./NumberField.js";
import styles from "./ProofBlocks.module.css";

/**
 * The sizes a waterfall is set at, as a row of chips, and what one of them is
 * set with.
 *
 * A chip per size and one place for the rest. A size is what a waterfall is
 * read by, so the sizes are the row: short, in the page's order, on one line
 * for a whole ladder. What a size is set with — its feature switches, removing
 * it — is asked about one size at a time, so it is shown for the chip chosen
 * rather than eleven times over; a dot on a chip says its features are not the
 * bar's, which is the one thing about the others worth seeing at a glance.
 *
 * The editing is here and not on the page. The proof draws the font and
 * nothing else, and the rules on the page carry the sizes, which is what a
 * reader needs.
 *
 * Ctrl and the wheel zoom the page rather than rewriting these sizes: a ladder
 * is a set of proportions, and scaling it a notch at a time rounded and pinned
 * it at the ends until zooming back out no longer gave it back. The zoom is
 * said at the end of the row while it is not 100%, and pressing it resets it.
 */
export function ProofBlocks({
  blocks,
  settings,
  size,
  zoom,
  document,
  applyFeatures,
  canShape,
  onChange,
  onApplyFeaturesChange,
  onZoomReset,
}: {
  readonly blocks: readonly ProofBlock[];
  /** How the bar is set, which a new block starts from and the dots compare against. */
  readonly settings: TextSettings;
  /** The size the slider holds, which a size added to an empty list starts from. */
  readonly size: number;
  /** How much larger than its sizes the page is drawn, from Ctrl and the wheel. */
  readonly zoom: number;
  readonly document: FontDocument;
  readonly applyFeatures: boolean;
  readonly canShape: boolean;
  readonly onChange: (next: readonly ProofBlock[]) => void;
  readonly onApplyFeaturesChange: (next: boolean) => void;
  readonly onZoomReset: () => void;
}): React.JSX.Element {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosenIndex = blocks.findIndex((b) => b.id === chosenId);
  const chosen = chosenIndex === -1 ? null : blocks[chosenIndex]!;

  const remove = (block: ProofBlock): void => {
    const at = blocks.findIndex((b) => b.id === block.id);
    const next = withBlockRemoved(blocks, block.id);
    onChange(next);
    // The choice moves to the neighbour, so a run of sizes can be taken off
    // with the key without choosing each one first.
    if (block.id === chosenId) setChosenId(next[Math.min(at, next.length - 1)]?.id ?? null);
  };

  const add = (): void => {
    const next = withBlockAdded(blocks, { size, settings });
    onChange(next);
    setChosenId(next[next.length - 1]?.id ?? null);
  };

  return (
    <div className={styles.blocks}>
      <span className={styles.heading}>Sizes</span>

      <ol className={styles.chips} aria-label="Sizes on the page">
        {blocks.map((block, index) => {
          const plain = isPlainBlock(block, settings);
          return (
            <li key={block.id} className={styles.chip} data-chosen={block.id === chosenId}>
              <button
                type="button"
                className={styles.size}
                aria-pressed={block.id === chosenId}
                aria-label={`Size ${String(index + 1)}: ${String(block.size)} pt${
                  plain ? "" : ", its own features"
                }`}
                title={plain ? undefined : "Set with features of its own"}
                onClick={() => setChosenId(block.id === chosenId ? null : block.id)}
                onKeyDown={(event) => {
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    remove(block);
                  }
                }}
              >
                {block.size}
                {plain ? null : <span className={styles.dot} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={styles.remove}
                title="Take this size off the page"
                aria-label={`Remove size ${String(index + 1)}`}
                onClick={() => remove(block)}
              >
                <XIcon />
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            className={styles.add}
            title="Add a size after the last one"
            aria-label="Add a size"
            onClick={add}
          >
            +
          </button>
        </li>
      </ol>

      {chosen === null ? (
        <span className={styles.hint}>Choose a size to change it or its features</span>
      ) : (
        <div className={styles.detail} role="group" aria-label="The size chosen">
          <NumberField
            value={chosen.size}
            onCommit={(next) => onChange(withBlockSize(blocks, chosen.id, next))}
            // Named by where it is on the page rather than by its size, which
            // would rename the field with every keystroke typed into it.
            label={`Size of block ${String(chosenIndex + 1)}`}
            title="The size this block is set at"
            className={styles.field}
            bounds={{ min: MIN_PROOF_SIZE, max: MAX_PROOF_SIZE }}
          />
          <span className={styles.unit}>pt</span>
          <FeatureSwitches
            value={chosen.settings}
            document={document}
            applyFeatures={applyFeatures}
            canShape={canShape}
            onChange={(next) => onChange(withBlockSettings(blocks, chosen.id, next))}
            onApplyFeaturesChange={onApplyFeaturesChange}
          />
        </div>
      )}

      <div className={styles.end}>
        {zoom === 1 ? null : (
          <button
            type="button"
            className={styles.zoom}
            title="Ctrl and the wheel zoom the page without changing its sizes. Press for 100% (Ctrl-0)"
            onClick={onZoomReset}
          >
            Zoom {Math.round(zoom * 100)}%
          </button>
        )}
        <BarMenu
          label="Ladder"
          title="Fill the page with a ladder of sizes"
          items={LADDERS.map((ladder) => ({
            kind: "item" as const,
            label: ladder.label,
            note: ladder.sizes.join(" "),
            run: () => {
              onChange(ladderBlocks(settings, ladder.sizes));
              setChosenId(null);
            },
          }))}
        />
      </div>
    </div>
  );
}
