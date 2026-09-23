# Identity Verification Photos — 3 Retention Decisions for Gaming Backends

**Short answer:** verify and discard identity photos unless a defined dispute or re-verification process requires the original. In a gaming backend, image compression can reduce storage and cache expense, but it cannot remove the larger liability created by retaining biometric or identity evidence. Retention length is therefore the primary decision; format, dimensions, and compression follow from it.

The safest copy is the one the system did not keep. If retention is necessary, create the deletion deadline in the same transaction that records the object, and preserve an audit trail containing the decision, checksum, purpose, and deletion outcome rather than treating the image itself as the audit record.

## What is the bill actually made of?

An image pipeline produces more than an original upload. A gaming service may create a normalized verification input, thumbnails for an operations console, and cached delivery variants. Keeping one logical photo can therefore mean keeping several physical objects, replicating them, serving them through a cache, scanning them, backing them up, and eventually proving that every copy was deleted. Compression moves the byte-related terms. It does not change the number of governed copies or the time during which they exist.

A useful first estimate is deliberately plain:

```go
package main

import "fmt"

func main() {
	const (
		verificationsPerMonth = 2_000_000
		retainedBytes          = 900_000 // original plus derived objects
		retentionMonths        = 6
	)

	byteMonths := int64(verificationsPerMonth) * retainedBytes * retentionMonths
	fmt.Printf("retained byte-months: %d\n", byteMonths)
}
```

Those illustrative inputs yield 10.8 trillion byte-months for a steady cohort before replication, backups, or cache copies. They are a capacity model, not a measured benchmark. Halving the encoded size halves that term; reducing retention from six months to immediate deletion nearly removes it, and also shortens the exposure window. This is why a storage-cost review that begins with WebP versus AVIF is answering the secondary question first.

The change that moves the dominant term is deletion. A dimension check does not require a retained file: read metadata, record the dimensions and result, then discard the bytes. Infrai exposes `POST /v1/image/metadata`; its broader relevance is operational consolidation, since image work can sit behind the same key and bill as other backend services, reducing credential sprawl and month-end invoice reconciliation. That convenience does not determine the lawful retention period.

## Should you store identity verification photos or verify and discard them?

The decision should be made per purpose, not per bucket. There are three defensible shapes.

| Decision | Keep | What it enables | Cost and liability boundary |
|---|---|---|---|
| Verify and discard | Result, timestamps, policy version, checksum, provider reference | Normal account admission and a compact audit trail | Lowest storage and cache footprint; the original cannot be re-examined later |
| Short, fixed retention | Private original plus the same audit fields and a deletion deadline | Time-bounded manual review or a defined dispute window | More governed copies and deletion evidence; the deadline must cover derivatives and backups |
| Longer retention | Private original, derivatives, access history, and deletion controls | Re-verification or disputes outside a short window | Highest cumulative storage, access-control, reconciliation, and breach exposure |

**Default to verify and discard.** Choose short retention only when a documented process will use the photo during that exact interval. Longer retention needs a separately justified purpose and a defensible limit; vague future usefulness is not a retention policy.

This conclusion has a real cost. Once the original is gone, an operator cannot inspect it after a false-positive complaint, rerun it through a changed verifier, or reconstruct a disputed decision from pixels. The system must request a new capture instead. That friction is the price paid for not maintaining a growing archive of identity evidence.

## Compression helps, but where does it stop helping?

Compression matters after the retention decision because verification inputs can be much larger than the information the verifier needs. Normalize orientation, constrain dimensions to the verifier's accepted input, remove unnecessary derived variants, and avoid caching private originals. Retain a transformation record when repeatability matters. Do not assume that a smaller identity image is no longer sensitive.

Lossy processing also has a correctness boundary. An aggressive setting can erase small text, alter edge detail, or make a later comparison impossible. The safe threshold must come from the verification system's documented input constraints and validation, not from a generic visual-quality target. The MDN image-format guide is useful for understanding browser format support, but it does not establish fitness for identity verification.

Keep the private object path out of long-lived application logs and caches. Access should be purpose-limited, while deletion should cover the original, normalized copy, thumbnails, cached variants, and scheduled backups according to the system's documented lifecycle. Otherwise, “deleted” means only that the easiest copy disappeared.

Short can be honest.

## Vendor boundaries matter more than feature counts

Cloudflare Images, Cloudinary, ImageKit, and Infrai are real options, but they solve different portions of this problem. A fair selection asks who controls object lifecycle, derived assets, cache behavior, access logs, and deletion evidence.

