# Third-party components

- PDF.js / pdfjs-dist — Mozilla Foundation and contributors, Apache-2.0. PDF rendering, text layer, fonts, CMaps and WASM. The small `src/text-layer.css` is adapted from the package's viewer stylesheet. Full license: [licenses/PDFJS.txt](licenses/PDFJS.txt). Bundled auxiliary assets may carry their own notices in the installed package; preserve those notices when redistributing them.
- React / React DOM — Meta and contributors, MIT.
- Lucide — Lucide contributors, ISC, with Feather-derived portions under MIT. See [licenses/LUCIDE.txt](licenses/LUCIDE.txt).
- Vite — Vite contributors, MIT.
- TypeScript — Microsoft and contributors, Apache-2.0 (development dependency).
- PyMuPDF — optional, separately installed dependency of the Python adapter; GNU AGPL-3.0 or Artifex commercial licensing, as declared by the tested 1.28.2 installation. It is not bundled into the web application.

React's notice is retained in [licenses/REACT.txt](licenses/REACT.txt). The lockfile records the installed JavaScript dependency graph; each package's own license and notices remain applicable. This list is not a replacement for all transitive dependency notices.

The original Margina application code has no selected project license. `UNLICENSED` in package metadata does not replace or alter third-party licenses.

Sample PDF files and existing translations are local copies of the user's research materials, not part of the application's software license. `public/samples/` is excluded from Git and must not be published or redistributed with this prototype.
