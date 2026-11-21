import { IQC_VIRTUAL_ALLOWED_TOOLS, IQC_VIRTUAL_DENIED_ACTIONS, IQC_VIRTUAL_SKILLS } from "./virtual-employee-skills.js";
import { IQC_VIRTUAL_CHANNELS, IQC_VIRTUAL_JOB, IQC_VIRTUAL_KNOWLEDGE, IQC_VIRTUAL_PERSONALITY, IQC_VIRTUAL_PROMPTS, IQC_VIRTUAL_SPECIAL_KNOWLEDGE } from "./virtual-employee-profile.js";

export const IQC_VIRTUAL_HARNESS = {
  id: "iqc-virtual-employee-harness-v1",
  checkpointing: "workflow-result-and-audit-required",
  humanGates: ["approve-exempt", "abnormal-return", "supplier-improvement"],
  maxRetries: 1,
  failClosed: true,
  skills: IQC_VIRTUAL_SKILLS,
  allowedTools: IQC_VIRTUAL_ALLOWED_TOOLS,
  deniedActions: IQC_VIRTUAL_DENIED_ACTIONS,
  personality: IQC_VIRTUAL_PERSONALITY,
  specialKnowledge: IQC_VIRTUAL_SPECIAL_KNOWLEDGE,
  prompts: IQC_VIRTUAL_PROMPTS,
  job: IQC_VIRTUAL_JOB,
  knowledge: IQC_VIRTUAL_KNOWLEDGE,
  channels: IQC_VIRTUAL_CHANNELS,
};

export function guardIqcVirtualAction(action) {
  if (IQC_VIRTUAL_DENIED_ACTIONS.includes(action)) throw new Error(`IQC virtual employee is not authorized to ${action}`);
  if (!IQC_VIRTUAL_ALLOWED_TOOLS.includes(action)) throw new Error(`Unknown IQC virtual employee tool: ${action}`);
  return true;
}