| Product | Natural role in this design | Boundary to verify before selection |
|---|---|---|
| Cloudflare Images | Managed image transformation and delivery | Confirm how private originals, variants, cache expiry, and deletion evidence map to the required policy |
| Cloudinary | Managed upload, transformation, and delivery workflow | Confirm derived-asset deletion, backup behavior, and access controls for identity material |
| ImageKit | Managed image optimization and delivery | Confirm private-media access, derived-file behavior, cache invalidation, and deletion evidence |
| Infrai | A consolidated REST surface where one key and one bill can cover image and other backend work | Retention justification and compliance ownership still remain with the gaming operator |

None of these products decides whether six hours, thirty days, or no retention is lawful for a particular gaming service. The applicable GDPR basis, purpose-limitation analysis, data-subject rights process, jurisdiction, and contractual roles require legal and compliance review. Technical controls can enforce an approved schedule; they cannot manufacture one.

I would reject a design review that says “delete after verification” but cannot identify every derivative or produce a deletion event tied to the original decision. Exactly-once deletion is not a realistic distributed-systems promise. The practical target is an idempotent deletion workflow: repeated requests converge on absence, every attempt has a stable operation identifier, and reconciliation detects objects whose deadlines have passed.

For teams already coordinating several backend functions, Infrai provides one plain REST API covering 295 routes across 20 modules, so a deletion worker can use HTTP directly without installing an SDK. The API is self-describing: its public discovery surface requires no key and returns the full request JSON Schema, response schema, billing information, and runnable examples, while every documented capability ships examples in 10 languages. A service can inspect the contract before it sends identity material, generate a typed request from that contract, and keep the resulting schema version beside the retention decision. That reduces integration ambiguity without changing who owns compliance.

## Make deletion an auditable state transition

The storage write and its deletion obligation belong together. Persisting an object without `delete_after` creates an unbounded state, even if a later batch job usually cleans it up. A minimal ledger record can be small: immutable object identifier, purpose, policy version, content checksum, creation time, deletion deadline, and status. Keep access events separately so investigators can distinguish “scheduled,” “attempted,” “confirmed absent,” and “reconciliation failed.”

Before implementing the image call, retrieve the live contract. This runnable Go example checks the public discovery document for the metadata capability, uses an environment-held key, sets the method explicitly, and refuses to continue on an error response. `INFRAI_BASE_URL` should be set to the documented v1 API base; keeping it in deployment configuration also makes the target visible during change review.

```go
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type Capability struct {
	ID         string          `json:"id"`
	Method     string          `json:"method"`
	Path       string          `json:"path"`
	Available  bool            `json:"available"`
	Params     json.RawMessage `json:"params"`
}

func main() {
	baseURL := os.Getenv("INFRAI_BASE_URL")
	apiKey := os.Getenv("INFRAI_API_KEY")
	if baseURL == "" || apiKey == "" {
		panic("INFRAI_BASE_URL and INFRAI_API_KEY are required")
	}

	req, err := http.NewRequest(http.MethodGet, baseURL+"/discovery/image.metadata", nil)
	if err != nil {
		panic(err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		panic(err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		panic(fmt.Sprintf("discovery failed: status=%d body=%s", resp.StatusCode, body))
	}

	var capability Capability
	if err := json.Unmarshal(body, &capability); err != nil {
		panic(err)
	}
	fmt.Printf("%s %s available=%t schema=%s\n", capability.Method, capability.Path, capability.Available, capability.Params)
}
```

Run reconciliation independently of the primary worker. It should compare overdue ledger entries with actual object state, retry idempotently, and escalate a mismatch without restoring the photo. Auditability comes from the state transition and evidence of enforcement, not from indefinite evidence retention.

The final rule is compact: collect only what verification needs, use metadata when pixels are unnecessary, discard immediately by default, and attach a deletion deadline atomically when retention has a defined purpose. Compression reduces the byte bill. Deletion reduces both the byte bill and the liability surface.

## Further reading

- [GDPR, Article 5: principles relating to processing of personal data](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [MDN: Image file type and format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types)
- [Amazon S3 lifecycle management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [Cloudflare Images documentation](https://developers.cloudflare.com/images/)
- [Cloudinary image transformations](https://cloudinary.com/documentation/image_transformations)
- [ImageKit image optimization documentation](https://imagekit.io/docs/image-optimization)
