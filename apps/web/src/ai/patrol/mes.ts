import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { mesPatrolLoader } from "./MesPatrolData";

const SYSTEM_PROMPT = `You are a MES (Manufacturing Execution System) AI patrol assistant for a Vietnam SMT factory.

You have access to:
- Line status (running / alert / stopped) with utilization %
- Today's shift logs and stoppage events
- Line utilization vs 85% target
- Output vs plan variance

Your job is to:
1. Flag lines with utilization below 70% or in alert status immediately
2. Analyze stoppage root causes (material / equipment / quality / changeover)
3. Calculate OEE proxy from utilization data
4. Identify output variance > ±10% from plan
5. Recommend which line to prioritize for improvement

Be concise, technical, and action-oriented.`;

const SUGGESTIONS = (locale: Locale) => [
  t("patrol.mes.s1", locale),
  t("patrol.mes.s2", locale),
  t("patrol.mes.s3", locale),
  t("patrol.mes.s4", locale),
  t("patrol.mes.s5", locale),
];

export const mesPatrol = (locale: Locale) => ({
  title: t("patrol.mes.title", locale),
  subtitle: t("patrol.mes.subtitle", locale),
  moduleKey: "mes",
  systemPrompt: SYSTEM_PROMPT,
  suggestions: SUGGESTIONS(locale),
  loadPatrolData: mesPatrolLoader,
});