# Changelog

All notable changes to this module are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the module follows
[semantic versioning](https://semver.org/).

## 2.2.1 - 2026-11-04

### Fixed

- A file that Jahia had sized did not load in a review rendering. Its address kept the sizing
  query, which ended up attached to the signature, so the file was refused. Only files Jahia had
  not sized were reaching the reviewer; on a real page that was 2 of 41.

## 2.2.0 - 2026-11-04

### Added

- **A second kind of link, for review before publication.** `cshmix:reviewUrl` carries its own key
  and its own expiry date, and serves the content as it stands in the authoring workspace rather
  than the published version. It lets someone outside the site read a draft without an account and
  without the content being published first.

  A node can carry both kinds at once, with different keys and different expiry dates. Which one a
  request is depends on the key alone, because the two keys live in different properties: holding a
  link to published content does not let anyone ask for the unpublished version of it.

  **A review link must carry an expiry date**; one without is refused. Reviewers are outside the
  site, so the link has to stop on its own.

  A review link renders the page from the authoring workspace, so it shows everything on that page
  that is not published yet, including other people's work in progress. Reviewers see a notice
  saying so. It is a separate mixin rather than a field on the first one so that a site can decide
  separately where review sharing is allowed.

  Images, stylesheets and scripts in a review rendering come back through the endpoint, signed with
  the sharing key, and are served under the same key and the same expiry date as the page. Without
  that a draft arrived as text with nothing else loading, because its files are addressed in the
  authoring workspace and a reviewer may not read them. The signature means only a caller holding
  the key can ask for a file, and the endpoint refuses a path that is not a file or belongs to
  another site. Jahia's sizing query is dropped, so a file arrives as stored. Navigation links are
  not rewritten and do not open for a reviewer, which is what the notice says.

## 2.1.0 - 2026-11-04

### Added

- **A page can be shared.** The mixin now applies to `jnt:page` as well as to content items and
  files, so a contributor can put a sharing link on a page.
- A shared page renders with the site's chrome, and a visitor holding one link can open nothing the
  navigation points at, so the rendering carries a short notice saying so, in the visitor's
  language. A site that would rather render a shared page without its header and footer, or show
  its own notice, branches on the request attributes documented in the README.

## 2.0.0 - 2026-11-04

### Breaking

- The module's content model moves to its own namespace. The mixin becomes `cshmix:sharedUrl` and
  its properties `cshare:sharedUrl` and `cshare:sharedUrlExpiry`. The names it used before were
  built on a two-character prefix that other modules of the same family also claim; where two
  modules claim it, the one installed second brings neither its content model nor its editor field,
  reports no error, and leaves the next module installed on that server without its own content
  model either. On a server where this module never worked there is nothing to migrate, and
  [`UPGRADE.md`](UPGRADE.md) tells you how to check. Where it did work, the scripts under
  `migration/` carry existing links over, and `UPGRADE.md` gives the order to run them in.

### Added

- A shared link can carry an **expiry date**. The link stops working after that date; leaving the
  field empty keeps a link that never expires.
- The repository builds on a continuous integration workflow: the module is built, the front-end is
  linted and audited, and the sources are scanned on every pull request.

### Changed

- The editor field is built on Moonstone and the React runtime jContent provides. The deprecated
  Material UI, design system kit and react-material dependencies are gone.
- Sharing keys are drawn from the browser's cryptographic random generator over a URL-safe
  alphabet, and the default length is 24 characters.
- The share URL carries the language as `lang`. A link that uses the former name keeps working: it
  is redirected to the current form.
- The build pins Node 22, commits its lock file, and commits the generated front-end so that a
  package always carries the editor field.
- Responses from the sharing endpoint are not stored by caches, are kept out of search engines, and
  do not pass the link on to third-party sites.

### Fixed

- A shared link to a **file** delivers that file as a download.
- A shared link to a page or a content item renders it for the visitor who opens it, whether or not
  that visitor is signed in.
- A request the endpoint cannot serve is answered the same way whatever the reason for it, and a
  method the endpoint does not accept is refused.

### Compatibility

- Keys generated before this version that contain `#`, `?` or `%` are not accepted. Open the content
  in the editor and generate the link again.
