# HR AI Manager — Virtual Agent Skills
# Human Resources AI Manager — 越南工厂瑞晶人力资源AI管理员

## Agent Profile

**Name**: HR AI Manager (`HR管理员`, `Quản lý HR AI`)
**Model**: Ornith-1.0-9B (local, privacy-first, no employee data leaves factory premises) + OpenCode (code execution)
**Execution**: PowerShell scripts + Node.js DB queries + OpenCode + API calls
**Escalation**: LINE notifications for critical HR events; human-in-the-loop for disciplinary actions, termination, and major policy exceptions
**Memory**: Last-state JSON for delta detection between cycles; attendance streak tracking
**Audit**: Every HR action logged with timestamp, operator, employee_id, reason, and supporting evidence
**Vietnam Labor Law**: CU28/2020/TT-BLDTBXH (Decree on overtime work in enterprises), Vietnam Labor Code 2019

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)                    │
│  Every 15 min: attendance patrol                            │
│  Every 30 min: leave/OT queue scan                         │
│  07:00: morning attendance digest to LINE                   │
│  17:00: daily HR summary                                    │
│  Weekly: compliance check (contract expiry, work permit)     │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│  hr-manager.js (Node.js)                                     │
│  1. Query DB (hr-query.js)                                 │
│  2. Feed Ornith for HR reasoning                            │
│  3. Parse decisions (attendance, leave, OT, compliance)      │
│  4. Execute via API or log                                  │
│  5. Send LINE alerts                                        │
│  6. Self-evaluate via hr-evaluator.js                       │
└───────────────────────┬──────────────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
   PostgreSQL       Ornith       OpenCode
    (HR data)     (reason)    (code/ps1)
