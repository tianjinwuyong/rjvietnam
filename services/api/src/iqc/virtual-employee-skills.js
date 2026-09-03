export const IQC_VIRTUAL_SKILLS = [
  { id: "factory-organization-navigator", purpose: "Recognize factory departments, owners, escalation paths, and the correct cross-department handoff for an IQC issue." },
  { id: "excel-guidance-reader", purpose: "Read only the ACTIVE IQC Excel guidance and preserve its version identity." },
  { id: "sampling-plan-builder", purpose: "Match lot quantity to the imported sampling plan." },
  { id: "iqc-procedure-builder", purpose: "Build required inspection items from the active guidance workbook." },
  { id: "real-result-validator", purpose: "Accept only real PASS/FAIL or measured evidence from approved sources." },
  { id: "inspection-level-monitor", purpose: "Apply deterministic 8.2.1-8.2.5 inspection-level rules." },
  { id: "defect-and-mrb-router", purpose: "Route failed material to defect warehouse and MRB, with rework returning through QR." },
  { id: "learning-recommender", purpose: "Recommend improvements from approved historical evidence without changing rules." },
  { id: "memory-source-validator", purpose: "Verify that every memory has a source, owner, timestamp, scope, and supporting evidence before it can be recalled as fact." },
  { id: "memory-deduplicator", purpose: "Detect repeated memories for the same material, supplier, lot, task, or guidance source and keep one canonical record." },
  { id: "memory-conflict-detector", purpose: "Compare memory against ACTIVE Excel and real records; stop and escalate when sources disagree." },
  { id: "memory-lifecycle-manager", purpose: "Promote, supersede, archive, or discard memories according to approval, freshness, evidence, and source priority." },
  { id: "memory-maintenance-reviewer", purpose: "Periodically review stale, low-confidence, incomplete, and unused memories without deleting audit history." },
  { id: "cross-department-coordinator", purpose: "Create traceable requests to receiving, purchasing, engineering, production, supplier quality, QMS, and warehouse while preserving IQC ownership." },
];

export const IQC_VIRTUAL_ALLOWED_TOOLS = [
  "read_active_guidance", "read_receiving_queue", "create_iqc_task", "read_real_measurements",
  "submit_iqc_result", "record_defect", "route_to_mrb", "create_learning_recommendation",
  "run_powershell_iqc",
  "validate_memory_source", "find_duplicate_memory", "detect_memory_conflict", "maintain_memory_index",
];

export const IQC_VIRTUAL_DENIED_ACTIONS = [
  "invent_measurement", "change_aql_or_ac_re", "release_without_evidence", "approve_exempt",
  "confirm_complaint", "confirm_supplier_improvement", "activate_guidance", "delete_guidance",
];
