# Upgrading content-sharing

## 2.5.0: review links

Review links move off the node they open. Until 2.4.x a review link was the `cshmix:reviewUrl`
mixin's key and expiry date on the node: saving it marked the node as modified, and publishing it
copied the key to live. From 2.5.0 it is a `cshnt:reviewLink` node in a `cshareReviewLinks`
container under the content, never published, made with **Share for external review**.

Nothing has to be migrated. Links made the old way:

- keep working until they expire, and are listed in **Site Settings > Shared links**, where
  **Revoke** removes them as before;
- are no longer shown in Content Editor, where the review field is hidden; the mixin itself stays
  on the nodes that carry it until they are revoked.

To move one to the new storage, revoke it in the panel and create it again from the Preview menu.
A copy of the old key may remain in live from an earlier publication: it opens nothing, and goes
away the next time the node is published.

## 2.0.0: from 1.x

2.0.0 changes the module's CND namespace. This is a **breaking change**: it renames the mixin and
both properties.

| | 1.x | 2.x |
|---|---|---|
| namespace | `se` -> `http://modules.se.jahia.org/se/1.0` | `cshare` -> `http://modules.jahia.org/content-sharing/1.0` |
| | `semix` -> `http://modules.se.jahia.org/se/mix/1.0` | `cshmix` -> `http://modules.jahia.org/content-sharing/mix/1.0` |
| mixin | `semix:sharedUrl` | `cshmix:sharedUrl` |
| key property | `se:sharedUrl` | `cshare:sharedUrl` |
| expiry property | `se:sharedUrlExpiry` | `cshare:sharedUrlExpiry` |

### Why

`se` is two characters long and generic, and other modules in the `org.jahia.se.modules` family
claim it for a different URI. Jackrabbit will not rebind a prefix:

```
javax.jcr.NamespaceException: failed to register namespace
  se -> http://modules.se.jahia.org/se/1.0: remapping existing prefixes is not supported.
```

Where that happens the whole CND is rejected, and the consequences are quiet:

- `semix:sharedUrl` never reaches the JCR registry, so **a contributor cannot apply the mixin at
  all** — the module is installed and inert.
- The bundle still reports `ACTIVE` and the provisioning API still reports success. The
  definitions *browser* still lists the type, because Jahia's own registry parsed the CND and only
  Jackrabbit refused it.
- The module's static resources are never published, because the failure aborts the extender's
  resolve step before that happens. In jContent this shows up as
  `GET /modules/content-sharing/javascript/apps/remoteEntry.v0.js 404` followed by
  `Refused to execute script ... MIME type ('text/html') is not executable`. A healthy module
  requests `remoteEntry.v<32 hex>.js`, where the token is the file's MD5 — `v0` is what you get
  when there is no registered file to hash.
- **Every module deployed after it fails to register its own node types too**, until this one is
  removed.

### Which path applies to you

**A. The module never worked here** — you have the namespace error in `jahia.log`, or the
`remoteEntry.v0.js` 404 in jContent. Then no content carries the mixin, because it was never
possible to apply it. **Upgrade directly; there is nothing to migrate.**

Confirm with:

```bash
grep -E "content-sharing" jahia.log | grep -E "Error parsing definitions|remapping existing prefixes"
```

**B. The module worked here** and contributors have generated sharing URLs. Then you have content
under the old names and must migrate it. Read the rest of this page.

### Migrating existing keys (path B only)

Two phases, because the old names have to be read while the old types are still registered and the
new names written once the new ones are.

```
1. Run migration/1-export-keys.groovy       (BEFORE deploying 2.x) -> save the JSON it prints
2. Deploy content-sharing 2.x
3. Paste the JSON into migration/2-import-keys.groovy and run it
4. Review in jContent, then publish -- a key only takes effect in the live workspace
5. Re-issue the URLs: the `t` parameter now carries the new type name
```

Both scripts run from *Administration > Server > Tools > Groovy console*, or through the
provisioning API. Phase 1 is read-only. Phase 2 is idempotent, so it is safe to re-run after
fixing a failure.

#### Two things to check on a restored copy first

Do not run path B against production without rehearsing it on a restore.

- **Dropping a node type that instances still use is not a routine operation in Jahia.** 2.x no
  longer declares `semix:sharedUrl`, so any node still carrying that mixin when you deploy is in
  exactly that situation. Phase 1 before the upgrade, and removing the old mixin afterwards, is
  what keeps you out of it — verify the sequence on a copy.
- **Expect to restart Jahia after the upgrade.** Once a CND has been rejected, Jahia does not
  retry it: a later deploy logs `Found definitions file` and the definitions check but never
  `Registering ... into JCR providers`, so it reports no error and still registers nothing. A
  restart is the reliable way to get the new definitions read.

### After upgrading

Sharing URLs keep the same shape, but `t` is the node type of the shared content and any
`semix:`-derived value in a stored or bookmarked URL is stale. Keys themselves are unchanged, so
re-copying the URL from the editor is enough.
