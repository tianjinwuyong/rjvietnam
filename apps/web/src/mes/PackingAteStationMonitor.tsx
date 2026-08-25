import type { Locale } from "../../../../packages/shared-types/src/factory";
import { IctStationMonitor } from "./IctStationMonitor";

export function PackingAteStationMonitor({ locale }: { locale: Locale }) {
  return <IctStationMonitor locale={locale} stationCode="manu_package_ate" stationKind="ASSEMBLY ATE" stationLabel="PACKAGING ATE" />;
}
