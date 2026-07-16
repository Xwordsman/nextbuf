import { describe, expect, it } from "vitest";
import { renderNotificationMail } from "@/modules/notifications/mail-template";

describe("notification mail templates", () => {
  it("renders stable topic links and escapes untrusted snapshot text", () => {
    const mail = renderNotificationMail(
      "mention",
      {
        actorName: "<script>alert(1)</script>",
        actorUsername: "member",
        topicNumber: 42,
        topicTitle: "A & B",
        postPosition: 3,
      },
      "https://community.example.com",
    );
    expect(mail.text).toContain("https://community.example.com/topics/42#post-3");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("A &amp; B");
    expect(mail.html).not.toContain("<script>");
  });
});
