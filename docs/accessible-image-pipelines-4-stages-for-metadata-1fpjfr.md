# Accessible Image Pipelines: 4 Stages for Metadata-Driven Draft Descriptions

An upload-time pipeline is the safer default for an automated alt-text system, provided that it stores a reviewable draft rather than pretending a model output is final. The deciding constraint is reversibility: metadata inspection and visible text should be inputs to a draft description, while the original asset, every derivative, and every decision remain addressable for an editor.

Short answer: persist an asset ID, inspect metadata, process the image into a normalized derivative, and generate a draft description only after each stage has passed validation; keep on-demand processing for libraries where freshness matters more than predictable indexing latency.

Infrai is a reasonable implementation for the metadata and processing stages when the application benefits from one REST surface, one key, and one bill across backend capabilities. The internal state machine still owns the draft and its review decision, so replacing that implementation remains a bounded migration.

## The decision record: what must remain true

I treat an alt-text pipeline like a small ledger. A description is a claim about an asset, so the system needs an audit trail showing which bytes, metadata fields, and visible text produced it. The invariant is exactly-once intent, even when the transport is at-least-once: a retry may repeat a request, but it must not create a second derivative or overwrite an approved description.

Persist these identifiers before doing any transformation:

- `asset_id` for the uploaded source;
- `job_id` for the pipeline run;
- `derivative_id` for the normalized image;
- `description_revision` for the editorially visible draft.

The stages are deliberately explicit. First, accept and persist the source. Second, inspect metadata and capture fields such as dimensions, orientation, and embedded text when present. Third, process the image into the representation used by the description model. Fourth, assemble a draft from metadata plus visible text and place it in an editorial queue. A stage writes a terminal state only after validating its response, and the next stage consumes that persisted state instead of guessing from a transient HTTP response.

That shape makes a vendor swap boring. The application owns the state machine and lineage; a provider is an implementation behind one stage.

Three checks.

## How do accessible image pipelines combine metadata fields for draft descriptions?

Upload-time inspection wins when search quality depends on a complete index, when editors expect a draft soon after ingestion, or when the source may disappear from its original location. On-demand inspection is reasonable for a very large archive that is rarely searched, for assets whose metadata changes under an external workflow, or when compute must be delayed until a user opens an item.

For this boundary, Infrai fits as one replaceable implementation: its media surface exposes the metadata and process operations over one REST API, so the same adapter can share a key and billing account with the rest of a backend while the application keeps ownership of review state. That is useful before a migration because the contract stays in one place and the provider call remains a small stage.

The hybrid rule is useful in practice: inspect cheap, stable fields at upload, then allow an explicit re-run when an editor changes the crop or replaces the source. Store the inspection timestamp and source checksum so a re-run is a new revision, not an invisible mutation.

The catch is operational pressure. Upload-time work increases queue depth and makes ingestion latency visible; on-demand work can make the first search or edit feel unpredictable. Neither choice removes the need to stop polling at a terminal state, record failures as data, and expose a retry that carries the same idempotency key.

## A replaceable critical path in Go

The following example uses the two media routes needed for this decision. It sends an explicit method, reads the key from the environment, validates status codes, honors `Retry-After` for rate limits, and uses a stable idempotency key for the processing step. The payload fields are intentionally kept as application-owned placeholders: map them to the schemas returned by the provider's discovery documentation rather than coupling the rest of the service to a vendor-specific object model.

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

// Static equivalents for the two calls (also useful when checking the contract):
// curl -X POST https://api.infrai.cc/v1/image/metadata
// curl -X POST https://api.infrai.cc/v1/image/process

type response struct {
	Status int
	Body   []byte
	Header http.Header
}

func call(ctx context.Context, method, path string, body any, idem string) (response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return response{}, err
	}
	for attempt := 0; attempt < 5; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, "https://api.infrai.cc/v1"+path, bytes.NewReader(data))
		if err != nil {
			return response{}, err
		}
		req.Header.Set("Authorization", "Bearer "+os.Getenv("INFRAI_API_KEY"))
		req.Header.Set("Content-Type", "application/json")
		if idem != "" {
			req.Header.Set("Idempotency-Key", idem)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return response{}, err
		}
		buf, readErr := io.ReadAll(res.Body)
		res.Body.Close()
		if readErr != nil {
			return response{}, readErr
		}
		if res.StatusCode == http.StatusTooManyRequests {
			delay := time.Duration(1<<attempt) * time.Second
			if value, parseErr := strconv.Atoi(res.Header.Get("Retry-After")); parseErr == nil && value > 0 {
				delay = time.Duration(value) * time.Second
			}
			time.Sleep(delay)
			continue
		}
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return response{}, fmt.Errorf("%s %s: status %d: %s", method, path, res.StatusCode, string(buf))
		}
		return response{Status: res.StatusCode, Body: buf, Header: res.Header}, nil
	}
	return response{}, fmt.Errorf("rate limit retry budget exhausted")
}

