# content-sharing

Lets a contributor hand out a piece of otherwise non-public content to people who have no account.

The contributor generates a secret key on the content; the module turns it into a URL, and anyone
holding that URL reads the content as an anonymous visitor. A `jnt:file` is served as a download,
anything else is rendered as a page.

> **Before you change `ContentSharingServlet`.** The endpoint reads under a **system session**, so
> JCR permissions do not narrow what it can reach: the servlet decides on its own what may be
> served. Keep the parameter validation described below intact, and treat any change to it as a
> change to who can read the content.

## How a contributor uses it

Add the **Share protected content** (`cshmix:sharedUrl`) mixin to a content node or a file, click
**Create new URL**, and copy the URL. Set an optional **expiry date** to have the link stop working
on its own; leave it empty for a link that never expires. The field never makes a key by itself: a
link exists only once someone has asked for it.

To show a draft to someone before it is published, add **Share for review before publication**
(`cshmix:reviewUrl`) instead, or as well: see [Two kinds of link](#two-kinds-of-link).

![Content Editor on a page with both link fields switched on: the review link with its required
expiry date, then the link to the published content with its optional one](doc/images/content-editor-fields.png)

## How it works

| Piece | Role |
|---|---|
| `cshmix:sharedUrl` mixin | Carries `cshare:sharedUrl` (the secret) and `cshare:sharedUrlExpiry` (optional). Extends `jnt:content` and `jnt:file`. |
| `SharedURLGenerator.jsx` | Content Editor selector: generates the key with the browser CSPRNG and builds the URL. |
| `ContentSharingServlet` | The `/share` alias. Validates the request, resolves the node, then renders or streams it. |

The URL is `GET /modules/share?c=<key>&t=<node type>&lang=<language>`.

> The language parameter is `lang`, not `l`. Jahia's URL resolution reads `l` as a version label
> and `v` as a version date, so a share URL carrying `l=` makes the render chain fail with
> `Cannot use label <x> in workspace live`. It reads them only for a logged-in user, so such a URL
> works for the guests it was made for and breaks for the contributor testing it.
>
> A URL still using `l=` is answered with a 302 to the `lang=` form, so old links keep working
> without the reserved name ever reaching the render chain. Nothing inside the module can strip it
> in place: the outbound URL rewriting reads `l` off the original request.

Each parameter is validated for the query slot it occupies, and an unknown key, an unknown type, an
expired link and a real miss all answer the same `404`:

- `t` is resolved through `NodeTypeRegistry` and only the registry's own spelling reaches the query,
  because the `FROM [ … ]` slot has no string escape. The type must also be one the
  `cshmix:sharedUrl` mixin applies to.
- `c` must match `[A-Za-z0-9._~-]{8,128}` and is escaped with `JCRContentUtils.sqlEncode`.
- The resolved node must carry the mixin, its stored key is compared in constant time, and its
  expiry date must not have passed.

Responses are `no-store`, `no-referrer` and `noindex`, because the key travels in the URL.

## Configuring the selector

The [selector] reads three options: the key length (`length`, default **24**), the alphabet
(`format`, default **aA#**) and the base address (`origin`, default: this Jahia, under its context
path). A path in `origin` is kept, so a front end that serves Jahia under a prefix can name it. The
Shared links panel reads no form, so it always uses the default: a site that sets its own `origin`
sees that address in Content Editor and this Jahia's own in the panel.

```json
{
  "name": "cshmix:sharedUrl",
  "fields": [
    {
      "name": "cshare:sharedUrl",
      "selectorType": "SharedURLGenerator",
      "selectorOptionsMap": {
        "length": 24,
        "format": "aA#",
        "origin": "https://www.jahia.com"
      }
    },
    {
      "name": "cshare:sharedUrlExpiry"
    }
  ]
}
```

`format` accepts `a` (lowercase), `A` (uppercase), `#` (digits) and `!`, which now adds only the
URL-safe punctuation `-._~`. The previous `!` set emitted `#`, `?` and `%`; the servlet rejects
those, so existing keys containing them must be regenerated.

## Upgrading from 1.x

2.0.0 renames the CND namespace, because the old two-letter `se` prefix collides with other
modules in the `org.jahia.se.modules` family and Jackrabbit will not rebind a prefix. Where that
collision happens the module installs but is inert, and it blocks node-type registration for
whatever is deployed after it. See [`UPGRADE.md`](UPGRADE.md) — including how to tell whether you
have content to migrate.

## Building

Requires JDK 17 and Node 22, both pinned in the build.

```bash
mvn clean install
```

The front-end is built by `frontend-maven-plugin` during `generate-resources`. `yarn.lock` is
committed, so a build resolves the same tree every time, and the generated front-end under
`src/main/resources/javascript/apps/` is committed too, so a package always carries the editor
field even when a build skips the yarn step. The editor field uses Moonstone and the React runtime
jContent provides; the module declares no Material UI dependency.

`yarn test` runs the front-end unit tests (the panel's reporting, the exports, and that the
four shipped languages stay in step with each other). The pull-request workflow runs them
alongside the linter.

A package for a release is built by the workflow, never locally: `jahia-maven-plugin` writes the
build machine's own path into the manifest of a local build, and the workflow both sets
`JAHIA_DISABLE_SOURCE_FOLDERS` and refuses a package that carries one or that has no editor field.

## Two kinds of link

| | **Share protected content** | **Share for review before publication** |
|---|---|---|
| mixin | `cshmix:sharedUrl` | `cshmix:reviewUrl` |
| serves | the **published** content, as a visitor sees it | the content **as it stands in the authoring workspace**, published or not |
| expiry | optional | **required**; a link without one does not work |
| audience | anyone you hand the link to | people reviewing a draft |

They are separate on purpose. A node can carry both at once, with different keys and different
expiry dates, so handing a draft to three reviewers for a fortnight does not also hand out a
permanent link to the published page.

Which one a request is depends on the key alone: the two keys live in different properties, so a
link is only ever one kind and nothing in the URL lets a caller ask for the other. In particular,
holding a link to published content does not let anyone see the unpublished version of it.

### What a review link exposes

A review link renders the page from the authoring workspace, so it shows **everything on that page
that has not been published yet**, including work by other people in areas of the page you did not
think about. That is what makes it useful for review, and it is why the expiry is required and why
the capability is its own mixin rather than a second field on the first one: a site can decide
separately where review sharing is allowed at all.

Reviewers see a notice saying the content is a draft, may still change, and that its links may not
open for them.

![A page opened through a review link, with the draft notice above the site's own
header](doc/images/review-notice.png)

**Files in a review rendering come back through this endpoint.** A draft renders out of the
authoring workspace, so every image, stylesheet and script in it is addressed under
`/files/default/...`, which a reviewer may not read: without this the page would arrive as text
with nothing else loading. Those addresses are rewritten to

```
/modules/share?c=<key>&t=<type>&asset=<repository path>&sig=<signature>
```

and the endpoint streams the file under the same conditions as the page: the same key, the same
expiry date, checked again on every file.

The signature is what keeps this from becoming a reader for the whole authoring workspace. It is
computed with the sharing key as the secret, so only a caller holding that key can produce one, and
such a caller can already read the page that names those paths. The endpoint also refuses a path
that is not a file, or that belongs to another site.

Jahia's sizing query is dropped, so a reviewer gets the file as stored rather than a resized
variant. Navigation links are **not** rewritten: they lead to the authoring workspace and will not
open for a reviewer, which is what the notice says. Rewriting them would be sharing the site, not
the page.

## What can be shared

Both mixins apply to **content items** (`jnt:content`), **files** (`jnt:file`) and **pages**
(`jnt:page`).

A shared **file** is served as a download and needs nothing from the site. A shared **page**
renders through its own template. A shared **content item** is rendered in a page context, so the
site's template set has to offer a template that applies to it, as it does for any content item
reachable by its own URL (`jmix:mainResource`). A site whose template set offers none renders
nothing for such a link, and the endpoint reports the failure. This module ships no template of its
own: it does not know what a shared item should look like on your site, and a template that applied
to everything would take over ordinary rendering too.

## Navigation in a shared page

A shared page renders with the site's chrome, and a visitor holding one link can open nothing the
navigation points at. The module cannot leave that chrome out on its own, for the reason above, so
by default it puts a short notice at the top of the rendering:

> You are viewing shared content. Links on this page lead to pages you may not be able to open.

The text comes from the module's resource bundle (`sharedLink.notice`), in the visitor's language,
and is escaped before it is inserted. If the markup has no `body` element the page is served
untouched.

**To render a shared page differently**, branch on the request attribute the servlet sets before
rendering:

```jsp
<c:if test="${not empty requestScope['contentSharing.sharedRendering']}">
  ...render without the header and footer, or with your own notice...
  <c:set var="x" value="${requestScope['contentSharing.noticeRendered'] = true}"/>
</c:if>
```

| attribute | meaning |
|---|---|
| `contentSharing.sharedRendering` | set by this module before it renders a shared node, of either kind |
| `contentSharing.noticeRendered` | set it to `true` and the default notice is left out |

Leaving the chrome out gives a cleaner read; keeping it keeps the site's branding on a page a
stranger is looking at. That is a decision for the site, which is why the module makes it possible
rather than making it for you.

## Seeing and revoking what is shared

**Site Settings > Shared links** lists every link that lets someone without an account reach content
of this site: both kinds, every language, with the content each one points at, its expiry date and
the workspace it is served from. Without it a link can only be found by opening the content it was
created on.

![Site Settings, Shared links: eight links of both kinds in English and French, one in each
state the panel reports, with their kind, language, expiry, state and action in columns; one row
is expanded to its address and a Copy link button](doc/images/shared-links-panel.png)

Each row carries the action it needs, and the panel runs every read and every change as the person
using it: someone who cannot edit the content cannot revoke its link. **Revoke** removes that one
link, in that one language: its key and its expiry date. When the node has no other link of the
same kind left in any language, it removes the mixin too, so Content Editor shows sharing as off.
Every other link is left alone.

Each row expands to the address the link opens, with **Copy link** next to it: click the row, or
focus it and press Enter or Space. The address is built the way the Content Editor field builds it,
from the key the serving workspace holds: for a link to published content that has a live side,
the live key, so a key regenerated in authoring and not yet published shows the address visitors
still hold.

A link to published content is served from the live workspace, so clearing its key only takes effect
once that change is published. Such a link stays listed as **Revoked, still live**, with the action
that publishes the revocation. Two other states are worth knowing, because a visitor cannot tell
them from a working link either way:

| State | What it means |
| --- | --- |
| Live | Served from the live workspace. The link works. |
| Revoked, still live | The key is gone from authoring, live still serves it. Publish the revocation. |
| Not published yet | The key is set in authoring but has never been published. The link does not work yet. |
| Authoring | A review link, which is always served from the authoring workspace. |

A review link with no expiry date is flagged as well: the endpoint refuses it, so it never worked.

**Export CSV** and **Export JSON** hand the whole list to the browser; nothing leaves the page.
They leave the addresses out on purpose: an export is a file that gets passed around, and every
address in it would be a working link.

## Known limitations

- A key is stored as an ordinary indexed JCR property, so it is readable wherever the node's
  properties are.
- A review link's key is published with its node. The endpoint only accepts review keys from the
  authoring workspace, so the copy in live opens nothing by itself, but while the link is active it
  is the same key, readable by whoever can read that node's properties in live.
- **Publish** on a *Revoked, still live* row publishes the node in that language, so any other
  unpublished change on that node, and on its sub-nodes, is published with the revocation.
- Opening `/share` is not throttled and leaves no record of who opened a link.

[selector]: src/javascript/SharedURLGenerator/SharedURLGenerator.jsx
