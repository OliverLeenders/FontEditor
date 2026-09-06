# Checking the OTF's mark attachment against fontTools

The sibling of [`../ufo-check`](../ufo-check/README.md), for the binary. The argument is
the same: a font only this repository has ever read proves consistency, not correctness.

What it checks is the part of GPOS that puts accents on letters. That table is a tree of
offsets into offsets — a coverage table for the marks, another for the bases, a mark array
with one class and one anchor each, a base array with one anchor per class per glyph, and
a null offset wherever a base does not take that class. Every one of those can be the
right length and the wrong number, and a test written here would be checking our arithmetic
against our own arithmetic.

So the font is handed to [fontTools](https://github.com/fonttools/fonttools), which
decompiles the tables structurally and knows nothing about how they were written. The
check then asks for the anchors back by name and compares them with what was drawn.

```bash
pip install -r ../ufo-check/requirements.txt
OTF_OUT=/tmp/otf pnpm --filter @fonteditor/font-io exec vitest run proof-otf
python check_otf.py /tmp/otf/TunniMarks-Regular.otf
```

The font it reads comes from `packages/font-io/test/proof-otf.test.ts`: a letter offering
two places, an accent that attaches by one of them and offers a place of its own, a second
accent that stacks there, and a mark for the class the letter's other anchor names. That
covers a base with a null anchor for a class it does not take, and the difference between
mark-to-base and mark-to-mark.
