#!/usr/bin/env python
"""
Ruijing SMT Factory Development Crew - Main Entry Point
Powered by crewAI with Multi-LLM Support (Minimax & Qwen)
"""
import os
from crewai import Agent, Crew, Process, Task, LLM
from crewai_tools import FileReadTool, SerperDevTool
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

file_read = FileReadTool(
    base_path="C:\\Users\\tianj\\Desktop\\越南工厂瑞晶"
)
serper_search = SerperDevTool()

# ============================================
# LLM Configuration - Minimax & Qwen
# ============================================
def get_llm(provider: str = None):
    """Get LLM instance based on provider"""
    provider = provider or os.getenv("DEFAULT_LLM_PROVIDER", "minimax")

    if provider == "minimax":
        return LLM(
            model="openai/" + os.getenv("MINIMAX_MODEL", "MiniMax-M2.7"),
            base_url=os.getenv("MINIMAX_BASE_URL", "https://api.minimaxi.com/v1"),
            api_key=os.getenv("MINIMAX_API_KEY", ""),
        )
    elif provider == "qwen":
        return LLM(
            model="dashscope/" + os.getenv("DASHSCOPE_MODEL", "qwen3.8-max-preview"),
            base_url=os.getenv("DASHSCOPE_BASE_URL", "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
            api_key=os.getenv("DASHSCOPE_API_KEY", ""),
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")


def create_crew(provider: str = None):
    """Create the Ruijing development crew with specified LLM provider"""

    llm = get_llm(provider)

    # Tech Lead
    tech_lead = Agent(
        role="Tech Lead / Architect",
        goal="Coordinate the development team, make technical decisions, review code, and ensure project success",
        backstory="""You are the Tech Lead for the Ruijing SMT Factory MES system.
        You have 10+ years of experience in manufacturing execution systems.
        You excel at architecture design, task decomposition, code review, and team coordination.
        You speak Mandarin Chinese and English.""",
        verbose=True,
        llm=llm,
        tools=[file_read, serper_search],
        allow_delegation=True,
    )

    # Backend Developer
    backend_dev = Agent(
        role="Backend Developer",
        goal="Develop and maintain Express.js API and PostgreSQL database for the SMT factory system",
        backstory="""You are a senior backend developer specializing in Node.js/Express.
        You have 5+ years experience with Express.js API development, PostgreSQL with raw pg driver (no ORM),
        database migrations (001-045+), and API contracts (openapi.yaml).
        Key files:
        - API: smt-factory-system/services/api/server.js
        - Migrations: smt-factory-system/database/migrations/
        - Contracts: smt-factory-system/services/api/openapi.yaml
        Follow: append-only data model, no hard deletes, varchar codes.""",
        verbose=True,
        llm=llm,
        tools=[file_read, serper_search],
        allow_delegation=False,
    )

    # Frontend Developer
    frontend_dev = Agent(
        role="Frontend Developer",
        goal="Build and maintain React/TypeScript SPA for the SMT factory dashboard and modules",
        backstory="""You are a senior frontend developer specializing in React/TypeScript.
        You have 5+ years experience with React 18.3.1 + TypeScript 5.8 + Vite 8.
        Expert in i18n multi-language (zh-CN, en-US, vi-VN) - MUST use i18n keys, no hardcoded strings.
        Known issue: React "Invalid hook call" with React 19 + Vite 8. Use React 18.3.1.
        Key paths:
        - Web app: smt-factory-system/apps/web/src/
        - Scanner terminal: smt-factory-system/apps/scanner-terminal/""",
        verbose=True,
        llm=llm,
        tools=[file_read, serper_search],
        allow_delegation=False,
    )

    # Python Developer
    python_dev = Agent(
        role="Python Developer - Station Agents",
        goal="Develop and maintain Python station Core/2D/3D agents for the SMT production line",
        backstory="""You are a senior Python developer for factory automation.
        Architecture pattern (MUST follow):
        <station>_core.py → 本地SQLite → MES outbox → MES
               ↑       ↑
           2D Agent   3D Agent
        Core is the ONLY business authority; 2D and 3D can only call Core.
        Append-only: no UPDATE or DELETE for production mappings.
        Key paths:
        - Auto line: 瑞晶越南工位-正式命名/002-自动线/
        - Manual line: 瑞晶越南工位-正式命名/004-手动线/""",
        verbose=True,
        llm=llm,
        tools=[file_read, serper_search],
        allow_delegation=False,
    )

    # QA/DevOps
    qa_devops = Agent(
        role="QA / DevOps Engineer",
        goal="Ensure quality through testing, validate migrations, and maintain deployment pipeline",
        backstory="""You are a senior QA/DevOps engineer for the SMT factory system.
        You have 5+ years experience with Vitest testing, PostgreSQL migrations, Windows deployment.
        Key commands:
        - npm run dev / node start_dev.js (start dev server)
        - npm run test (vitest run)
        - npm run migrate (apply migrations)
        Known issues: React hook call bug, watchdog Windows issues, hardcoded password Factory@123.""",
        verbose=True,
        llm=llm,
        tools=[file_read, serper_search],
        allow_delegation=False,
    )

    # Tasks
    plan_sprint = Task(
        description="""Analyze the Ruijing SMT factory MES system and create a sprint plan.
        Review:
        1. smt-factory-system/AGENTS.md - System overview
        2. 瑞晶越南工位-正式命名/002-自动线/STATION_CORE_ARCHITECTURE.md - Station architecture
        3. Current project structure and any pending issues

        Output a sprint plan with:
        - Priority tasks for Backend, Frontend, Python Dev, and QA
        - Estimated effort for each task
        - Dependencies between tasks""",
        expected_output="A detailed sprint plan document with tasks, priorities, effort estimates, and dependencies.",
        agent=tech_lead,
    )

    analyze_backend = Task(
        description="""Analyze the Express.js backend at smt-factory-system/services/api/server.js
        Review:
        - API routes and endpoints
        - Database schema and migrations
        - Authentication/authorization
        - Known issues (hardcoded password, etc.)""",
        expected_output="Backend analysis report with architecture diagram, key endpoints, and recommended improvements.",
        agent=backend_dev,
    )

    analyze_frontend = Task(
        description="""Analyze the React frontend at smt-factory-system/apps/web/src/
        Review:
        - Component structure and state management
        - i18n implementation
        - Module organization (Dashboard, WMS, PMC, MES, HR, etc.)
        - Known issues (React hook call bug)""",
        expected_output="Frontend analysis report with component architecture, i18n status, and recommended improvements.",
        agent=frontend_dev,
    )

    analyze_python_agents = Task(
        description="""Analyze the Python station agents in 瑞晶越南工位-正式命名/
        Review:
        - Station core architecture (Core/2D/3D pattern)
        - Heartbeat implementation
        - MES outbox synchronization
        - SQLite database schema""",
        expected_output="Python agents analysis report with architecture validation and recommended improvements.",
        agent=python_dev,
    )

    setup_ci_cd = Task(
        description="""Set up CI/CD pipeline for the project.
        Create:
        - GitHub Actions workflow for test automation
        - Migration validation scripts
        - Deployment scripts for Windows
        - Docker configuration if needed""",
        expected_output="CI/CD pipeline configuration with test, migration, and deployment workflows.",
        agent=qa_devops,
    )

    review_and_merge = Task(
        description="""Review all deliverables from the development team.
        Validate:
        - Code quality and adherence to project standards
        - Test coverage
        - Documentation completeness
        - Migration safety""",
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


def run(provider: str = None):
    """Run the development crew"""
    provider = provider or os.getenv("DEFAULT_LLM_PROVIDER", "minimax")

    inputs = {
        "project_path": "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶",
        "smt_system": "smt-factory-system",
        "stations": "瑞晶越南工位-正式命名",
    }

    print(f"Starting Ruijing Development Crew with {provider.upper()}...")
    print("=" * 60)

    crew = create_crew(provider)
    result = crew.kickoff(inputs=inputs)

    print("\n" + "=" * 60)
    print("CREW EXECUTION COMPLETED")
    print("=" * 60)
    print(result)


if __name__ == "__main__":
    import sys
    provider = sys.argv[1] if len(sys.argv) > 1 else None
    run(provider)
