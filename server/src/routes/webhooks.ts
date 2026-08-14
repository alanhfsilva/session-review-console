import { Router, raw } from "express";
import type { Db } from "../db.js";
import { HttpError } from "../types.js";
import { handleAppointmentEvent } from "../webhooks/service.js";
import { appointmentEventSchema } from "../webhooks/types.js";
import { webhookSecret } from "../webhooks/secret.js";
import { verifySignature, WEBHOOK_SIGNATURE_HEADER } from "../webhooks/verify.js";

export function webhooksRouter(db: Db): Router {
  const router = Router();

  // The raw bytes are required: a signature must be checked against exactly
  // what was delivered, not against a re-serialised object.
  router.post("/appointments", raw({ type: "application/json", limit: "128kb" }), (req, res, next) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const header = req.header(WEBHOOK_SIGNATURE_HEADER);

    const failure = verifySignature(rawBody, header, webhookSecret());
    if (failure) {
      // The vendor gets one generic reason; the specific cause stays in our logs.
      console.warn(`rejected appointment webhook: ${failure}`);
      next(new HttpError(401, "invalid_signature", "Signature missing or invalid."));
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      next(new HttpError(400, "invalid_payload", "Body is not valid JSON."));
      return;
    }

    const parsed = appointmentEventSchema.safeParse(parsedJson);
    if (!parsed.success) {
      next(new HttpError(400, "invalid_payload", "Event does not match the documented schema."));
      return;
    }

    const result = handleAppointmentEvent(db, parsed.data);
    res.json({ received: true, eventId: parsed.data.eventId, result });
  });

  return router;
}
