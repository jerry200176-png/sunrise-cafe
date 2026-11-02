# Staff order reads: limit HTTP cache reuse

## Problem and scope

The two staff order views use a GET after a confirmed add. They validate the response's shape before clearing a committed-but-not-refreshed reminder, but a well-formed response alone does not prove it contains that specific add. Reusing an old HTTP response can leave staff looking at an older order and prompt an accidental repeat. The same response contains reservation/order information that should not be retained by a compliant HTTP cache.

At baseline `14aa253bd724cb4b03124198dc83dd834234eea0`, neither order GET caller passed `cache: "no-store"`; the route's success and handler errors did not explicitly set a cache policy. `next.config.ts` and `vercel.json` did not configure one for this path; the middleware only set the rate-limit header and could return 401/429 before the route ran. This is a source-level observation; actual browser, CDN and platform behavior was not measured.

This candidate sets `cache: "no-store"` for initial and post-add reads in both views, and sets `Cache-Control: private, no-store` for the exact admin reservation-order GET in its route and middleware (including the handler's 401/403/404/500 and middleware 401/429). It does not change branch authorization, reservation data, POST, checkout, booking or payment semantics. Other middleware paths and POSTs do not receive this new targeted header. The route handles a rejected params promise within its existing 500 path.

## Limits

`no-store` directs compliant HTTP caches not to retain the response and requests bypass of the browser HTTP cache. It **does not** establish database freshness, read-your-writes across all services, response provenance, or that a particular add appears in the returned order. A service worker, intermediary, concurrent deletion, stale backend, broken or malicious cache, application bug or infrastructure-generated error outside these handlers may behave differently. There is no receipt/row identity in this change. Current UI may still clear a committed-stale warning after any structurally valid GET; this change does not prove visibility of the add, deduplicate any request, prevent late requests from old deployments, or solve #441/#502. Cross-tab/device, unknown results and explicit staff reconciliation remain unchanged. RFC 9111 also states no-store alone is insufficient as a privacy guarantee.

## Validation and rollback

Mocked regression tests cover successful route output, missing session, branch denial, missing reservation, thrown loader and rejected params; they assert no order query on authorization denials. Middleware tests cover the allowed GET, 401, 429, trailing slash and unrelated path/method behavior. Both actual views are tested with synthetic responses to check `cache: "no-store"` on initial and post-add reads. These tests do not contact production, prove cache behavior of actual intermediaries or test staff accounts. This candidate is local only; no migration or secret is needed. A code revert restores the prior response/request cache policy; this does not resolve any pending add.

## 參考做法

- [RFC 9111 §5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store-2): `no-store` directs compliant private and shared caches not to store or reuse a response, but is not by itself a complete privacy guarantee.
- [MDN Request.cache](https://developer.mozilla.org/en-US/docs/Web/API/Request/cache): Fetch's `no-store` mode bypasses and does not update the browser HTTP cache. This is a client request directive, not a database consistency protocol.
- Existing application patterns `src/app/admin/line-accounts/page.tsx` and `src/app/api/admin/line-accounts/route.ts` already use no-store for another private administrative read; this change reuses the standard web API rather than adding a library or cache layer.
- 根因 vs 症狀：a structurally valid GET is not proof that an add is visible. Explicit cache controls remove one potential source of stale HTTP reuse; durable server request identity and a verified writer fence remain separate unresolved work.
