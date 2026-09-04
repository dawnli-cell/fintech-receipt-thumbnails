import { strict as assert } from "node:assert";
import { decideThumbnail, generateThumbnail } from "./thumbnail_service";

assert.equal(decideThumbnail("low"), "approved");
assert.equal(decideThumbnail("high"), "held");
const held = await generateThumbnail({paymentId: "pay_1", image: "data:x", filename: "x.png", amountCents: 500, risk: "high"});
assert.equal(held.decision, "held");
console.log("thumbnail decision test passed");
