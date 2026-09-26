import type { FontDocument } from "@typewright/font-model";
import type { TextSettings } from "@typewright/view";

import { MAX_PROOF_SIZE, MIN_PROOF_SIZE } from "../limits.js";
import {
  type ProofBlock,
  ladderBlocks,
  withBlockAdded,
  withBlockRemoved,
  withBlockSettings,
  withBlockSize,
} from "../proof-blocks.js";
import { FeatureSwitches } from "./FeatureSwitches.js";
import { NumberField } from "./NumberField.js";
import styles from "./ProofBlocks.module.css";

/**
 * The blocks a waterfall is set as: a size and a feature set for each.
 *
 * A row per block rather than controls drawn beside each block on the page. The
 * proof draws the font and nothing else — no handles, no margins, nothing to
 * click — and a row of buttons floating over a specimen at 72 pt would be the
 * first mark on the page that is not the type. The rules on the page carry the
 * sizes, which is what a reader needs; the editing is up here with the rest of
 * the controls.
 *
 * Ordered as the page is, top to bottom, so the panel reads as the thing it
 * edits. The ladder button fills in the sizes a specimen sheet has used for a
 * century; the rows are then whatever somebody makes of them, because the point
 * of the ladder is to be argued with.
 */
export function ProofBlocks({
  blocks,
  settings,
  size,
  document,
  applyFeatures,
  canShape,
  onChange,
  onApplyFeaturesChange,
}: {
  readonly blocks: readonly ProofBlock[];
  /** How the bar is set, which a new block starts from and the rules compare against. */
  readonly settings: TextSettings;
  /** The size the slider holds, which the first block starts from. */
  readonly size: number;
  readonly document: FontDocument;
  readonly applyFeatures: boolean;
  readonly canShape: boolean;
  readonly onChange: (next: readonly ProofBlock[]) => void;
  readonly onApplyFeaturesChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <div className={styles.blocks}>
      <span className={styles.heading}>Blocks</span>

      <ol className={styles.list}>
        {blocks.map((block, index) => (
          <li key={block.id} className={styles.row}>
            <NumberField
              value={block.size}
              onCommit={(next) => onChange(withBlockSize(blocks, block.id, next))}
              // Named by where it is on the page rather than by its size, which
              // would rename the field with every keystroke typed into it, or by
              // its identifier, which means nothing to anybody.
              label={`Size of block ${String(index + 1)}`}
              title="The size this block is set at"
              className={styles.size}
              bounds={{ min: MIN_PROOF_SIZE, max: MAX_PROOF_SIZE }}
            />
            <span className={styles.unit}>pt</span>

            <FeatureSwitches
              value={block.settings}
              document={document}
              applyFeatures={applyFeatures}
              canShape={canShape}
              onChange={(next) => onChange(withBlockSettings(blocks, block.id, next))}
              onApplyFeaturesChange={onApplyFeaturesChange}
            />

            <button
              type="button"
              className={styles.remove}
              title="Take this block off the page"
              aria-label={`Remove block ${String(index + 1)}`}
              onClick={() => onChange(withBlockRemoved(blocks, block.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ol>

      <button
        type="button"
        className={styles.action}
        onClick={() => onChange(withBlockAdded(blocks, { size, settings }))}
      >
        Add block
      </button>
      <button
        type="button"
        className={styles.action}
        title="The sizes a specimen sheet is set at"
        onClick={() => onChange(ladderBlocks(settings))}
      >
        Fill ladder
      </button>
    </div>
  );
}
