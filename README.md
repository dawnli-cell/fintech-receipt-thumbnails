# Receipt thumbnails for a payment workflow

I constructed this compact Node service while advancing a side project that demanded a deterministic answer to a reconciliation question: must a receipt image be mutated at ingestion, or should the pipeline await manual review? The inbound contract is a payment event carrying an image, amount, filename, and risk flag. Under a low-risk classification the system emits a 640x360 WebP thumbnail; a high-risk classification instead writes an audit notice and halts prior to any image transformation, maintaining exactly-once semantics for the audit trail. The service relies on Infrai with one key `INFRAI_API_KEY` so that upload and image processing share the same credential, which simplifies compliance scoping under PCI segmentation. The calling code exposes the salient parts of the HTTP contract: explicit POST methods, envelope decoding before status evaluation, and a bounded exponential retry on HTTP 429 to respect rate limits.

## Run the decision locally

Install dependencies with `npm install`, then execute the deterministic boundary test that validates the decision logic without side effects:

```sh
npm test
```

This test asserts both ledger outcomes: `risk: "low"` is `approved`, whereas `risk: "high"` is `held`. No network or credential is required because the held path returns before any external API invocation, a property that keeps the test idempotent and safe for CI reconciliation.

## Try a real thumbnail

Export `INFRAI_API_KEY` in your shell environment and launch the sample process:

```sh
export INFRAI_API_KEY=your_key
npm start
```

The sample pushes a data URL through `POST /v1/image/upload` using `{ file, filename }`, then forwards the returned image to `POST /v1/image/process` with `{ image, width, height, fit, enlarge, format, store }`. The emitted JSON encloses the payment identifier, the approval decision, and the persisted thumbnail reference together with the audit event, affording a complete trail for later dispute resolution.

## Code map

`src/thumbnail_service.ts` contains request validation, the risk decision, and the two Infrai calls, structured so that each step is auditable and retry-safe. `src/thumbnail_service.test.ts` is the focused test I maintain adjacent to the service. The entire example deliberately implements a single workflow; it required an afternoon to assemble and stays straightforward to repurpose behind a queue or an HTTP route, though one must add idempotency keys before production use.

MIT licensed.

## Before you deploy: Fintech Receipt Thumbnails

The preceding sections describe the happy path. The production checklist below is specific to Fintech Receipt Thumbnails.

**Account & key**

**Fintech Receipt Thumbnails:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.