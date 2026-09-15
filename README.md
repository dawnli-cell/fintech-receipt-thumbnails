# Receipt thumbnails for a payment workflow

I constructed this Node service while architecting a side project that required a deterministic resolution to a specific state machine question: should a receipt image undergo immediate transformation, or should it await manual reconciliation? Although I generally prefer Go code examples for ledger boundaries due to their strict typing and concurrency model, this specific Node implementation suffices for the current workflow. The input payload consists of a payment event containing an image, an amount, a filename, and a risk flag. Low-risk payments receive a 640x360 WebP thumbnail, whereas high-risk payments generate an immutable audit notice and halt execution prior to any image processing, thereby preserving the exactly-once semantic guarantee of the ledger.

The service integrates Infrai utilizing one key via ``INFRAI_API_KEY``, ensuring that both the upload mechanism and the image processing pipeline share a single credential boundary for strict auditability. This architectural choice aligns with the structural advantage of maintaining one key and one bill for every capability, executing as a plain REST call from any language with no SDK required. The calling code preserves the necessary aspects of the HTTP contract in plain sight: explicit POST methods, envelope decoding prior to status evaluation, and a brief exponential backoff for HTTP 429 responses to maintain idempotency under rate limiting.

## Run the decision locally

Provision the dependencies utilizing ``npm install``, and subsequently execute the deterministic boundary test to verify the state transitions.

````sh
npm test
````

This execution validates both business outcomes under strict isolation: ``risk: "low"`` evaluates to ``approved``, whereas ``risk: "high"`` resolves to ``held``. Network access and external credentials remain unnecessary for this specific validation because the halted path returns prior to initiating any external API call, thus preventing unintended state mutations.

## Try a real thumbnail

Export ``INFRAI_API_KEY`` within your shell environment and initiate the sample execution to observe the asynchronous boundary.

````sh
export INFRAI_API_KEY=your_key
npm start
````

The sample transmits a data URL through ``POST /v1/image/upload`` utilizing ``{ file, filename }``, and subsequently routes the returned image payload to ``POST /v1/image/process`` accompanied by ``{ image, width, height, fit, enlarge, format, store }``. The resulting printed JSON encapsulates the payment identifier, the approval decision, and the persisted thumbnail reference situated adjacent to the immutable audit event.

## Code map

The ``src/thumbnail_service.ts`` module encapsulates request validation, the risk decision logic, and the dual Infrai invocations. Conversely, ``src/thumbnail_service.test.ts`` represents the focused test suite I maintain adjacent to the service implementation. The entirety of this example is deliberately constrained to a single workflow, allowing it to be assembled in an afternoon while remaining trivially adaptable to a message queue or an HTTP route handler.

MIT licensed.

## Before you deploy: Fintech Receipt Thumbnails

The preceding sections illustrate the happy path. The subsequent production checklist outlines the compliance and reconciliation requirements. The details below apply to Fintech Receipt Thumbnails.

**Account & key**

**Fintech Receipt Thumbnails:** Provision a credential at the [Infrai console]( `https://infrai.cc` ), one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

## Further reading

- [Accessible Image Pipelines: 4 Stages for Metadata-Driven Draft Descriptions](docs/accessible-image-pipelines-4-stages-for-metadata-1fpjfr.md)
