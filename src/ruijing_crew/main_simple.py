#!/usr/bin/env python
"""
Ruijing SMT Factory Development Crew - Simplified Version
Powered by crewAI with Qwen (dashscope)
"""
import os
from crewai import Agent, Crew, Process, Task, LLM
from crewai_tools import SerperDevTool
from dotenv import load_dotenv

load_dotenv()

serper_search = SerperDevTool()

WORKSPACE = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶"
SMT_SYSTEM = f"{WORKSPACE}\\smt-factory-system"
STATIONS = f"{WORKSPACE}\\瑞晶越南工位-正式命名"

# Project context embedded in prompts (no file reading needed)
PROJECT_CONTEXT = """
## 项目概述 (Project Overview)

**工作目录**: C:\\Users\\tianj\\Desktop\\越南工厂瑞晶

### 主系统: smt-factory-system/
- React 18.3.1 + Vite 8 + TypeScript 5.8 + Express + Vitest + PostgreSQL
- 前端: apps/web/src/ (Dashboard, WMS, PMC, MES, HR, Quality, Equipment, AI模块)
- 后端API: services/api/server.js (~16.6K行)
- 数据库: PostgreSQL (无ORM, 原始pg驱动)
- 端口: API 8080, Web 5178
- 登录凭证: 密码都是 Factory@123 (VN_OP_001, VN_WH_001, PMC_CN_01等)
- i18n: zh-CN, en-US, vi-VN (必须用i18n key，不能硬编码)

### 工站系统: 瑞晶越南工位-正式命名/
- 自动线 (002-自动线) 和 手动线 (004-手动线) 各13个工站
- 工站架构: <station>_core.py → 本地SQLite → MES outbox → MES
- Core是唯一业务权威；2D和3D只能调用Core
- append-only: 生产数据只能增不能删改

### 已知问题:
- React 19 + Vite 8 会导致 "Invalid hook call" - 用 React 18.3.1
- 硬编码密码 Factory@123 在 server.js 第1565, 2636行
- watchdog 在 Windows 上可能有问题

### 常用命令:
- npm run dev / node start_dev.js (启动开发服务器)
- npm run test (vitest run)
- npm run migrate (应用迁移)
"""


