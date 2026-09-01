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

Add the **Share protected content** (`semix:sharedUrl`) mixin to a content node or a file, generate
a key, and copy the URL. Set an optional **expiry date** to have the link stop working on its own;
leave it empty for a link that never expires.

## How it works

| Piece | Role |
|---|---|
| `semix:sharedUrl` mixin | Carries `se:sharedUrl` (the secret) and `se:sharedUrlExpiry` (optional). Extends `jnt:content` and `jnt:file`. |
| `SharedURLGenerator.jsx` | Content Editor selector: generates the key with the browser CSPRNG and builds the URL. |
| `ContentSharingServlet` | The `/share` alias. Validates the request, resolves the node, then renders or streams it. |

The URL is `GET /modules/share?c=<key>&t=<node type>&l=<language>`.

Each parameter is validated for the query slot it occupies, and an unknown key, an unknown type, an
expired link and a real miss all answer the same `404`:

- `t` is resolved through `NodeTypeRegistry` and only the registry's own spelling reaches the query,
  because the `FROM [ … ]` slot has no string escape. The type must also be one the
  `semix:sharedUrl` mixin applies to.
- `c` must match `[A-Za-z0-9._~-]{8,128}` and is escaped with `JCRContentUtils.sqlEncode`.
- The resolved node must carry the mixin, its stored key is compared in constant time, and its
  expiry date must not have passed.

Responses are `no-store`, `no-referrer` and `noindex`, because the key travels in the URL.

## Configuring the selector

The [selector] reads three options: the key length (`length`, default **24**), the alphabet
(`format`, default **aA#**) and the URL origin (`origin`, default `window.location.origin`).

```json
{
  "name": "semix:sharedUrl",
  "fields": [
    {
      "name": "se:sharedUrl",
      "selectorType": "SharedURLGenerator",
      "selectorOptionsMap": {
        "length": 24,
        "format": "aA#",
        "origin": "https://www.jahia.com"
      }
    },
    {
      "name": "se:sharedUrlExpiry"
    }
  ]
}
```

`format` accepts `a` (lowercase), `A` (uppercase), `#` (digits) and `!`, which now adds only the
URL-safe punctuation `-._~`. The previous `!` set emitted `#`, `?` and `%`; the servlet rejects
those, so existing keys containing them must be regenerated.

## Building

Requires JDK 17 and Node 22 (both pinned in the build).

```bash
mvn clean install
```

The front-end is built by `frontend-maven-plugin` during `generate-resources`; `yarn.lock` is
committed, so a build resolves the same tree every time.

## Known limitations

- A key is stored as an ordinary indexed JCR property, so it is readable wherever the node's
  properties are.
- Nothing throttles `/share`, and there is no record of who opened a link.
- The repository has no automated tests yet.
- `@material-ui/core@3` and `@jahia/react-material` are deprecated; the selector only needs
  Moonstone.

[100]: doc/images/000_shared_URL_UI.png
[selector]: src/javascript/SharedURLGenerator/SharedURLGenerator.jsx
