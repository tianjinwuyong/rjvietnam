import type { FactoryModule } from "../_shared/module";

export const salesModule: FactoryModule = {
  key: "sales",
  name: "Sales order management and order-to-cash closed loop",
  owns: ["sales orders", "sales quotes", "order-to-cash closed loop", "customer invoices"],
  routes: [
    {
      method: "GET",
      path: "/sales/orders",
      summary: "List sales orders with optional status / customer / search filter",
      requiredPermissions: ["sales.view"],
    },
    {
      method: "POST",
      path: "/sales/orders",
      summary: "Create a sales order (status open)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "GET",
      path: "/sales/orders/{id}",
      summary: "Get a single sales order with lines and linked work orders",
      requiredPermissions: ["sales.view"],
    },
    {
      method: "PUT",
      path: "/sales/orders/{id}/lines/{lineId}/fulfill",
      summary: "Fulfill a sales order line (loose fulfill)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "GET",
      path: "/sales/quotes",
      summary: "List sales quotes",
      requiredPermissions: ["sales.view"],
    },
    {
      method: "PUT",
      path: "/sales/quotes/{id}/convert-to-so",
      summary: "Convert a sales quote into a sales order",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "GET",
      path: "/sales/dashboard-summary",
      summary: "Sales dashboard KPI summary",
      requiredPermissions: ["sales.view"],
    },
    {
      method: "POST",
      path: "/sales/orders/{id}/confirm",
      summary: "Confirm a sales order (open → confirmed) and create linked work orders",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "POST",
      path: "/sales/orders/{id}/release",
      summary: "Release a confirmed sales order (confirmed → released)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "POST",
      path: "/sales/orders/{id}/ship",
      summary: "Mark a sales order shipped (released/in_production/ready_to_ship → shipped)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "POST",
      path: "/sales/orders/{id}/deliver",
      summary: "Mark a sales order delivered (shipped → delivered)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "POST",
      path: "/sales/orders/{id}/invoice",
      summary: "Issue an AR invoice for a delivered sales order (delivered → invoiced)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "POST",
      path: "/sales/orders/{id}/pay",
      summary: "Mark a sales order paid (invoiced → paid)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "POST",
      path: "/sales/orders/{id}/cancel",
      summary: "Cancel a sales order (open/confirmed/released → cancelled, reason required)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "POST",
      path: "/sales/orders/{id}/close",
      summary: "Close a paid sales order (paid → closed)",
      requiredPermissions: ["sales.manage"],
    },
    {
      method: "GET",
      path: "/sales/orders/{id}/history",
      summary: "Return the sales order status-change history",
      requiredPermissions: ["sales.view"],
    },
  ],
};
