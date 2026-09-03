import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Lint rules, chosen for what they catch rather than for what they tidy.
 *
 * Type-aware checking is switched on deliberately, and it is most of the point.
 * Rules that only read the syntax can tell you a variable is unused; rules that
 * can see the types are the ones that notice a promise nobody waited for, a
 * `catch` that assumes an `Error`, or a condition that is always true because
 * the value can never be null. Those are bugs, and this codebase has already had
 * two of the first kind.
 *
 * Formatting rules are all switched off at the end: Prettier decides layout, and
 * a linter with an opinion about it only produces arguments no one wins.
 */
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // The model is full of deliberate `!` after a bounds check the compiler
      // cannot follow — `nodes[i]!` inside a loop over `nodes`, and so on. The
      // alternative is a guard on every access that can never fire, which reads
      // worse and hides the ones that matter.
      "@typescript-eslint/no-non-null-assertion": "off",

      // Index signatures are already strict here (`noUncheckedIndexedAccess`),
      // so a lookup returns `T | undefined` and the checks around it are real.
      "@typescript-eslint/no-unnecessary-condition": [
        "error",
        { allowConstantLoopConditions: true },
      ],

      // An unused argument named with a leading underscore is a signature being
      // honoured on purpose — `pointerUp(state, _input)` says the tool takes the
      // input and does not need it.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Fires on `onClick={() => store.setTool(id)}` and every arrow that
      // forwards to something returning void, which is idiomatic here and in
      // React generally. It catches no bugs and would cost ninety-five
      // wrappers.
      "@typescript-eslint/no-confusing-void-expression": "off",

      // `delete record[key]` is how a glyph leaves the document. The rule wants
      // a Map, and the model is deliberately plain JSON-able objects so that
      // serialising it stays a matter of writing it out.
      "@typescript-eslint/no-dynamic-delete": "off",

      // `[...text]` walks a string by code point, which is what glyph lookup
      // wants and is already better than `split("")`. The rule is warning about
      // grapheme clusters, which is a different question from the one being
      // asked here.
      "@typescript-eslint/no-misused-spread": "off",

      // Template literals stringify anything; saying so in a message is usually
      // what was meant. The rule's value is in catching `${someObject}`, which
      // the narrower setting still does.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },

  {
    // Tests reach into shapes on purpose — a malformed glyph, a response for a
    // request that does not exist — to check what happens. Casting to get there
    // is the test doing its job.
    files: ["**/test/**/*.ts"],
    rules: {
      // A test asserting something the types already guarantee is a test that
      // will still fail if the types stop guaranteeing it, which is the point.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // A test may be async because the thing it stands in for is, not because
      // this particular case awaits anything.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
    },
  },

  {
    // The config itself is plain JavaScript and not in any tsconfig, so the
    // type-aware rules have nothing to read it with.
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
