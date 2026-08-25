import type { Locale } from "../../../../packages/shared-types/src/factory";
import { IctStationMonitor } from "./IctStationMonitor";

export function AssemblyAteStationMonitor({ locale }: { locale: Locale }) {
  return <IctStationMonitor locale={locale} stationCode="manu_assem_ate" stationKind="ASSEMBLY ATE" />;
}
