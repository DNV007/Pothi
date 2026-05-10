# Ship checklist — today

## 1. Compile the manuscript (5 min)

```sh
cd "/home/ksarkar/Nextcloud/DataNexusVista/GUI/KPlannar/PersonalDevelopments/RefMgr"
pdflatex manuscript.tex
pdflatex manuscript.tex     # second pass for refs
```

If `pdflatex` isn't installed: `sudo apt install texlive-latex-recommended texlive-fonts-extra`.
Output: `manuscript.pdf`. Skim it; tweak any line that feels wrong.

## 2. Set up the GitHub repo (10 min)

Create a new public repo on github.com (suggest name: `pothi`).

```sh
cd "/home/ksarkar/Nextcloud/DataNexusVista/GUI/KPlannar/PersonalDevelopments/RefMgr"
git init -b main
git add .
git commit -m "Initial release: Pothi v0.1"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/pothi.git
git push -u origin main
git tag v0.1
git push origin v0.1
```

On the GitHub web UI:
- Add a 1-line description: *Local-first, manuscript-first reference manager.*
- Add topics: `reference-manager`, `bibtex`, `bibliography`, `local-first`, `research`, `crossref`, `arxiv`, `pdf`
- Make a release from the `v0.1` tag with the manuscript abstract as release notes.

## 3. arXiv submission (~30 min, +1 day for it to go live)

If you don't have an arXiv account: register, then ask a colleague who has
posted on arXiv to endorse you (you can't submit without endorsement on
your first paper in a new subject class).

- Subject class (primary): `cs.DL` (Digital Libraries)
- Cross-list: `cs.HC` (Human-Computer Interaction)
- License: choose `CC BY 4.0` (you keep copyright; readers can share + adapt)
- Upload: the `manuscript.tex` source. arXiv recompiles it; this is preferred.
- Fields:
  - Title: `Pothi: owning your bibliography`
  - Comments: `13 pages. Code: https://github.com/<YOU>/pothi`
  - Abstract: paste from manuscript.tex (between `\begin{abstract}` and `\end{abstract}`)

After submission, arXiv goes through a moderation step (usually <24 h). When
it's live you'll get a permanent URL like `https://arxiv.org/abs/2605.NNNNN`.

## 4. LinkedIn (5 min)

Open `LINKEDIN.md` in this folder. Replace `[arXiv link]` and `[GitHub link]`
with the real URLs. Paste into LinkedIn. Tag 3–5 colleagues who write papers.

## 5. Optional but high-leverage

- **Hacker News** Show HN post: title `Show HN: Pothi – local-first
  reference manager that runs in your browser`. Best time: 8–10 AM US-EST
  weekdays.
- **Reddit r/academia, r/Zotero, r/LaTeX** — short post linking the GitHub
  repo + arXiv preprint, framed as "I built this, here's why, MIT licensed."
- **Mastodon scholar.social** — research crowd, friendly to indie tools.
- **Bluesky** academic communities are growing; post once it's live.

## What you might still want to fix before pushing

- Update the GitHub URL in `manuscript.tex` (search for `<REPO>`) and
  recompile.
- Update `pcksarkar@gmail.com` in `manuscript.tex` if you want a different
  contact.
- Move the project folder from `RefMgr/` to `Pothi/` (cosmetic; the dev
  server is bound to the current path so this is a clean-up step, not a
  blocker).
- Optional: add a small SVG icon to `vendor/` and reference it in
  `index.html`'s `<link rel="icon">`.

## What I would NOT spend time on today

- Bug-hunting from a 2-week soak (you said no soak — ship as v0.1)
- Reorganizing the code
- Adding features
- Polishing the manuscript prose beyond fixing typos
- Writing tests

The whole point of v0.1 is `out the door`. v0.2 fixes whatever the first
real-world users hit.
