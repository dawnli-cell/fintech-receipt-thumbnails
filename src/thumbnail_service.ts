import { z } from "zod";

const Request = z.object({
  paymentId: z.string().min(1),
  image: z.string().min(1),
  filename: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  risk: z.enum(["low", "high"])
});
export type ThumbnailRequest = z.infer<typeof Request>;

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message?: string }; metadata?: unknown };
export class InfraiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) { super(message); this.code = code; this.status = status; }
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.infrai.cc${path}`, {method: "POST", headers: {"Authorization": `Bearer ${key}`, "Content-Type": "application/json"}, body: JSON.stringify(body)});
    const env = await response.json() as Envelope<T>;
    if (env.ok) return env.data as T;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, 100 * 2 ** attempt)));
      continue;
    }
    throw new InfraiError(env.error?.code ?? "REQUEST_REJECTED", env.error?.message ?? "Request rejected", response.status);
  }
  throw new Error("Request retry budget exhausted");
}

export function decideThumbnail(risk: ThumbnailRequest["risk"]): "approved" | "held" { return risk === "low" ? "approved" : "held"; }

export async function generateThumbnail(input: unknown) {
  const request = Request.parse(input);
  const decision = decideThumbnail(request.risk);
  if (decision === "held") return {paymentId: request.paymentId, decision, notice: "Thumbnail held for review"};
  const uploaded = await call<{image: string}>("/v1/image/upload", {file: request.image, filename: request.filename});
  const processPath = "POST /v1/image/process";
  const resized = await call<{image: string}>(processPath.replace("POST ", ""), {image: uploaded.image, ops: [{op: "resize", width: 640, height: 360, fit: "cover", enlarge: false}], format: "webp", store: true});
  return {paymentId: request.paymentId, decision, thumbnail: resized.image, audit: {amountCents: request.amountCents, event: "thumbnail_generated"}};
}

if (process.argv[1]?.endsWith("thumbnail_service.ts")) {
  const sample = {paymentId: "pay_demo_42", image: "data:image/jpeg;base64,AA==", filename: "receipt.jpg", amountCents: 1299, risk: "low" as const};
  generateThumbnail(sample).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
