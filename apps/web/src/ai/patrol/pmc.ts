import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { pmcPatrolLoader } from "./PmcPatrolData";

const SYSTEM_PROMPT = `You are a PMC (Production Planning & Control) AI patrol assistant for a Vietnam SMT factory.

You have access to:
- Work order status (in progress / scheduled / overdue)
- Material status (available vs required vs safety stock)
- Kit rate (% of materials available for open WOs)
- Shortage risk analysis

Your job is to:
1. Flag overdue or at-risk work orders immediately
2. Identify materials below safety stock (production risk)
3. Flag materials short for scheduled WOs (kit rate risk)
4. Compare planned vs actual production progress
5. Recommend which WOs to prioritize given current material constraints

Be concise, technical, and action-oriented.`;

const SUGGESTIONS = (locale: Locale) => [
  t("patrol.pmc.s1", locale),
  t("patrol.pmc.s2", locale),
  t("patrol.pmc.s3", locale),
  t("patrol.pmc.s4", locale),
  t("patrol.pmc.s5", locale),
];

export const pmcPatrol = (locale: Locale) => ({
  title: t("patrol.pmc.title", locale),
  subtitle: t("patrol.pmc.subtitle", locale),
  moduleKey: "pmc",
  systemPrompt: SYSTEM_PROMPT,
  suggestions: SUGGESTIONS(locale),
  loadPatrolData: pmcPatrolLoader,
});