import type { FactoryModule } from "../_shared/module";

export const qualityModule: FactoryModule = {
  key: "quality",
  name: "Quality inspection and closure",
  owns: ["IQC", "SPI", "AOI", "ICT", "visual inspection", "defects", "repair", "CAPA"],
  routes: [
    {
      method: "GET",
      path: "/quality/records",
      summary: "List inspection, defect, and repair records across stations",
      requiredPermissions: ["quality.view"],
    },
    {
      method: "POST",
      path: "/quality/records",
      summary: "Create an inspection, defect, or repair record",
      requiredPermissions: ["quality.review"],
    },
    {
      method: "PATCH",
      path: "/quality/records/{id}",
      summary: "Update a quality record state such as close, void, or reopen",
      requiredPermissions: ["quality.review"],
    },
    {
      method: "GET",
      path: "/quality/defect-pareto",
      summary: "Analyze defect loss by station and code",
      requiredPermissions: ["quality.view"],
    },
  ],
};
