import { describe, expect, it } from "vitest";
import { IDENTITY_EMAIL_TOPIC, MAIL_DELIVERY_TOPIC } from "@/infrastructure/mail/queue";
import { outboxJobPrivacyOptions } from "@/infrastructure/outbox/dispatcher";

describe("Outbox BullMQ privacy options", () => {
  it.each([IDENTITY_EMAIL_TOPIC, MAIL_DELIVERY_TOPIC])(
    "removes mail job state and stack traces for %s",
    (topic) => {
      expect(outboxJobPrivacyOptions(topic, 100, 200)).toEqual({
        removeOnComplete: true,
        removeOnFail: true,
        stackTraceLimit: 0,
      });
    },
  );

  it("keeps the configured retention contract for non-mail jobs", () => {
    expect(outboxJobPrivacyOptions("nextbuf.runtime.probe", 100, 200)).toEqual({
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    });
  });
});
