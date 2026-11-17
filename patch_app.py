import re

with open('apps/web/src/App.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Add Bot import
c = c.replace('  Sparkles,', '  Sparkles,\n  Bot,')

# 2. ModuleKey type
c = c.replace(
    'type ModuleKey = "dashboard" | "pmc" | "wms" | "mes" | "quality" | "trace" | "reports" | "admin" | "hr" | "maintenance" | "ai" | "finance" | "sales" | "service";',
    'type ModuleKey = "dashboard" | "pmc" | "wms" | "mes" | "quality" | "trace" | "reports" | "admin" | "hr" | "maintenance" | "ai" | "finance" | "sales" | "service" | "agents";'
)

# 3. modules array
c = c.replace(
    '  { key: "ai", label: "nav.ai", icon: Sparkles },\n];',
    '  { key: "ai", label: "nav.ai", icon: Sparkles },\n  { key: "agents", label: "nav.agents", icon: Bot },\n];'
)

# 4. moduleGroups
c = c.replace(
    '{ label: "nav.group.control", items: ["reports", "sales", "service", "finance", "admin", "hr", "maintenance", "ai"] }',
    '{ label: "nav.group.control", items: ["reports", "sales", "service", "finance", "admin", "hr", "maintenance", "ai", "agents"] }'
)

# 5. moduleSubtitleKeys
c = c.replace(
    '  ai: "page.ai",\n};',
    '  ai: "page.ai",\n  agents: "page.agents",\n};'
)

# 6. roleModuleAccess
c = c.replace(
    'admin: ["dashboard", "pmc", "wms", "mes", "quality", "trace", "reports", "admin", "hr", "maintenance", "finance", "sales", "service", "ai"],',
    'admin: ["dashboard", "pmc", "wms", "mes", "quality", "trace", "reports", "admin", "hr", "maintenance", "finance", "sales", "service", "ai", "agents"],'
)
c = c.replace(
    'management: ["dashboard", "reports", "trace", "finance", "sales", "service", "hr", "ai"],',
    'management: ["dashboard", "reports", "trace", "finance", "sales", "service", "hr", "ai", "agents"],'
)
c = c.replace(
    'engineering: ["dashboard", "mes", "quality", "trace", "maintenance"],',
    'engineering: ["dashboard", "mes", "quality", "trace", "maintenance", "agents"],'
)

# 7. Import AgentDashboard
c = c.replace(
    'import { AiChat } from "./ai/AiChat";',
    'import { AiChat } from "./ai/AiChat";\nimport { AgentDashboard } from "./agents/AgentDashboard";'
)

# 8. Content render
old_render = '    ai: <AiChat locale={locale} />,\n  }[active];'
new_render = '    ai: <AiChat locale={locale} />,\n    agents: <AgentDashboard />,\n  }[active];'
c = c.replace(old_render, new_render)

with open('apps/web/src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print('done')
