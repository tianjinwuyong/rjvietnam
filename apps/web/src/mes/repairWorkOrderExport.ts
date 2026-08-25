export interface RepairWorkOrderExportEvent {
  eventId?: string;
  payload?: Record<string, unknown>;
}

export function collectAttachmentReferences(events: RepairWorkOrderExportEvent[]) {
  const refs: Array<{ eventId: string; kind: string; reference: string }> = [];
  for (const event of events) {
    const payload = event.payload || {};
    const values = [
      ["attachment", payload.attachmentUrl],
      ["file", payload.fileUrl],
      ["photo", payload.photoUrl],
      ["evidence", payload.evidenceUrl],
      ...(Array.isArray(payload.attachments) ? payload.attachments.map((value) => ["attachment", value]) : []),
    ] as Array<[string, unknown]>;
    for (const [kind, value] of values) {
      if (typeof value === "string" && value.trim()) refs.push({ eventId: String(event.eventId || ""), kind, reference: value.trim() });
      else if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") refs.push({ eventId: String(event.eventId || ""), kind, reference: String((value as { url: string }).url).trim() });
    }
  }
  return refs;
}
