# Collection Archive

Collection Archive is a local-first desktop MVP for cataloging personal collectibles such as stamps, coins, postcards, old photos, documents, medals, banknotes, covers, and paper ephemera.

This `v0.1.0` release is focused on private collection management: custom lists, item records, local images, gallery browsing, and freeform digital album pages. It intentionally does not include authentication, cloud sync, marketplace features, or AI recognition.

## Status

MVP release candidate: `v0.1.0`

The project is usable for local testing and small personal archives, but it is still early software. Keep backups of important collection data.

## Features

- Local-first Electron desktop app
- SQLite archive stored on the user's machine
- Local image and thumbnail storage
- Custom countries or regions
- Custom collection types
- Item records with title, country, type, year, description, condition, purchase price, source, tags, favorites, and custom fields
- Multiple images per item
- Aspect-ratio-safe image rendering in library, gallery, detail, and album views
- Library filters for country, type, year, tag, and favorites
- Gallery browsing with thumbnail-based loading
- Item detail view with image metadata and zoomable viewer
- Album pages with freeform image/text placement
- Album preview modes for designed pages and cleaner visual browsing
- Manual ordering for countries/regions and collection types
- Developer performance seed and smoke test scripts

## Screenshots

Screenshots are intentionally left as placeholders for the GitHub release page.

- Library view: add screenshot here
- Gallery view: add screenshot here
- Item detail view: add screenshot here
- Album designed preview: add screenshot here
- Album editor: add screenshot here

Suggested location for future screenshots: `docs/screenshots/`.

## Stack

- React with Vite for the renderer UI
- Electron for the desktop shell and local filesystem access
- SQLite via `sql.js`
- Local image storage with generated thumbnails

## Local Data

The app stores archive data under Electron's user data folder in `collection-archive-data`:

- `archive.sqlite`
- `images/`
- `thumbnails/`

The exact folder can be opened from the in-app data-folder control. For tests and performance runs, scripts use separate temporary or perf data folders so they do not overwrite the user's real archive.

Do not commit local archive data, generated thumbnails, performance databases, smoke-test artifacts, or build output. `.gitignore` excludes these paths.

## Requirements

- Windows development environment
- Node.js and npm

The npm scripts are currently Windows-oriented and expect Node to be installed at the standard `C:\Program Files\nodejs\node.exe` location. The smoke scripts launch the Electron Windows binary from `node_modules`.

## Setup

Install dependencies:

```bash
npm install
```

Run the app in development mode:

```bash
npm run dev
```

Build the renderer:

```bash
npm run build
```

Run the built desktop shell:

```bash
npm start
```

## Smoke Testing

Build first:

```bash
npm run build
```

Then run the album/editor smoke test:

```bash
npm run smoke:album
```

The smoke test creates temporary test data and may write screenshots/logs to `test-artifacts/`. Those files are generated artifacts and should not be committed.

## Performance Testing

Generate a separate performance test archive:

```bash
npm run seed:perf -- --items 10000 --force
```

Run the performance smoke:

```bash
npm run test:perf
```

Performance data is stored under `perf-data/`, which is ignored by git.

## Known Limitations

- No authentication, users, roles, or permissions.
- No cloud sync or backup service.
- No import/export workflow for production migration yet.
- No packaged installer or auto-updater yet.
- Smoke/performance scripts are Windows-oriented.
- The app uses `sql.js`; very large archives should continue to be tested carefully.
- Album editing is functional but still MVP-level for precision layout workflows.
- Occasionally, text fields may stop accepting input after window restore/refocus. Workaround: switch album page/view and switch back.
- No AI image recognition, OCR, marketplace, or pricing features.
- Local archive data must be backed up manually.

## Release Hygiene

Before tagging `v0.1.0`:

1. Run `npm install`.
2. Run `npm run build`.
3. Run `npm run smoke:album`.
4. Confirm generated folders such as `node_modules/`, `dist/`, `test-artifacts/`, `perf-data/`, `.tmp-*`, and local `collection-archive-data/` folders are not tracked.
5. Add release screenshots to GitHub or to `docs/screenshots/` if desired.
