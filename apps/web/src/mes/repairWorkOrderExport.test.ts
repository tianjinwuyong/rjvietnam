import { describe, expect, it } from "vitest";
import { collectAttachmentReferences } from "./repairWorkOrderExport";

describe("repair work-order export", () => {
  it("flattens evidence and related-file references without losing event provenance", () => {
    const refs = collectAttachmentReferences([
      { eventId: "repair-1", payload: { photoUrl: " /evidence/photo-1.jpg ", attachments: [{ url: "/evidence/log.txt" }] } },
      { eventId: "repair-2", payload: { note: "no file" } },
    ]);
    expect(refs).toEqual([
      { eventId: "repair-1", kind: "photo", reference: "/evidence/photo-1.jpg" },
      { eventId: "repair-1", kind: "attachment", reference: "/evidence/log.txt" },
    ]);
  });
});
