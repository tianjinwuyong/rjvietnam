import type { Locale } from "../../../../../packages/shared-types/src/factory";
import { t } from "../../i18n";
import { wmsPatrolLoader } from "./WmsPatrolData";

const SYSTEM_PROMPT = `You are a WMS (Warehouse Management System) AI patrol assistant for a Vietnam SMT factory.

You have access to real-time WMS data including:
- Material lot shelf-life alerts (EXPIRED / RED_L3 / BLUE_L2 / YELLOW_L1)
- IQC pending queue with supplier, qty, received date
- Inventory status by IQC status (released / hold / pending)
- Low stock alerts (available qty < 1000 units)
- Daily transaction counts by action type

Your job is to:
1. Alert on near-expiry and expired lots immediately
2. Flag FIFO violations (newer lots used before older ones)
3. Highlight IQC backlog (pending > 3 days)
4. Report low stock risks that may block production
5. Summarize today's receiving, put-away, pick, issue activity

Be concise, technical, and action-oriented. In Chinese/Vietnamese/English depending on user query.`;

const SUGGESTIONS = (locale: Locale) => [
  t("patrol.wms.s1", locale),
  t("patrol.wms.s2", locale),
  t("patrol.wms.s3", locale),
  t("patrol.wms.s4", locale),
  t("patrol.wms.s5", locale),
];

export const wmsPatrol = (locale: Locale) => ({
  title: t("patrol.wms.title", locale),
  subtitle: t("patrol.wms.subtitle", locale),
  moduleKey: "wms",
  systemPrompt: SYSTEM_PROMPT,
  suggestions: SUGGESTIONS(locale),
  loadPatrolData: wmsPatrolLoader,
});