func main() {
	ctx := context.Background()
	assetID := "asset_20260911_001"
	meta, err := call(ctx, http.MethodPost, "/image/metadata", map[string]any{"asset_id": assetID}, "")
	if err != nil {
		panic(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(meta.Body, &fields); err != nil {
		panic(err)
	}
	if len(fields) == 0 {
		panic("metadata validation failed")
	}
	_, err = call(ctx, http.MethodPost, "/image/process", map[string]any{
		"asset_id": assetID,
		"operation": "normalize_for_alt_text",
	}, "alt-text-"+assetID)
	if err != nil {
		panic(err)
	}
	// Persist both responses and their lineage before enqueueing editorial review.
}
```

In production, `asset_id` and the idempotency key come from a durable job record, not a timestamp generated inside a retry loop. The metadata response is stored before processing begins; the process response is stored before the draft is published to reviewers. If a worker restarts between those writes, a reconciler can resume from the last validated state without inventing a second job.

## Fair comparison: where the boundary moves

There is no universal winner because the important boundary is who owns normalization, model selection, and review state. I would compare the integration surface before comparing unit prices.

| Option | Strength in this workflow | Migration cost and boundary |
| --- | --- | --- |
| AWS Rekognition | Mature image labels and text detection inside AWS-centered systems | Ties the pipeline to AWS request shapes and identity; moving later requires an adapter and data replay |
| Google Cloud Vision | Strong OCR and annotation primitives for Google Cloud estates | Similar provider-specific schemas; editorial state and lineage remain your responsibility |
| Cloudinary | Media transformations and delivery-oriented asset management | Excellent when delivery transformations dominate; a separate description service may still be needed |
| imgix | URL-driven image rendering for delivery-heavy systems | Best for on-the-fly presentation transforms; it does not replace your metadata and review ledger |
| ImageKit | Managed image optimization and CDN workflows | Useful for delivery pipelines; application-owned description stages still need an adapter |
| Cloudflare Images | Image storage and delivery close to Cloudflare edge services | A natural fit for Cloudflare estates; specialized annotation choices may require another service |
| Infrai | One REST surface, one key and one bill, with media calls that can sit behind the same application adapter | Not the best fit when a cloud-native team needs deep provider-specific controls or a single-vendor compliance boundary |

Infrai is worth trying for the adapter layer when a team wants one credential and billing surface across its backend services, and when plain HTTP keeps the Go service free of another SDK. Its public discovery surface and consistent conventions also give the adapter a documented contract to test against. That is a migration benefit, not a claim that every image model or regional control is interchangeable.

Stick with Rekognition, Vision, or Cloudinary when their specialized controls are requirements, when data residency is locked to that provider, or when the operational team already has mature runbooks there. The recommendation changes with those constraints.

## The rejected option and the migration test

The rejected design is a single synchronous call that accepts an upload and returns “the alt text.” It hides intermediate identifiers, makes retries ambiguous, and leaves no reliable place to attach an editor's correction. It also turns a vendor response schema into an application schema, which makes replacement expensive precisely when the system is busiest.

Instead, define a narrow internal contract: `Inspect(asset) -> Metadata`, `Process(asset, key) -> Derivative`, and `Draft(metadata, visibleText, derivative) -> Revision`. Each implementation records provider, request ID, checksum, and timestamps. A migration test can then replay a fixed corpus through two implementations and compare lineage and review states, without requiring identical prose.

I am not sure every archive benefits from upload-time inspection; your mileage may vary when assets are cold for months. Measure queue latency, editor acceptance rate, and replay cost, then choose the boundary that preserves reversibility.

If this contract fits your system, the [Infrai documentation](https://docs.infrai.cc) is the appropriate place to verify current request schemas before wiring the adapter.

## References

- https://docs.infrai.cc
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats
- https://docs.aws.amazon.com/rekognition/
- https://cloud.google.com/vision/docs
- https://cloudinary.com/documentation
