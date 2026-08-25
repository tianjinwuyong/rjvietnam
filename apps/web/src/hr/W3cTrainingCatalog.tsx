import type { Locale } from "../../../../packages/shared-types/src/factory";

type W3cResource = {
  title: string;
  audience: string;
  description: string;
  url: string;
  duration?: string;
};

const W3C_RESOURCES: W3cResource[] = [
  {
    title: "Digital Accessibility Foundations",
    audience: "All employees, managers, designers, developers, content authors",
    description: "Free self-paced introduction to digital accessibility. An optional certificate is available from W3C WAI.",
    duration: "Self-paced",
    url: "https://www.w3.org/WAI/courses/foundations-course/",
  },
  {
    title: "What Is Web Accessibility",
    audience: "All employees",
    description: "Why accessibility matters and how it supports people with disabilities.",
    url: "https://www.w3.org/WAI/curricula/foundation-modules/",
  },
  {
    title: "People and Digital Technology",
    audience: "HR, product, design, support, managers",
    description: "User needs, barriers, and the impact of inaccessible digital tools.",
    url: "https://www.w3.org/WAI/curricula/foundation-modules/",
  },
  {
    title: "Business Case and Benefits",
    audience: "Managers and HR leaders",
    description: "Inclusion, risk reduction, usability, and organizational benefits of accessibility.",
    url: "https://www.w3.org/WAI/curricula/foundation-modules/",
  },
  {
    title: "Principles, Standards, and Checks",
    audience: "Managers, designers, developers, QA",
    description: "Accessibility principles, W3C standards, WCAG, and basic conformance checks.",
    url: "https://www.w3.org/WAI/curricula/foundation-modules/",
  },
  {
    title: "Getting Started with Accessibility",
    audience: "Team leads and implementation teams",
    description: "Practical first steps for embedding accessibility into day-to-day delivery.",
    url: "https://www.w3.org/WAI/curricula/foundation-modules/",
  },
  {
    title: "Developer Accessibility Curriculum",
    audience: "Frontend and application developers",
    description: "Accessible structure, navigation, images, tables, forms, widgets, and rich applications.",
    url: "https://www.w3.org/WAI/curricula/",
  },
  {
    title: "Designer Accessibility Curriculum",
    audience: "UI/UX and visual designers",
    description: "Accessible visual design, information architecture, navigation, interaction, media, and forms.",
    url: "https://www.w3.org/WAI/curricula/",
  },
  {
    title: "Content Author Accessibility Curriculum",
    audience: "HR, trainers, writers, and content authors",
    description: "Clear writing, headings, links, images, tables, forms, and multimedia content.",
    url: "https://www.w3.org/WAI/curricula/",
  },
  {
    title: "WAI Tutorials",
    audience: "Designers, developers, QA, content authors",
    description: "Practical implementation tutorials for page structure, menus, images, tables, forms, and carousels.",
    url: "https://www.w3.org/WAI/tutorials/",
  },
  {
    title: "Role-Based Accessibility Resources",
    audience: "Managers, trainers, policy makers, developers, designers, writers, evaluators",
    description: "Choose learning materials based on the employee's role and responsibility.",
    url: "https://www.w3.org/WAI/roles/",
  },
];

const COPY: Record<Locale, { title: string; intro: string; courses: string; map: string; source: string; note: string; path: string[] }> = {
  "zh-CN": { title: "W3C 无障碍学习路径", intro: "W3C Web Accessibility Initiative 官方资源。这些是外部学习链接，不是工厂培训记录。", courses: "打开 W3C 课程", map: "学习导航图", source: "打开 W3C 资源 →", note: "W3C 外部培训提供商目录未导入，因为提供商与许可不在工厂控制范围内。", path: ["基础：数字无障碍基础", "角色路径：管理者、设计师、开发人员、内容作者或评估人员", "实践：WAI 教程", "工厂应用：将无障碍设计应用于内部 HR、WMS、MES 和工位工具"] },
  "vi-VN": { title: "Lộ trình học khả năng tiếp cận W3C", intro: "Tài nguyên chính thức của W3C Web Accessibility Initiative. Đây là liên kết học tập bên ngoài, không phải hồ sơ đào tạo của nhà máy.", courses: "Mở khóa học W3C", map: "Bản đồ điều hướng học tập", source: "Mở tài nguyên W3C →", note: "Danh mục nhà cung cấp khóa học bên ngoài của W3C không được nhập vì nhà cung cấp và giấy phép nằm ngoài quyền kiểm soát của nhà máy.", path: ["Nền tảng: Cơ bản về khả năng tiếp cận số", "Lộ trình theo vai trò: quản lý, thiết kế, phát triển, tác giả nội dung hoặc đánh giá", "Thực hành: Hướng dẫn WAI", "Ứng dụng nhà máy: áp dụng thiết kế dễ tiếp cận cho công cụ HR, WMS, MES và công đoạn nội bộ"] },
  "en-US": { title: "W3C Accessibility Learning Path", intro: "Official W3C Web Accessibility Initiative resources. These are external learning links, not factory training records.", courses: "Open W3C courses", map: "Navigation map", source: "Open W3C resource →", note: "The W3C external provider directory is intentionally not imported because providers and licensing are outside factory control.", path: ["Foundation: Digital Accessibility Foundations", "Role path: manager, designer, developer, content author, or evaluator", "Practice: WAI Tutorials", "Factory application: apply accessible design to internal HR, WMS, MES, and station tools"] },
};

export function W3cTrainingCatalog({ locale }: { locale: Locale }) {
  const copy = COPY[locale] || COPY["en-US"];
  return (
    <section className="surface-panel" style={{ padding: 18 }}>
      <div style={{ display: "flex", gap: 16, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h3 style={{ margin: 0 }}>{copy.title}</h3>
          <p style={{ color: "#94a3b8", margin: "6px 0 0", maxWidth: 760 }}>
            {copy.intro}
          </p>
        </div>
        <a className="btn-primary" href="https://www.w3.org/WAI/courses/" target="_blank" rel="noreferrer">{copy.courses}</a>
      </div>

      <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 14, marginBottom: 18 }}>
        <strong style={{ color: "#67e8f9" }}>{copy.map}</strong>
        <ol style={{ margin: "8px 0 0", paddingLeft: 22, color: "#cbd5e1", display: "grid", gap: 5 }}>
          {copy.path.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {W3C_RESOURCES.map((resource) => (
          <article key={resource.title} style={{ background: "#111827", border: "1px solid #334155", borderRadius: 10, padding: 14, display: "grid", gap: 8 }}>
            <h4 style={{ margin: 0, color: "#f8fafc" }}>{resource.title}</h4>
            <div style={{ color: "#67e8f9", fontSize: 12, fontWeight: 700 }}>{resource.audience}</div>
            <p style={{ margin: 0, color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 }}>{resource.description}</p>
            {resource.duration && <span style={{ color: "#94a3b8", fontSize: 12 }}>{resource.duration}</span>}
            <a href={resource.url} target="_blank" rel="noreferrer" style={{ color: "#67e8f9", fontWeight: 700, textDecoration: "none" }}>{copy.source}</a>
          </article>
        ))}
      </div>

      <p style={{ color: "#94a3b8", fontSize: 12, margin: "18px 0 0" }}>
        {copy.note}
      </p>
    </section>
  );
}
