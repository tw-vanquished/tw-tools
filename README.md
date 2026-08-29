# tw-tools

Web tools for Tribal Wars (es103), served via GitHub Pages.

- **twstats/** — statistics and history for world es103 (rankings, players, tribes, ennoblements, incomings, reports).
- **data/es103/** — mirrored world data (map txt files + static config XMLs), updated automatically.
- **js/** — shared report-intel modules the twstats pages load via `../js/` (`reports-intel.js` classifier, `report-render.js` in-game-style report renderer).
- **icons/** — unit and building icons used by the twstats hover cards and report views (`../icons/units/`, `../icons/buildings/`).

Cache note: GitHub Pages serves assets with `max-age=600`; every twstats asset change bumps the site-wide `?v=` token in the HTML files.
