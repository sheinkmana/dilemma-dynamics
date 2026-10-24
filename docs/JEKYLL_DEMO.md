# Standalone Jekyll demo

24 October release: both completed temperature studies, the combined report and
public action datasets are included. The separate website post, README, deployment
verifier and 35-file demo have been updated locally; Jekyll, PurgeCSS and all
copy/link/checksum checks passed. See [the current release record](RELEASE_2026-10-24.md).
The 23 October build records below are historical.

Local website migration completed on 23 October 2026: the demo directory,
native post, links, minifier exclusion and deployment verifier now use
`dilemma-dynamics`. The production Jekyll build, PurgeCSS step and verifier
passed; all 22 demo files were copied byte-for-byte, including the public
research package. The renamed post and demo were checked in the browser.
These changes are local and have not been committed, pushed or deployed.

The initial game-type clarification updated the website post, README and
static demo together. It identifies the repeated Prisoner's Dilemma as the main
cooperation study and the local app's Dots & Boxes/Tic-tac-toe playground as a
separate recreational side project. The website demo still offers saved dilemma
episodes and Results only; it explains the distinction without adding live
controls or board-game sessions.

The current post leads with the dilemma evaluation and places recreational board
games in a short extra at the end. Replay and Results likewise keep that extra
below the study content. Benchmark wording describes achievable payoff forgone,
with the reference opponent policy and optimal continuation stated explicitly.

The `public` Vite mode builds recorded Study replay and Results for `/dilemma-dynamics/`.
It uses a separate browser entry (`src/web/public.tsx`) that does not import
the local app controls. Unknown hashes fall back to Study replay; `#results`
opens Results. All public assets, data fetches, and download links use Vite's
configured base URL. The normal `npm run build` retains the full localhost app.

```sh
npm run build:public
npm run preview:public
```

Open `http://127.0.0.1:4173/dilemma-dynamics/` to preview. No API server or key is needed.
Each build replaces `dist/web/`, so export only immediately after `build:public`.
The build keeps only manifest-listed research files and verifies their checksums;
temporary report compiler files are excluded from the export.

## Website integration

Copy `dist/web/` into the Jekyll source's `dilemma-dynamics/` directory and copy the
project `LICENSE` to `dilemma-dynamics/LICENSE.txt`. Use the native post
`_posts/2026-10-23-dilemma-dynamics.md`, with permalink `/blog/2026/dilemma-dynamics/` and a
prominent demo link. It documents both completed temperature studies and their
descriptive sensitivity comparison, links both action datasets and the combined
report, and offers temperature selection in Replay and Results.

For an existing Game Field integration, rename the demo directory and post,
update its links and exclusion below, and rename the website verifier from
`bin/verify-game-field.py` to `bin/verify-dilemma-dynamics.py`. Update its expected
paths and the website workflow invocation too. These website files live in the
separate website repository; rebuilding this project alone does not migrate them.

The website must retain this exclusion:

```yaml
jekyll-minifier:
  exclude: ['robots.txt', 'dilemma-dynamics/**']
```

Vite already minifies the JavaScript and CSS. The site's legacy Uglifier rejects
modern bundle syntax. Excluding the whole directory also preserves the public
research files byte-for-byte, including their checksum manifest. Jekyll copies
the demo's index without front matter; it is separate from the al-folio layout.

Run the site's existing production build and CSS step, then its added verifier:

```sh
JEKYLL_ENV=production bundle exec jekyll build --trace --lsi
purgecss -c purgecss.config.js
python3 bin/verify-dilemma-dynamics.py
```

The verifier checks all copied demo files, research checksums, and post/asset
links. The workflow runs it before deployment. PurgeCSS targets only the theme's
`_site/assets/css/`, not `_site/dilemma-dynamics/assets/`.

Serve the built `_site/` directory from the website root, then check the post,
default replay, both temperatures and tracks, procedure comparison, round controls, Results
filters, themes, and downloads. No app server should be running. Only saved
public evidence belongs in the export; do not copy local data, study output,
credentials, or the server build.

The existing website workflow publishes on a push to `master` or `main`.
Local preparation and validation do not publish either repository.
