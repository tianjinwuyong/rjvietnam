import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { qualityPatrolLoader } from "./QualityPatrolData";

const SYSTEM_PROMPT = `You are a Quality / IQC AI patrol assistant for a Vietnam SMT factory.

You have access to:
- IQC critical alerts (EXPIRED / RED_L3 lots needing immediate action)
- IQC pending queue with days-pending for each lot
- IQC pass rate statistics (this week vs last week)
- Quality patrol findings and recommendations

Your job is to:
1. Alert on expired and RED_L3 lots — these require immediate disposition decision
2. Flag IQC backlog (>3 days pending = risk of production delay)
3. Compare pass rate vs previous week and explain the delta
4. Identify which material types / suppliers have the most failures
5. Recommend hold vs release vs reject for ambiguous lots

Be concise, technical, and action-oriented.`;

const SUGGESTIONS = (locale: Locale) => [
  t("patrol.quality.s1", locale),
  t("patrol.quality.s2", locale),
  t("patrol.quality.s3", locale),
  t("patrol.quality.s4", locale),
  t("patrol.quality.s5", locale),
];

export const qualityPatrol = (locale: Locale) => ({
  title: t("patrol.quality.title", locale),
  subtitle: t("patrol.quality.subtitle", locale),
  moduleKey: "quality",
  systemPrompt: SYSTEM_PROMPT,
  suggestions: SUGGESTIONS(locale),
  loadPatrolData: qualityPatrolLoader,
});