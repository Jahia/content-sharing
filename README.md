# content-sharing

Lets a contributor hand out a piece of otherwise non-public content to people who have no account.

The contributor generates a secret key on the content; the module turns it into a URL, and anyone
holding that URL reads the content as an anonymous visitor. A `jnt:file` is served as a download,
anything else is rendered as a page.

![100]

> **Before you change `ContentSharingServlet`.** The endpoint reads under a **system session**, so
> JCR permissions do not narrow what it can reach: the servlet decides on its own what may be
> served. Keep the parameter validation described below intact, and treat any change to it as a
> change to who can read the content.

## How a contributor uses it

Add the **Share protected content** (`cshmix:sharedUrl`) mixin to a content node or a file, generate
a key, and copy the URL. Set an optional **expiry date** to have the link stop working on its own;
leave it empty for a link that never expires.

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
(`format`, default **aA#**) and the URL origin (`origin`, default `window.location.origin`).

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

A package for a release is built by the workflow, never locally: `jahia-maven-plugin` writes the
build machine's own path into the manifest of a local build, and the workflow both sets
`JAHIA_DISABLE_SOURCE_FOLDERS` and refuses a package that carries one or that has no editor field.

## Rendering a shared content item

A shared **file** is served as a download and needs nothing from the site. A shared **page** is
rendered by its own template.

A shared **content item** is rendered in a page context, so the site's template set has to offer a
template that applies to it, as it does for any content item reachable by its own URL
(`jmix:mainResource`). A site whose template set offers none renders nothing for such a link, and
the endpoint reports the failure. This module ships no template of its own: it does not know what a
shared item should look like on your site, and a template that applies to everything would override
the site's own.

## Known limitations

- A key is stored as an ordinary indexed JCR property, so it is readable wherever the node's
  properties are.
- Nothing throttles `/share`, and there is no record of who opened a link.
- The repository has no automated tests yet.
- `@material-ui/core@3` and `@jahia/react-material` are deprecated; the selector only needs
  Moonstone.

[100]: doc/images/000_shared_URL_UI.png
[selector]: src/javascript/SharedURLGenerator/SharedURLGenerator.jsx
