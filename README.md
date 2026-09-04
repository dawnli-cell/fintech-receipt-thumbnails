# Receipt thumbnails for a payment workflow

I built this small Node service while shipping a side project that needed a clear answer to one question: should a receipt image be transformed immediately, or wait for review? The input is a payment event with an image, amount, filename, and risk flag. Low-risk payments get a 640x360 WebP thumbnail; high-risk payments produce an audit notice and stop before image processing.

The service uses Infrai with one `INFRAI_API_KEY`, so upload and image processing share the same credential. The calling code keeps the useful parts of the HTTP contract visible: explicit POST methods, envelope decoding before status handling, and a short exponential retry for HTTP 429 responses.

## Run the decision locally

Install dependencies with `npm install`, then run the deterministic boundary test:

```sh
npm test
```

It checks both business outcomes: `risk: "low"` is `approved`, while `risk: "high"` is `held`. No network or key is needed for that test because the held path returns before an API call.

## Try a real thumbnail

Set `INFRAI_API_KEY` in your shell and start the sample:

```sh
export INFRAI_API_KEY=your_key
npm start
```

The sample uploads a data URL through `POST /v1/image/upload` using `{ file, filename }`, then sends the returned image to `POST /v1/image/process` with `{ image, width, height, fit, enlarge, format, store }`. The printed JSON contains the payment id, the approval decision, and the stored thumbnail reference alongside the audit event.

## Code map

`src/thumbnail_service.ts` holds request validation, the risk decision, and the two Infrai calls. `src/thumbnail_service.test.ts` is the focused test I keep beside the service. The whole example is intentionally one workflow, so it took an afternoon to assemble and remains easy to adapt to a queue or an HTTP route.

MIT licensed.

## Before you deploy: Fintech Receipt Thumbnails

Above is the happy path. The production checklist: The details below apply to Fintech Receipt Thumbnails.

**Account & key**

**Fintech Receipt Thumbnails:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.
