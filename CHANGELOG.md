# Changelog

All notable changes to this module are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the module follows
[semantic versioning](https://semver.org/).

## Unreleased

### Changed

- The README shows the module as it is today: the two link fields in Content Editor, the Shared
  links panel and the notice a reviewer sees. The screenshot it carried was of the 1.x field,
  with a URL format the module no longer accepts. It also no longer lists the old Material UI
  libraries as a limitation: the module stopped depending on them.

## 2.3.2 - 2026-11-04

### Fixed

- The Shared links panel showed two sets of pagination controls. The table paginates on its own,
  which the panel now turns off: it keeps its own, because the table's returns to the first page
  every time a link is revoked.
- A long content path was cut off in the table rather than wrapping onto a second line.
- The report sat straight on the page's grey background; it is on a white sheet with a margin
  around it, like every other screen of its kind.

## 2.3.1 - 2026-11-04

### Fixed

- **The Shared links panel listed nothing.** It read each link's key from the node's
  `jnt:translation` children, which is how an internationalized value can be read in every language
  in one request. On Jahia 8.2.3.2 with jContent 3.8.1 that child list comes back empty through
  GraphQL, with no error, so every link was found and then dropped. Each key is now read with an
  explicit language, one aliased field per language of the site, which depends on no session state.

- The panel no longer reads through the shared Apollo cache. The same content comes back under both
  workspaces with one identifier, so a cache keyed on it let the live answer overwrite the
  authoring one. A report also has no business showing a value the server did not just send.

## 2.3.0 - 2026-11-04

### Added

- **A Shared links panel in Site Settings.** It lists every link that lets someone without an
  account reach content of this site: both kinds, every language, with the content each one points
  at, its expiry date and where it is served from. Until now a link could only be found by opening
  the content it was created on, so a site had no way to answer "what is shared right now?".

  Each row carries the action it needs. Revoking clears that one key, in that one language, and
  leaves the rest alone. The panel runs every read and every change as the person using it, so the
  repository decides who may revoke what: someone who cannot edit the content cannot revoke its
  link.

  A link to published content is served from the live workspace, so clearing its key only takes
  effect once that change is published. The panel reads both workspaces and keeps such a link
  listed as "Revoked, still live" with the action that publishes the revocation -- reading the
  authoring workspace alone would have hidden the link at the one moment it is both unwanted and
  working.

  The panel also flags a review link with no expiry date, which the endpoint refuses, and a link
  that is set but not published yet, which does not work either. Both states were previously
  indistinguishable from a working link.

- Export CSV and Export JSON of the list, built in the browser from what is on screen. A cell that
  would start as a spreadsheet formula is written as text.

### Changed

- The front-end carries unit tests, which run in the pull-request workflow alongside the linter.
  They check the panel's reporting, the exports and that the four shipped languages stay in step
  with each other.

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
