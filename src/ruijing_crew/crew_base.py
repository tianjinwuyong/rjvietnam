"""
Ruijing SMT Factory Development Crew
Powered by crewAI
"""
from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task
from crewai_tools import FileReadTool, SerperDevTool

# Define tools available to all agents
file_read = FileReadTool()
serper_search = SerperDevTool()

# Base paths
WORKSPACE = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶"
SMT_SYSTEM = f"{WORKSPACE}\\smt-factory-system"
STATIONS = f"{WORKSPACE}\\瑞晶越南工位-正式命名"


@CrewBase
class RuijingCrew():
    """Ruijing SMT Factory Development Team"""

    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    @agent
    def tech_lead(self) -> Agent:
        return Agent(
            role="Tech Lead / Architect",
            goal="Coordinate the development team, make technical decisions, review code, and ensure project success",
            backstory="""You are the Tech Lead for the Ruijing SMT Factory MES system.
            You have 10+ years of experience in manufacturing execution systems.
            You excel at architecture design, task decomposition, code review, and team coordination.
            You speak Mandarin Chinese and English.""",
            verbose=True,
            tools=[file_read, serper_search],
            allow_delegation=True,
        )

    @agent
    def backend_dev(self) -> Agent:
        return Agent(
            role="Backend Developer",
            goal="Develop and maintain Express.js API and PostgreSQL database for the SMT factory system",
            backstory="""You are a senior backend developer specializing in Node.js/Express.
            You have 5+ years experience with:
            - Express.js API development (the main server.js is ~16.6K lines)
            - PostgreSQL with raw pg driver (no ORM)
            - Database migrations (001-045+ migration files)
            - API contracts (openapi.yaml)

            Key files:
            - API: smt-factory-system/services/api/server.js
            - Migrations: smt-factory-system/database/migrations/
            - Contracts: smt-factory-system/services/api/openapi.yaml

            You follow: append-only data model, no hard deletes, varchar codes.""",
            verbose=True,
            tools=[file_read, serper_search],
            allow_delegation=False,
        )

    @agent
    def frontend_dev(self) -> Agent:
        return Agent(
            role="Frontend Developer",
            goal="Build and maintain React/TypeScript SPA for the SMT factory dashboard and modules",
            backstory="""You are a senior frontend developer specializing in React/TypeScript.
            You have 5+ years experience with:
            - React 18.3.1 + TypeScript 5.8 + Vite 8
            - React SPA with multiple modules (Dashboard, WMS, PMC, MES, HR, Quality, Equipment, AI)
            - i18n multi-language support (zh-CN, en-US, vi-VN) - MUST use i18n keys, no hardcoded strings
            - TypeScript strict mode

            Key paths:
            - Web app: smt-factory-system/apps/web/src/
            - Scanner terminal: smt-factory-system/apps/scanner-terminal/
            - Display board: smt-factory-system/apps/display-board/

            Known issue: React "Invalid hook call" with React 19 + Vite 8. Use React 18.3.1.""",
            verbose=True,
            tools=[file_read, serper_search],
            allow_delegation=False,
        )

    @agent
    def python_dev(self) -> Agent:
        return Agent(
            role="Python Developer - Station Agents",
            goal="Develop and maintain Python station Core/2D/3D agents for the SMT production line",
            backstory="""You are a senior Python developer for factory automation.
            You have 5+ years experience with:
            - Python station agents (Core/2D/3D architecture)
            - SQLite local database with append-only model
            - MES outbox synchronization
            - Station heartbeat and safety systems

            Architecture pattern (MUST follow):
            <station>_core.py → 本地SQLite → MES outbox → MES
                   ↑       ↑
               2D Agent   3D Agent

            Core is the ONLY business authority; 2D and 3D can only call Core.
            Production data flow: local → MES only; MES cannot overwrite local evidence.
            SN, NG, binding/test mappings, outbox, change logs must be local.
            Append-only: no UPDATE or DELETE for production mappings.

            Key paths:
            - Auto line: 瑞晶越南工位-正式命名/002-自动线/
            - Manual line: 瑞晶越南工位-正式命名/004-手动线/
            - Station heartbeat: station_heartbeat.py
            - Station core contract: station_core_contract.py""",
            verbose=True,
            tools=[file_read, serper_search],
            allow_delegation=False,
        )

    @agent
    def qa_devops(self) -> Agent:
        return Agent(
            role="QA / DevOps Engineer",
            goal="Ensure quality through testing, validate migrations, and maintain deployment pipeline",
            backstory="""You are a senior QA/DevOps engineer for the SMT factory system.
            You have 5+ years experience with:
            - Vitest testing (tests/ directory)
            - PostgreSQL migrations and seeding
            - Windows deployment (batch scripts, PowerShell)
            - API testing with Postman/curl
            - Docker deployment (docker-compose.yml exists)

            Key commands:
            - npm run dev / node start_dev.js (start dev server)
            - npm run test (vitest run)
            - npm run migrate (apply migrations)
            - npm run migrate:seed (migrations + seed data)

            Known issues to watch for:
            - React invalid hook call (use React 18.3.1)
            - Watchdog process management on Windows
            - Hardcoded password Factory@123 in server.js""",
            verbose=True,
            tools=[file_read, serper_search],
            allow_delegation=False,
        )
