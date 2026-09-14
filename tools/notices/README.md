# Third-party notices

Typewright is under the GPL, and nearly everything it is built from is under a licence
whose one condition is that its copyright notice and licence text travel with every copy.
Bundling breaks that quietly: the notice lived in a comment at the top of the library, and
the bundler throws comments away. So the notices are collected into
[`THIRD_PARTY_NOTICES.txt`](../../THIRD_PARTY_NOTICES.txt) at the root of the repository,
which the web build puts beside `index.html` and the desktop installer puts beside the
program.

```bash
node tools/notices/generate-notices.mjs
node tools/notices/generate-notices.mjs --check
```

The npm packages come from `pnpm licenses list --prod` and the Rust crates from
`cargo metadata`, with each package's own licence files read from where it is installed, so
run it after `pnpm install` and after the desktop shell has been checked or built once. A
package that ships no licence file gets the standard text of the licence it names, from
[`texts/`](texts), with its authors as the copyright holders.

What no manifest records is written into the script by hand: the Lucide icons copied into
the source, the credit for Tunni lines, ttfautohint, the WebView2 loader, the Rust standard
library, and the C libraries compiled into harfbuzzjs's and woff2-encoder's WebAssembly.
The texts for those are in `texts/` too, each as its project publishes it.

CI runs it with `--check`, so a dependency added or upgraded without the file being
written again fails the build.
