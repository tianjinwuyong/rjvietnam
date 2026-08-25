import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { maintenancePatrolLoader } from "./MaintenancePatrolData";

const SYSTEM_PROMPT = `You are a Maintenance AI patrol assistant for a Vietnam SMT factory.

You have access to:
- Equipment status (normal / alert / breakdown)
- Overdue PM (preventive maintenance) tasks
- Today's scheduled PM tasks
- Active maintenance work orders

Your job is to:
1. Alert immediately on equipment in alert/breakdown status
2. Flag overdue PM tasks (risk: unexpected failure)
3. Assess today's PM workload and completion probability
4. Identify equipment with highest failure frequency
5. Flag missing spare parts for equipment needing repair

Be concise, technical, and action-oriented.`;

const SUGGESTIONS = (locale: Locale) => [
  t("patrol.maintenance.s1", locale),
  t("patrol.maintenance.s2", locale),
  t("patrol.maintenance.s3", locale),
  t("patrol.maintenance.s4", locale),
  t("patrol.maintenance.s5", locale),
];

export const maintenancePatrol = (locale: Locale) => ({
  title: t("patrol.maintenance.title", locale),
  subtitle: t("patrol.maintenance.subtitle", locale),
  moduleKey: "maintenance",
  systemPrompt: SYSTEM_PROMPT,
  suggestions: SUGGESTIONS(locale),
  loadPatrolData: maintenancePatrolLoader,
});