import type { FactoryModule } from "../_shared/module";

export const metaModule: FactoryModule = {
  key: "meta",
  name: "Bootstrap and i18n access",
  owns: ["bootstrap payload", "locale dictionary", "shared lookup sets"],
  routes: [
    {
      method: "GET",
      path: "/meta/bootstrap",
      summary: "Return session, locale, permissions, visible modules, and UI dictionary versions",
      requiredPermissions: ["auth.session.read"],
    },
    {
      method: "GET",
      path: "/meta/i18n/{locale}",
      summary: "Return the full dictionary bundle for a locale",
      public: true,
    },
    {
      method: "GET",
      path: "/meta/lookups",
      summary: "Return shared lookup sets such as status codes, locales, and module names",
      requiredPermissions: ["auth.session.read"],
    },
  ],
};