def get_llm():
    """Get Qwen LLM instance"""
    return LLM(
        model="dashscope/" + os.getenv("DASHSCOPE_MODEL", "qwen3.8-max-preview"),
        base_url=os.getenv("DASHSCOPE_BASE_URL", "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
        api_key=os.getenv("DASHSCOPE_API_KEY", ""),
    )


def create_crew():
    """Create the Ruijing development crew"""

    llm = get_llm()

    # Tech Lead
    tech_lead = Agent(
        role="Tech Lead / Architect",
        goal="Coordinate the development team, make technical decisions, review code, and ensure project success",
        backstory="""You are the Tech Lead for the Ruijing SMT Factory MES system.
        You have 10+ years of experience in manufacturing execution systems.
        You speak Mandarin Chinese and English.""",
        verbose=True,
        llm=llm,
        tools=[serper_search],
        allow_delegation=True,
    )

    # Backend Developer
    backend_dev = Agent(
        role="Backend Developer",
        goal="Develop and maintain Express.js API and PostgreSQL database for the SMT factory system",
        backstory="""You are a senior backend developer specializing in Node.js/Express.
        You have 5+ years experience with Express.js API development, PostgreSQL with raw pg driver (no ORM).
        Follow: append-only data model, no hard deletes, varchar codes convention.""",
        verbose=True,
        llm=llm,
        tools=[serper_search],
        allow_delegation=False,
    )

    # Frontend Developer
    frontend_dev = Agent(
        role="Frontend Developer",
        goal="Build and maintain React/TypeScript SPA for the SMT factory dashboard and modules",
        backstory="""You are a senior frontend developer specializing in React/TypeScript.
        Expert in i18n multi-language (zh-CN, en-US, vi-VN) - MUST use i18n keys, no hardcoded strings.""",
        verbose=True,
        llm=llm,
        tools=[serper_search],
        allow_delegation=False,
    )

    # Python Developer
    python_dev = Agent(
        role="Python Developer - Station Agents",
        goal="Develop and maintain Python station Core/2D/3D agents for the SMT production line",
        backstory="""You are a senior Python developer for factory automation.
        Architecture: Core is ONLY business authority; 2D and 3D call Core only.
        Append-only: no UPDATE or DELETE for production mappings.""",
        verbose=True,
        llm=llm,
        tools=[serper_search],
        allow_delegation=False,
    )

    # QA/DevOps
    qa_devops = Agent(
        role="QA / DevOps Engineer",
        goal="Ensure quality through testing, validate migrations, and maintain deployment pipeline",
        backstory="""You are a senior QA/DevOps engineer for the SMT factory system.
        Expert in Vitest testing, PostgreSQL migrations, Windows deployment.""",
        verbose=True,
        llm=llm,
        tools=[serper_search],
        allow_delegation=False,
    )

    # Tasks
    plan_sprint = Task(
        description=f"""{PROJECT_CONTEXT}

Analyze the project and create a sprint plan.
Output a sprint plan with:
- Priority tasks for Backend, Frontend, Python Dev, and QA
- Estimated effort for each task
- Dependencies between tasks""",
        expected_output="A detailed sprint plan document with tasks, priorities, effort estimates, and dependencies.",
        agent=tech_lead,
    )

    analyze_backend = Task(
        description=f"""{PROJECT_CONTEXT}

Analyze the Express.js backend:
- services/api/server.js - main API file (~16.6K lines)
- database/migrations/ - SQL migrations
- openapi.yaml - API contracts

Output: Backend analysis report with architecture, key endpoints, and recommended improvements.""",
        expected_output="Backend analysis report with architecture diagram, key endpoints, and recommended improvements.",
        agent=backend_dev,
    )

    analyze_frontend = Task(
        description=f"""{PROJECT_CONTEXT}

Analyze the React frontend:
- apps/web/src/ - main React app
- i18n implementation
- Module organization (Dashboard, WMS, PMC, MES, HR, etc.)

Output: Frontend analysis report with component architecture, i18n status, and recommended improvements.""",
        expected_output="Frontend analysis report with component architecture, i18n status, and recommended improvements.",
        agent=frontend_dev,
    )

    analyze_python_agents = Task(
        description=f"""{PROJECT_CONTEXT}

Analyze the Python station agents:
- 瑞晶越南工位-正式命名/002-自动线/ - auto line stations
- 瑞晶越南工位-正式命名/004-手动线/ - manual line stations
- Core/2D/3D architecture
- MES outbox synchronization

Output: Python agents analysis report with architecture validation and recommended improvements.""",
        expected_output="Python agents analysis report with architecture validation and recommended improvements.",
        agent=python_dev,
    )

    setup_ci_cd = Task(
        description=f"""{PROJECT_CONTEXT}

Set up CI/CD pipeline:
- GitHub Actions workflow for test automation
- Migration validation scripts
- Deployment scripts for Windows
- Docker configuration

Output: CI/CD pipeline configuration with test, migration, and deployment workflows.""",
        expected_output="CI/CD pipeline configuration with test, migration, and deployment workflows.",
        agent=qa_devops,
    )

    review_and_merge = Task(
        description="""Review all deliverables from the development team.
Validate:
- Code quality and adherence to project standards
- Test coverage
- Documentation completeness
- Migration safety

Output: Review report with approval status for each deliverable.""",
        expected_output="Review report with approval status for each deliverable and any required changes.",
        agent=tech_lead,
    )

    # Create Crew
    crew = Crew(
        agents=[tech_lead, backend_dev, frontend_dev, python_dev, qa_devops],
        tasks=[plan_sprint, analyze_backend, analyze_frontend, analyze_python_agents, setup_ci_cd, review_and_merge],
        process=Process.sequential,
        verbose=True,
    )

    return crew


def run():
    """Run the development crew"""
    print("Starting Ruijing Development Crew with QWEN...")
    print("=" * 60)

    crew = create_crew()
    result = crew.kickoff()

    print("\n" + "=" * 60)
    print("CREW EXECUTION COMPLETED")
    print("=" * 60)
    print(result)


if __name__ == "__main__":
    run()
