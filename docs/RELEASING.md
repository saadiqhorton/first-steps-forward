# Releasing

ADE is published to npm as `@dezignerdrugz/ade`. The package is staged from this repository by
`scripts/package.mjs`, not from the root `package.json` (that is the Lovable development
manifest), and contains only what the Node server needs at runtime.

1. Bump `version` in the root `package.json` (and the matching root entries in
   `package-lock.json`). npm never accepts the same version twice.
2. Build and pack:

   ```sh
   npm run package
   ```

   This builds the app, stages it in `.pack/stage`, and writes `.pack/dezignerdrugz-ade-<version>.tgz`.
   The package also ships ADE's own tracked source as `self-source/` (about +0.9 MB packed), which
   Customize ADE copies and later re-applies kept changes onto; packaging fails if it holds a
   `.env*`, `.pem`, `.key`, `settings.local.json` or `remote-token` file (`scripts/self-source.mjs`).

3. Optionally try the tarball the way users will run it:

   ```sh
   npx --yes --package ./.pack/dezignerdrugz-ade-<version>.tgz ade
   ```

4. Publish, signed in to npm as `dezignerdrugz` (`npm login`):

   ```sh
   npm publish .pack/dezignerdrugz-ade-<version>.tgz --access public
   ```

   Run this in your own terminal. npm asks you to approve the publish in the browser (two-factor
   authentication), and it cannot do that from a non-interactive shell. After the upload, npm
   processes the package for a few minutes before the new version is installable; until then
   `npm view @dezignerdrugz/ade` may show a `0.0.0-stage` placeholder.

The `README.md` in the package is the package's page on npmjs.com, so keep it about using ADE.
That page only changes when a new version is published.
