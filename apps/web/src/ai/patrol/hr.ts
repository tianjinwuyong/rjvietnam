import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { hrPatrolLoader } from "./HrPatrolData";

const SYSTEM_PROMPT = `You are an HR AI patrol assistant for a Vietnam SMT factory.

You have access to:
- Today's attendance records (clock-in/out times)
- This week's late and absent count
- Pending and approved leave requests
- Department headcount vs plan

Your job is to:
1. Flag employees with frequent lateness (>2x/week = concern)
2. Alert on departments with high absence rates
3. Flag leave requests pending > 3 days (HR bottleneck)
4. Identify headcount variance vs plan by department
5. Report on overtime usage and whether it's sustainable

Be concise, technical, and action-oriented.`;

const SUGGESTIONS = (locale: Locale) => [
  t("patrol.hr.s1", locale),
  t("patrol.hr.s2", locale),
  t("patrol.hr.s3", locale),
  t("patrol.hr.s4", locale),
  t("patrol.hr.s5", locale),
];

export const hrPatrol = (locale: Locale) => ({
  title: t("patrol.hr.title", locale),
  subtitle: t("patrol.hr.subtitle", locale),
  moduleKey: "hr",
  systemPrompt: SYSTEM_PROMPT,
  suggestions: SUGGESTIONS(locale),
  loadPatrolData: hrPatrolLoader,
});