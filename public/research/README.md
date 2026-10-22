# Completed cooperation evaluation

All 1,776 episodes completed on 22 October 2026. Drafting reduced average
benchmark loss for both models, but worsened average performance against
Tit-for-Tat. Mutual cooperation occurred in 189/2,060 autonomous rounds (9.2%).
This amended study followed inspection of interrupted predecessor outcomes.
Its findings are descriptive; predecessor and engineering observations are excluded.

- [Report (PDF)](paper/report.pdf) and [LaTeX source](paper/main.tex)
- [Methods and amendments](protocol.md)
- [Summary](summary.json), [executed plan](plan.json) and [episode actions](episodes.json)
- [Condition means](condition-losses.csv), [block contrasts](block-contrasts.csv) and [opponent differences](policy-effects.csv)
- [Autonomous pairing results](crossplay.csv)
- [Executed source index](executed-source-index.json) and [public file checksums](manifest.json)

From the repository root, with Python 3.12 and uv:

```sh
uv sync --frozen
uv run python tools/verify_public_results.py
```

Verification reproduces scores, bootstrap intervals and CSVs, checks public file
hashes, and confirms that scoring, analysis, design and the dependency lockfile
match the executed versions. It requires no credentials or inference.

To compile the plain LaTeX report with a standard TeX installation:

```sh
latexmk -pdf -outdir=output/paper -jobname=report public/research/paper/main.tex
```

The plan and episode files are unchanged copies from the verified export. Raw
responses, private drafts, receipts and the executed source archive remain
private. Public data cannot authenticate provider identity, raw transport
history or billing. Checksums detect changes; they are not signatures.
Publication edits remove account defaults from the current checkout; the source
index identifies the archived executed source. Reference works are not redistributed.
