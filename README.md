# Ruijing SMT Factory Development Crew

使用 crewAI 构建的瑞晶SMT工厂MES系统开发团队。

## 团队成员

| 角色 | Agent | 职责 |
|------|-------|------|
| Tech Lead | `tech_lead` | 架构决策、任务分配、代码审查 |
| Backend Dev | `backend_dev` | Express.js API、PostgreSQL |
| Frontend Dev | `frontend_dev` | React/TypeScript SPA |
| Python Dev | `python_dev` | 工站 Core/2D/3D Agents |
| QA/DevOps | `qa_devops` | 测试、迁移、部署 |

## 项目结构

```
ruijing_crew/
├── pyproject.toml
├── src/
│   └── ruijing_crew/
│       ├── __init__.py
│       ├── crew_base.py      # Agent定义
│       ├── main.py           # 入口点
│       ├── config/
│       │   ├── __init__.py
│       │   ├── agents.yaml   # Agent配置
│       │   └── tasks.yaml    # Task配置
│       └── crews/
└── README.md
```

## 运行

```bash
# 激活虚拟环境
.\.venv\Scripts\Activate.ps1

# 运行开发团队
python src\ruijing_crew\main.py
```

## 工作流程

```
1. Tech Lead 分析项目 → 制定Sprint计划
2. Backend Dev 分析API架构
3. Frontend Dev 分析前端结构
4. Python Dev 分析工站Agents
5. QA/DevOps 设置CI/CD
6. Tech Lead 审查合并
```

## 项目上下文

- **工作目录**: `C:\Users\tianj\Desktop\越南工厂瑞晶`
- **主系统**: `smt-factory-system/` (React + Express + PostgreSQL)
- **工站**: `瑞晶越南工位-正式命名/` (Python Core/2D/3D)
