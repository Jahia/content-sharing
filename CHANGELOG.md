# Changelog

All notable changes to this module are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the module follows
[semantic versioning](https://semver.org/).

## Unreleased

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
