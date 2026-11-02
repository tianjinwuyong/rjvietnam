#!/usr/bin/env python
"""
SMT Factory Bug Fix Crew - Fix issues found in test report
Powered by crewAI with Qwen
"""
import os
from crewai import Agent, Crew, Process, Task, LLM
from crewai_tools import SerperDevTool
from dotenv import load_dotenv

load_dotenv()

serper_search = SerperDevTool()

WORKSPACE = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\smt-factory-system"
STATIONS = "C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\瑞晶越南工位-正式命名"

PROJECT_CONTEXT = """
## SMT Factory System - Bug Fix Crew Task

### Issues to Fix:
1. nav.qms i18n key 显示问题 - QC角色 sidebar 显示 `nav.qms` 而非翻译文本
2. 需要全面测试各模块功能

### 项目信息:
- 工作目录: C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\smt-factory-system
- 前端: apps/web/src/ (React 18.3.1 + TypeScript + Vite)
- 后端: services/api/server.js (Express.js)
- i18n: apps/web/src/i18n/

### 技术栈:
- React 18.3.1 + TypeScript 5.8
- i18n 多语言 (zh-CN, en-US, vi-VN)
- 所有UI文本必须用i18n key，不能硬编码

### 测试账号:
- admin / Factory@123 (管理员)
- VN_OP_001 / Factory@123 (操作员)
- PMC_CN_01 / Factory@123 (PMC)
- VN_WH_001 / Factory@123 (仓库)
- QC_VN_01 / Factory@123 (质量)
"""


def get_llm():
    return LLM(
        model="dashscope/" + os.getenv("DASHSCOPE_MODEL", "qwen3.8-max-preview"),
        base_url=os.getenv("DASHSCOPE_BASE_URL", "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"),
        api_key=os.getenv("DASHSCOPE_API_KEY", ""),
    )


def create_fix_crew():
    llm = get_llm()

    # Manager for hierarchical process
    manager = Agent(
        role="Bug Fix Manager",
        goal="Coordinate bug fixes and testing, ensure all issues are resolved",
        backstory="""You are the Tech Lead coordinating bug fixes for the SMT Factory system.
        You delegate tasks to fix agents and verify all issues are resolved.""",
        verbose=True,
        llm=llm,
        tools=[serper_search],
        allow_delegation=True,
    )

    # Frontend Fixer
    frontend_fixer = Agent(
        role="Frontend Fixer & Tester",
        goal="Find and fix i18n issues, test all frontend modules",
        backstory="""You are a senior React/TypeScript developer specializing in i18n and bug fixing.
        You have 5+ years experience finding and fixing UI bugs.
        Expert in: React, TypeScript, i18n multi-language systems.""",
        verbose=True,
        llm=llm,
        tools=[serper_search],
        allow_delegation=False,
    )

    # QA Tester
    qa_tester = Agent(
        role="QA Tester",
        goal="Comprehensive testing of all system modules",
        backstory="""You are a senior QA engineer with experience in smoke testing, integration testing.
        You write test cases, find bugs, and verify fixes.
        Expert in: Playwright, API testing, SQL queries.""",
        verbose=True,
        llm=llm,
        tools=[serper_search],
        allow_delegation=False,
    )

    # Issue 1: Fix nav.qms i18n
    fix_nav_qms = Task(
        description=f"""{PROJECT_CONTEXT}

ISSUE: nav.qms i18n key 显示问题

1. Search for 'nav.qms' in the codebase (apps/web/src/)
2. Find the missing i18n translation in the language files:
   - zh-CN.json
   - en-US.json
   - vi-VN.json
3. Add the missing translation for nav.qms in all three language files
4. Verify the fix by checking the i18n structure

Report what you found and what you fixed.""",
        expected_output="nav.qms i18n key fixed in all language files",
        agent=frontend_fixer,
    )

    # Issue 2: Test WMS Module
    test_wms = Task(
        description=f"""{PROJECT_CONTEXT}

TEST WMS MODULE comprehensively:
- apps/web/src/wms/ (29 files)
- Test receiving, IQC, storage, picking, issuing
- Check for console errors, i18n issues, UI bugs

Report any issues found.""",
        expected_output="WMS module test report with any bugs found",
        agent=qa_tester,
    )

    # Issue 3: Test MES Module
    test_mes = Task(
        description=f"""{PROJECT_CONTEXT}

TEST MES MODULE comprehensively:
- apps/web/src/mes/ (54 endpoints in API)
- Test work orders, routing, station management
- Check for console errors, i18n issues, UI bugs

Report any issues found.""",
        expected_output="MES module test report with any bugs found",
        agent=qa_tester,
    )

    # Issue 4: Test Quality Module
    test_quality = Task(
        description=f"""{PROJECT_CONTEXT}

TEST QUALITY MODULE comprehensively:
- apps/web/src/quality/
- Test IQC, OQC, defect management, 8D reports
- Especially check the QC role sidebar navigation

Report any issues found.""",
        expected_output="Quality module test report with any bugs found",
        agent=qa_tester,
    )

    # Issue 5: Test HR Module
    test_hr = Task(
        description=f"""{PROJECT_CONTEXT}

TEST HR MODULE comprehensively:
- apps/web/src/hr/
- Test employee management, attendance, scheduling, payroll
- Check for console errors, i18n issues, UI bugs

Report any issues found.""",
        expected_output="HR module test report with any bugs found",
        agent=qa_tester,
    )

    # Issue 6: Test Finance Module
    test_finance = Task(
        description=f"""{PROJECT_CONTEXT}

TEST FINANCE MODULE comprehensively:
- apps/web/src/finance/
- Test invoices, payments, cost reports
- Check for console errors, i18n issues, UI bugs

Report any issues found.""",
        expected_output="Finance module test report with any bugs found",
        agent=qa_tester,
    )

    crew = Crew(
        agents=[frontend_fixer, qa_tester],
        tasks=[fix_nav_qms, test_wms, test_mes, test_quality, test_hr, test_finance],
        process=Process.sequential,
        verbose=True,
    )

    return crew


def run():
    print("Starting SMT Factory Bug Fix Crew with QWEN...")
    print("=" * 60)

    crew = create_fix_crew()
    result = crew.kickoff()

    print("\n" + "=" * 60)
    print("BUG FIX CREW COMPLETED")
    print("=" * 60)
    print(result)


if __name__ == "__main__":
    run()