```

---

## Core Skills

### Skill 1: Attendance Monitoring Agent

**Trigger**: Every 15 minutes (automated patrol), on-demand

**Responsibilities**:
- Track employee clock-in/clock-out against roster schedule
- Detect patterns: late arrival (within 15 min), late (15-60 min), absent (no clock-in), early leave
- Identify consecutive absence streaks (3+ days triggers escalation)
- Calculate actual work hours vs contracted hours
- Flag OT-eligible employees who are present

**Data Sources**:
- `hr_attendance` table: employee_id, date, clock_in, clock_out, status
- `hr_roster` table: employee_id, date, shift_start, shift_end, department
- `hr_employee` table: employee_id, hire_date, department, position, contract_type

**Decision Triggers**:
- Late arrival 3 consecutive days → WARN alert to supervisor
- Absent without leave application → HR officer notification
- Consecutive 3-day absence → Immediate supervisor + HR escalation
- Early leave without approval → Supervisor notification
- OT hours exceed 40h/month threshold → Finance + Supervisor alert

**Ornith Prompt Template**: `attendancePatrolPrompt`

---

### Skill 2: Leave Management Agent

**Trigger**: Leave application submitted, weekly patrol scan, on-demand

**Responsibilities**:
- Validate leave quota against employee contract type and tenure
- Apply Vietnam Labor Code 2019 leave entitlement rules:
  - Annual leave: 12 days base + 1 day per 5 years tenure (standard workers)
  - Sick leave: 30 days paid (with medical certificate), 15 days without
  - Unpaid leave: subject to approval based on business needs
- Assess coverage impact by department and role
- Route approval to correct supervisor level based on leave duration
- Track leave balance in real-time

**Leave Types**:
| Type (zh-CN) | Type (vi-VN) | Type Code | Max Days/Year |
|---|---|---|---|
| 年假 | Nghỉ phép năm | ANNUAL | 12-18 |
| 病假 | Nghỉ ốm | SICK | 30 |
| 无薪假 | Nghỉ không lương | UNPAID | 30 |
| 产假 | Nghỉ thai sản | MATERNITY | 120 |
| 陪产假 | Nghỉ cha | PATERNITY | 14 |
| 婚假 | Nghỉ cưới | MARRIAGE | 3 |
| 丧假 | Nghỉ tang | BEREAVEMENT | 3 |

**Decision Rules**:
- Annual leave ≤ 3 days: direct supervisor approval
- Annual leave 4-7 days: department manager + HR approval
- Annual leave > 7 days: factory director + HR approval
- Sick leave > 3 days: medical certificate required
- Unpaid leave > 5 days: HR + factory director approval

**Ornith Prompt Template**: `leaveDecisionPrompt`

---

### Skill 3: Overtime Management Agent

**Trigger**: OT request submitted, daily OT balance scan

**Responsibilities**:
- Validate OT eligibility per Vietnam labor law CU28/2020:
  - Maximum 200 hours OT per year per employee
  - Maximum 40 hours OT per month per employee
  - Maximum 4 hours OT per day
  - OT must be voluntary for workers under 18 or pregnant women
- Assess production necessity and line capacity
- Calculate OT pay correctly (weekday: 150%, weekend: 200%, holiday: 300%)
- Track cumulative OT balance to prevent overwork

**OT Rate Calculation**:
```javascript
function calculateOTPay(hours, dayType, employeeGrade) {
  const baseRate = employeeGrade.monthlySalary / 26 / 8;
  const rates = {
    WEEKDAY: 1.5,
    WEEKEND: 2.0,
    HOLIDAY: 3.0,
    ANNUAL_LEAVE: 3.0,
  };
  return hours * baseRate * rates[dayType];
}
```

**Decision Thresholds**:
- Monthly OT < 30h: auto-approve if production plan confirmed
- Monthly OT 30-40h: supervisor approval required
- Monthly OT > 40h: HR + factory director approval required
- Employee OT balance > 180h (of 200 annual limit): WARN before approving more

**Ornith Prompt Template**: `overtimeDecisionPrompt`

---

### Skill 4: Compliance Tracking Agent

**Trigger**: Weekly patrol, on-demand

**Responsibilities**:
- Track contract expiry dates (notify 60, 30, 14, 7 days before)
- Monitor work permit renewals for foreign employees
- Ensure  annual health check completion (required per Vietnam labor law)
- Track probation period completion and confirmation
- Monitor social insurance (BHXH) and unemployment insurance (BHTN) compliance
- Generate labor contract renewal reports

**Compliance Checklist**:
| Item | Trigger | Deadline |
|---|---|---|
| Contract renewal | 60 days before expiry | HR + employee |
| Work permit (foreign) | 30 days before expiry | HR + government |
| Health check | Every 12 months | HR + medical facility |
| Probation review | 3 days before probation ends | HR + supervisor |
| Social insurance | Monthly | HR + finance |

**Ornith Prompt Template**: `complianceCheckPrompt`

---

### Skill 5: Employee Onboarding Agent

**Trigger**: New employee record created in HRMS

**Responsibilities**:
- Create employee profile with all required fields
- Provision system access (MES, WMS, badge system)
- Schedule mandatory training: safety orientation, 5S, anti-ESD
- Assign work buddy/mentor from same department
- Send welcome notification in Vietnamese/Chinese
- Track onboarding completion rate

**Onboarding Checklist**:
1. Employee profile created in HRMS
2. Badge/access card issued
3. System accounts created (MES, WMS, barcode system)
4. Safety training scheduled
5. Department orientation with supervisor
6. Work buddy assigned
7. Probation KPIs set and communicated

**Ornith Prompt Template**: `onboardingPrompt`

---

### Skill 6: Training Assignment Agent

**Trigger**: Skill gap identified, new product introduction, annual training plan

**Responsibilities**:
- Identify training needs by employee based on:
  - Current skill matrix vs required skills for their position
  - Error/defect history suggesting training gaps
  - New product/process introduction
- Assign appropriate training courses
- Track completion and certification renewal dates
- Report training KPIs (completion rate, pass rate)

**Training Categories**:
- Mandatory (annual): Safety, 5S, Anti-ESD, Fire safety
- Technical (role-based): SMT programming, AOI operation, Soldering
- Leadership (management): People management, Problem-solving

**Ornith Prompt Template**: `trainingAssignPrompt`

---

## Decision Matrices

### Attendance Escalation Matrix

| Condition | Severity | Action | Notification |
|---|---|---|---|
| Late 1-2 times | INFO | Log | Employee self |
| Late 3 consecutive days | WARN | Alert supervisor | Supervisor |
| Late 3 times in 1 week | WARN | HR file | Employee + Supervisor |
| Absent 1 day with leave app | INFO | Process leave | Employee |
| Absent 1 day without notice | HIGH | Call employee + supervisor | HR officer + Supervisor |
| Absent 3 consecutive days | CRITICAL | Escalate to director | Director + HR + Supervisor |
| Early leave 1-2 times | INFO | Log | Employee self |
| Early leave 3 times in 1 week | WARN | Supervisor counseling | Supervisor + Employee |
| OT balance > 180h | WARN | WARN before more OT | Employee + HR |
| OT balance > 200h | BLOCK | Auto-reject further OT | Employee + HR |

### Leave Approval Matrix

| Leave Type | Days | Approval Level | Auto-Approve? |
|---|---|---|---|
| Annual | 1-3 | Direct Supervisor | Yes, if quota available |
| Annual | 4-7 | Dept Manager + HR | No |
| Annual | > 7 | Factory Director | No |
| Sick (certified) | 1-3 | HR notification | Yes |
| Sick (certified) | 4-30 | HR + Medical review | No |
| Unpaid | 1-3 | Direct Supervisor | No |
| Unpaid | > 3 | Dept Manager + HR | No |
| Maternity | Any | HR + Legal | Yes, with certificate |

### OT Approval Matrix

| Monthly OT Balance | Rate | Approval | Auto-Approve? |
|---|---|---|---|
| 0-30h | Standard | Direct Supervisor | Yes, with production plan |
| 30-40h | Standard | Dept Manager + HR | No |
| 40-50h | High | Factory Director | No |
| > 50h | Critical | Block | No |

---

## LINE Alert Templates (zh-CN / vi-VN)

### Attendance Alerts

**Template**: `hr.attendance.late`
```
[HR 考勤提醒] 员工 {{employee_name}} ({{employee_id}}) 今日迟到 {{minutes}} 分钟。
部门: {{department}}
时间: {{clock_in_time}}
请确认情况并反馈。
```
**vi-VN**: `[HR Nhắc nhở chấm công] Nhân viên {{employee_name}} ({{employee_id}}) đến muộn {{minutes}} phút hôm nay. Bộ phận: {{department}}. Thời gian: {{clock_in_time}}. Vui lòng xác nhận tình trạng.`

**Template**: `hr.attendance.absent_consecutive`
```
[HR 紧急] 员工 {{employee_name}} ({{employee_id}}) 已连续旷工 {{days}} 天。
部门: {{department}}
上次出勤: {{last_attendance_date}}
请立即确认员工情况。
```
**vi-VN**: `[HR Khẩn cấp] Nhân viên {{employee_name}} ({{employee_id}}) đã vắng {{days}} ngày liên tiếp. Bộ phận: {{department}}. Ngày đi làm cuối: {{last_attendance_date}}. Vui lòng xác nhận ngay tình trạng nhân viên.`

### Leave Alerts

**Template**: `hr.leave.approved`
```
[HR 请假批准] {{employee_name}} 的 {{leave_type}} 申请已批准。
期间: {{start_date}} 至 {{end_date}}
天数: {{days}} 天
审批人: {{approver}}
```
**vi-VN**: `[HR Nghỉ phép] Đơn xin nghỉ {{leave_type}} của {{employee_name}} đã được duyệt. Thời gian: {{start_date}} đến {{end_date}}. Số ngày: {{days}}. Người duyệt: {{approver}}.`

**Template**: `hr.leave.denied`
```
[HR 请假驳回] {{employee_name}} 的 {{leave_type}} 申请被驳回。
原因: {{denial_reason}}
可用余额: {{remaining_quota}} 天
如有疑问请联系HR。
```
**vi-VN**: `[HR Từ chối nghỉ phép] Đơn xin nghỉ {{leave_type}} của {{employee_name}} đã bị từ chối. Lý do: {{denial_reason}}. Số ngày còn lại: {{remaining_quota}} ngày. Vui lòng liên hệ HR nếu có thắc mắc.`

### OT Alerts

**Template**: `hr.ot.threshold_warning`
```
[HR OT预警] {{employee_name}} ({{employee_id}}) 本月OT时长已达 {{current_ot}} 小时，接近月上限40小时。
剩余可用: {{remaining}} 小时
请评估是否继续安排加班。
```
**vi-VN**: `[HR Cảnh báo OT] {{employee_name}} ({{employee_id}}) đã làm OT {{current_ot}} giờ trong tháng, tiến gần đến giới hạn 40 giờ/tháng. Còn lại: {{remaining}} giờ. Vui lòng đánh giá có nên tiếp tục sắp xếp OT không.`

### Compliance Alerts

**Template**: `hr.compliance.contract_expiry`
```
[HR 合同到期提醒] 员工 {{employee_name}} ({{employee_id}}) 劳动合同将于 {{expiry_date}} 到期。
剩余: {{days_remaining}} 天
请及时安排合同续签。
```
**vi-VN**: `[HR Nhắc nhở hết hạn hợp đồng] Hợp đồng lao động của nhân viên {{employee_name}} ({{employee_id}}) sẽ hết hạn vào {{expiry_date}}. Còn lại: {{days_remaining}} ngày. Vui lòng sắp xếp gia hạn hợp đồng.`

**Template**: `hr.compliance.health_check_due`
```
[HR 健康体检提醒] {{employee_name}} ({{employee_id}}) 年度健康体检即将到期。
到期日: {{check_due_date}}
请在到期前完成体检。
```
**vi-VN**: `[HR Nhắc nhở khám sức khỏe] Nhân viên {{employee_name}} ({{employee_id}}) sắp đến hạn khám sức khỏe định kỳ. Ngày đến hạn: {{check_due_date}}. Vui lòng hoàn thành trước hạn.`

---

## i18n Key Conventions

All LINE messages and UI text must use i18n keys, not hardcoded strings.

**Key Format**: `hr.{category}.{event}.{variant}`

Examples:
- `hr.attendance.late.zh-CN` → "员工迟到提醒"
- `hr.attendance.late.vi-VN` → "Nhắc nhở đi muộn"
- `hr.leave.approved.zh-CN` → "请假已批准"
- `hr.leave.approved.vi-VN` → "Đơn nghỉ phép đã được duyệt"
- `hr.ot.threshold_warning.zh-CN` → "加班时长预警"
- `hr.ot.threshold_warning.vi-VN` → "Cảnh báo thời gian OT"

**Translation Priority**:
1. All user-facing text: zh-CN primary, vi-VN secondary
2. System logs: zh-CN only
3. LINE messages: Both zh-CN and vi-VN in same message

---

## Error Handling

| Error | Action | Fallback |
|---|---|---|
| DB connection failed | Retry 3x with 5s backoff | Log to local file, skip cycle |
| Ornith timeout (>120s) | Abort patrol, alert HR officer | Manual review queue |
| API call failed | Retry with token refresh | Log action, skip |
| Invalid attendance data | Flag for HR officer review | Exclude from calculations |

---

## Skill Evaluation Rubric (hr-evaluator.js)

| Criterion | Weight | Description |
|---|---|---|
| attendance_accuracy | 0.30 | Was absence/lateness correctly detected? |
| leave_policy_compliance | 0.25 | Did the decision comply with Vietnam labor law? |
| ot_justification | 0.20 | Was OT genuinely needed and within legal limits? |
| compliance_timeliness | 0.15 | Were compliance reminders sent at correct intervals? |
| onboard_completeness | 0.10 | Was onboarding checklist fully completed? |

---

## Database Tables

- `hr_employees` — employee_id, name_zh, name_vi, department, position, contract_type, hire_date, status
- `hr_attendance` — attendance_id, employee_id, date, clock_in, clock_out, status, ot_hours
- `hr_leave_requests` — request_id, employee_id, leave_type, start_date, end_date, days, status, approver
- `hr_leave_balances` — employee_id, leave_type, year, total_days, used_days, balance
- `hr_ot_records` — record_id, employee_id, date, hours, ot_type, approved_by, status
- `hr_contracts` — contract_id, employee_id, contract_type, start_date, end_date, status
- `hr_training_records` — record_id, employee_id, course_id, completed_date, score, status
- `hr_compliance_log` — log_id, employee_id, item_type, due_date, completed_date, status

---

## Agent Bus Integration

HR AI Manager publishes to and subscribes from the inter-agent bus:

**Publishes**:
- `hr.attendance.alert` → When attendance anomaly detected
- `hr.leave.decision` → When leave decision made
- `hr.ot.decision` → When OT decision made
- `hr.compliance.alert` → When compliance item is due/overdue

**Subscribes**:
- `wms.issue_to_line` → Adjust workforce planning when WMS issues materials
- `mes.line_status` → Adjust OT planning when line utilization changes
- `pmc.wo_released` → Flag for new employee onboarding readiness when new WO starts
- `plant.morning_brief` → Include HR attendance summary in plant morning brief