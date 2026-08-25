import type { Locale } from "../../../../packages/shared-types/src/factory";
import { IctStationMonitor } from "./IctStationMonitor";
export function AoiStationMonitor({locale}:{locale:Locale}){return <IctStationMonitor locale={locale} stationCode="manu_aio" stationKind="ICT" stationLabel="AOI QUALITY"/>}
