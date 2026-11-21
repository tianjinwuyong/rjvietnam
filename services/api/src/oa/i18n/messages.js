// ============================================================
// 后端消息词库（zh / vi / en）—— 四类高频消息
// ------------------------------------------------------------
// 设计要点（见 技术方案-三语.md §3）：
//   1) **调用点零改动**：业务代码仍写 `throw new Error('中文…')` / `bizError('中文…')`，
//      出口在 server.js 的 onSend 钩子里按 `X-OA-Lang` 单点翻译 `msg` 字段。
//   2) **反查而非正查**：索引由 `zh` 文本反查 key（见 i18n/lang.js），因为调用点传的是中文。
//   3) **zh 唯一**：同一 zh 只能出现一次，重复会让反查产生歧义 —— 由 lang.js 在加载时抛错，
//      并由 server/scripts/verify-messages.mjs 在 CI 中拦截。
//   4) **未命中回退中文**：绝不返回 key、绝不返回空串；`lang=zh` 时零查表直接原样返回。
//   5) 本文件**不含**任何调用点逻辑，只放数据。
//
// 覆盖范围（72 键）：auth.* 登录鉴权 / common.* 通用错误 / flow.* 审批流转 / import.* 导入校验。
// 长尾（含动态插值的消息）显式接受中文兜底 —— 见 §3.3「已知覆盖上限」。
// ============================================================

/**
 * @typedef {{ zh: string, vi: string, en: string }} MsgEntry
 */

/** 消息键 → 三语文本。`zh` 必须与源码中真实出现的中文字面量**逐字一致**。 */
export const MESSAGES = {
  // ---------------- auth.*：登录 / 鉴权 ----------------
  'auth.badCredentials': {
    zh: '用户名或密码错误',
    vi: 'Tên đăng nhập hoặc mật khẩu không đúng',
    en: 'Incorrect username or password',
  },
  'auth.accountDisabled': {
    zh: '账号已停用',
    vi: 'Tài khoản đã bị vô hiệu hóa',
    en: 'This account is disabled',
  },
  'auth.sessionExpired': {
    zh: '登录已失效，请重新登录',
    vi: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại',
    en: 'Your session has expired. Please sign in again',
  },
  'auth.noPermission': {
    zh: '没有该操作的权限',
    vi: 'Bạn không có quyền thực hiện thao tác này',
    en: 'You do not have permission for this action',
  },
  'auth.oldPasswordWrong': {
    zh: '原密码不正确',
    vi: 'Mật khẩu hiện tại không đúng',
    en: 'Current password is incorrect',
  },
  'auth.credentialsMissing': {
    zh: '请输入用户名和密码',
    vi: 'Vui lòng nhập tên đăng nhập và mật khẩu',
    en: 'Please enter your username and password',
  },
  'auth.feishuDisabled': {
    zh: '飞书登录未启用',
    vi: 'Đăng nhập bằng Feishu chưa được bật',
    en: 'Feishu sign-in is not enabled',
  },
  'auth.feishuCodeMissing': {
    zh: '缺少授权码',
    vi: 'Thiếu mã ủy quyền',
    en: 'Authorization code is missing',
  },
  'auth.langUnsupported': {
    zh: '不支持的语言',
    vi: 'Ngôn ngữ không được hỗ trợ',
    en: 'Unsupported language',
  },
  'auth.feishuNoOpenId': {
    zh: '未获取到飞书用户标识',
    vi: 'Không lấy được định danh người dùng Feishu',
    en: 'Could not retrieve the Feishu user identifier',
  },
  'auth.feishuUserMissing': {
    zh: '该飞书账号未在 OA 中建立用户，请联系管理员',
    vi: 'Tài khoản Feishu này chưa có người dùng trong OA, vui lòng liên hệ quản trị viên',
    en: 'This Feishu account has no OA user yet. Please contact the administrator',
  },
  'auth.withdrawNotReady': {
    zh: '撤回能力尚未就绪，请联系管理员',
    vi: 'Chức năng thu hồi chưa sẵn sàng, vui lòng liên hệ quản trị viên',
    en: 'Withdrawal is not available yet. Please contact the administrator',
  },

  // ---------------- common.*：通用错误 ----------------
  'common.badRequestParam': {
    zh: '请求参数格式不正确',
    vi: 'Định dạng tham số yêu cầu không hợp lệ',
    en: 'Invalid request parameter format',
  },
  'common.duplicateSubmit': {
    zh: '数据已存在，请勿重复提交',
    vi: 'Dữ liệu đã tồn tại, vui lòng không gửi trùng',
    en: 'This record already exists; please do not submit it twice',
  },
  'common.relatedMissing': {
    zh: '关联数据不存在',
    vi: 'Dữ liệu liên quan không tồn tại',
    en: 'The related record does not exist',
  },
  'common.requiredMissing': {
    zh: '缺少必填字段',
    vi: 'Thiếu trường bắt buộc',
    en: 'A required field is missing',
  },
  'common.serverError': {
    zh: '服务器内部错误',
    vi: 'Lỗi máy chủ nội bộ',
    en: 'Internal server error',
  },
  'common.operationFailed': {
    zh: '操作失败',
    vi: 'Thao tác thất bại',
    en: 'Operation failed',
  },
  'common.paramIncomplete': {
    zh: '参数不完整',
    vi: 'Tham số chưa đầy đủ',
    en: 'Incomplete parameters',
  },
  'common.paramIncorrect': {
    zh: '参数不正确',
    vi: 'Tham số không đúng',
    en: 'Incorrect parameters',
  },
  'common.unknownType': {
    zh: '未知类型',
    vi: 'Loại không xác định',
    en: 'Unknown type',
  },
  'common.dateRangeInvalid': {
    zh: '起始日期不能晚于结束日期',
    vi: 'Ngày bắt đầu không được sau ngày kết thúc',
    en: 'The start date cannot be later than the end date',
  },
  'common.dateRangeRequired': {
    zh: '请提供有效的起止日期（from/to，YYYY-MM-DD）',
    vi: 'Vui lòng cung cấp khoảng ngày hợp lệ (from/to, YYYY-MM-DD)',
    en: 'Please provide a valid date range (from/to, YYYY-MM-DD)',
  },
  'common.dateInvalid': {
    zh: '日期无效（YYYY-MM-DD）',
    vi: 'Ngày không hợp lệ (YYYY-MM-DD)',
    en: 'Invalid date (YYYY-MM-DD)',
  },
  'common.importFormatInvalid': {
    zh: '导入数据格式不正确',
    vi: 'Định dạng dữ liệu nhập không hợp lệ',
    en: 'The imported data format is invalid',
  },
  'common.recordSubmittedLocked': {
    zh: '记录已提交，不可修改',
    vi: 'Bản ghi đã gửi, không thể sửa',
    en: 'The record has been submitted and cannot be changed',
  },
  'common.stateChanged': {
    zh: '任务状态已变更，请刷新重试',
    vi: 'Trạng thái tác vụ đã thay đổi, vui lòng làm mới và thử lại',
    en: 'The task status has changed. Please refresh and try again',
  },
  'common.ownerOrAdminOnly': {
    zh: '仅本人或管理员可修改该记录',
    vi: 'Chỉ người tạo hoặc quản trị viên mới được sửa bản ghi này',
    en: 'Only the owner or an administrator can change this record',
  },
  'common.pathInvalid': {
    zh: '非法的文件路径',
    vi: 'Đường dẫn tệp không hợp lệ',
    en: 'Invalid file path',
  },
  'common.pathTooLong': {
    zh: '路径过长，请减少文件夹层级或缩短名称',
    vi: 'Đường dẫn quá dài, vui lòng giảm số cấp thư mục hoặc rút ngắn tên',
    en: 'The path is too long; reduce the folder depth or shorten the name',
  },
  'common.fileInfoMissing': {
    zh: '缺少文件信息',
    vi: 'Thiếu thông tin tệp',
    en: 'File information is missing',
  },
  'common.newVersionFileRequired': {
    zh: '请上传新版本文件',
    vi: 'Vui lòng tải lên tệp phiên bản mới',
    en: 'Please upload the new version file',
  },

  // ---------------- flow.*：审批流转 ----------------
  'flow.formNotFound': {
    zh: '单据不存在',
    vi: 'Phiếu không tồn tại',
    en: 'The form does not exist',
  },
  'flow.formNotFoundOrNoPermission': {
    zh: '单据不存在或无权操作',
    vi: 'Phiếu không tồn tại hoặc bạn không có quyền thao tác',
    en: 'The form does not exist, or you are not allowed to act on it',
  },
  'flow.formArchivedLocked': {
    zh: '单据已归档锁定，不可变更',
    vi: 'Phiếu đã được lưu trữ và khóa, không thể thay đổi',
    en: 'The form is archived and locked; it cannot be changed',
  },
  'flow.formArchivedLockedNoEdit': {
    zh: '单据已归档锁定，不可修改',
    vi: 'Phiếu đã được lưu trữ và khóa, không thể sửa',
    en: 'The form is archived and locked; it cannot be edited',
  },
  'flow.formAlreadySubmitted': {
    zh: '单据已提交，无法重复提交',
    vi: 'Phiếu đã được gửi, không thể gửi lại',
    en: 'The form has already been submitted and cannot be submitted again',
  },
  'flow.taskNotFoundOrNoPermission': {
    zh: '任务不存在或无权处理',
    vi: 'Tác vụ không tồn tại hoặc bạn không có quyền xử lý',
    en: 'The task does not exist, or you are not allowed to handle it',
  },
  'flow.taskAlreadyHandled': {
    zh: '该任务已处理过',
    vi: 'Tác vụ này đã được xử lý',
    en: 'This task has already been handled',
  },
  'flow.taskStale': {
    zh: '该任务已失效（流程已流转），请刷新后处理当前节点',
    vi: 'Tác vụ này không còn hiệu lực (luồng đã chuyển), vui lòng làm mới và xử lý bước hiện tại',
    en: 'This task is no longer valid (the flow has moved on). Please refresh and handle the current step',
  },
  'flow.executionReplyRequired': {
    zh: '执行节点必须填写执行回复',
    vi: 'Bước thực hiện bắt buộc phải điền phản hồi thực hiện',
    en: 'Execution steps require an execution reply',
  },
  'flow.notInApproval': {
    zh: '流程不在审批中',
    vi: 'Luồng không ở trạng thái đang duyệt',
    en: 'The flow is not in approval',
  },
  'flow.noTodoNode': {
    zh: '当前无待办节点',
    vi: 'Hiện không có bước nào đang chờ xử lý',
    en: 'There is no pending step right now',
  },
  'flow.countersignNotAllowed': {
    zh: '该节点不允许临时加签',
    vi: 'Bước này không cho phép ký bổ sung tạm thời',
    en: 'Ad-hoc countersign is not allowed at this step',
  },
  'flow.countersignNoPermission': {
    zh: '无权为该单据临时加签',
    vi: 'Bạn không có quyền ký bổ sung tạm thời cho phiếu này',
    en: 'You are not allowed to countersign this form',
  },
  'flow.countersignDuplicate': {
    zh: '该人员已在当前节点待办中',
    vi: 'Người này đã có trong danh sách chờ xử lý của bước hiện tại',
    en: 'This person already has a pending task at the current step',
  },
  'flow.definitionNotFound': {
    zh: '流程类型不存在',
    vi: 'Loại luồng không tồn tại',
    en: 'The flow type does not exist',
  },
  'flow.definitionNotFoundOrDisabled': {
    zh: '流程类型不存在或已停用',
    vi: 'Loại luồng không tồn tại hoặc đã bị vô hiệu hóa',
    en: 'The flow type does not exist or is disabled',
  },
  'flow.returnOnlyRunning': {
    zh: '仅审批中的单据可退回',
    vi: 'Chỉ phiếu đang duyệt mới có thể trả lại',
    en: 'Only forms in approval can be sent back',
  },
  'flow.returnNoPermission': {
    zh: '无权退回该单据',
    vi: 'Bạn không có quyền trả lại phiếu này',
    en: 'You are not allowed to send this form back',
  },
  'flow.transferTaskNotFound': {
    zh: '任务不存在或无权转交',
    vi: 'Tác vụ không tồn tại hoặc bạn không có quyền chuyển giao',
    en: 'The task does not exist, or you are not allowed to transfer it',
  },
  'flow.transferAlreadyHandled': {
    zh: '该任务已处理，无法转交',
    vi: 'Tác vụ đã được xử lý, không thể chuyển giao',
    en: 'The task has been handled and cannot be transferred',
  },
  'flow.transferToSelf': {
    zh: '不能转交给自己',
    vi: 'Không thể chuyển giao cho chính mình',
    en: 'You cannot transfer a task to yourself',
  },
  'flow.transferTargetMissing': {
    zh: '转交对象不存在',
    vi: 'Người nhận chuyển giao không tồn tại',
    en: 'The transfer target does not exist',
  },
  'flow.closureRequired': {
    zh: '需完成执行回复与验证后方可归档',
    vi: 'Phải hoàn tất phản hồi thực hiện và xác minh trước khi lưu trữ',
    en: 'The execution reply and verification must be completed before archiving',
  },
  'flow.obsoleteInFlight': {
    zh: '该文件已有在途废除申请',
    vi: 'Tệp này đã có đơn bãi bỏ đang xử lý',
    en: 'This document already has a pending obsolete request',
  },
  'flow.urgeNoPermission': {
    zh: '无权催办该单据',
    vi: 'Bạn không có quyền nhắc phiếu này',
    en: 'You are not allowed to remind anyone about this form',
  },
  'flow.urgeOnlyRunning': {
    zh: '仅审批中的单据可催办',
    vi: 'Chỉ phiếu đang duyệt mới có thể nhắc',
    en: 'Only forms in approval can be reminded',
  },
  'flow.terminateStateInvalid': {
    zh: '当前状态不可终止',
    vi: 'Trạng thái hiện tại không thể kết thúc',
    en: 'The current status cannot be terminated',
  },
  'flow.assignApproverRequired': {
    zh: '请指定审批人',
    vi: 'Vui lòng chỉ định người duyệt',
    en: 'Please specify an approver',
  },
  'flow.punchSubjectMissing': {
    zh: '被签卡人不存在或已停用',
    vi: 'Người được chấm công bù không tồn tại hoặc đã bị vô hiệu hóa',
    en: 'The person being corrected does not exist or is disabled',
  },
  'flow.terminateAdminOnly': {
    zh: '仅管理员或发起人可终止流程',
    vi: 'Chỉ quản trị viên hoặc người khởi tạo mới được kết thúc luồng',
    en: 'Only an administrator or the initiator can terminate the flow',
  },
  'flow.archiveAdminOnly': {
    zh: '仅管理员或发起人可归档',
    vi: 'Chỉ quản trị viên hoặc người khởi tạo mới được lưu trữ',
    en: 'Only an administrator or the initiator can archive',
  },
  'flow.archiveOnlyCompleted': {
    zh: '仅办理完成的单据可归档',
    vi: 'Chỉ phiếu đã hoàn tất mới có thể lưu trữ',
    en: 'Only completed forms can be archived',
  },
  'flow.noPermissionToAct': {
    zh: '无权操作',
    vi: 'Không có quyền thao tác',
    en: 'You are not allowed to perform this action',
  },
  'flow.attachmentArchivedLocked': {
    zh: '单据已归档锁定，不可新增附件',
    vi: 'Phiếu đã lưu trữ và khóa, không thể thêm tệp đính kèm',
    en: 'The form is archived and locked; no new attachments can be added',
  },
  'flow.attachmentNoPermission': {
    zh: '无权为该单据添加附件',
    vi: 'Bạn không có quyền thêm tệp đính kèm cho phiếu này',
    en: 'You are not allowed to add attachments to this form',
  },
  'flow.assignedApproverMissing': {
    zh: '指定的审批人不存在或已停用',
    vi: 'Người duyệt được chỉ định không tồn tại hoặc đã bị vô hiệu hóa',
    en: 'The specified approver does not exist or is disabled',
  },

  // ---------------- import.*：导入校验 ----------------
  'import.noEmployeeParsed': {
    zh: '未解析到任何员工',
    vi: 'Không phân tích được nhân viên nào',
    en: 'No employees were parsed',
  },
  'import.noQuestionsToImport': {
    zh: '没有可导入的题目',
    vi: 'Không có câu hỏi nào để nhập',
    en: 'There are no questions to import',
  },
  'import.planNoMembers': {
    zh: '该培训计划还没有参训员工，请先导入名单',
    vi: 'Kế hoạch đào tạo này chưa có học viên, vui lòng nhập danh sách trước',
    en: 'This training plan has no trainees yet; import the roster first',
  },
  'import.planNeedMembers': {
    zh: '请先为计划导入参训员工',
    vi: 'Vui lòng nhập học viên cho kế hoạch trước',
    en: 'Import trainees into the plan first',
  },
  'import.positionRequired': {
    zh: '请选择岗位（岗位是流程指派与培训导入的依据，必填）',
    vi: 'Vui lòng chọn vị trí (vị trí là căn cứ để chỉ định luồng và nhập đào tạo, bắt buộc)',
    en: 'Please select a position (used for flow assignment and training import; required)',
  },
  'import.templateCodeAndNameRequired': {
    zh: '请填写模板编号与名称',
    vi: 'Vui lòng điền mã và tên mẫu',
    en: 'Please enter the template number and name',
  },
  'import.nameRequired': {
    zh: '请填写名称',
    vi: 'Vui lòng điền tên',
    en: 'Please enter a name',
  },
  'import.equipmentRequired': {
    zh: '请选择设备',
    vi: 'Vui lòng chọn thiết bị',
    en: 'Please select equipment',
  },
  'import.employeeRequired': {
    zh: '员工必填',
    vi: 'Nhân viên là bắt buộc',
    en: 'Employee is required',
  },
  'import.employeeMissing': {
    zh: '员工不存在',
    vi: 'Nhân viên không tồn tại',
    en: 'The employee does not exist',
  },
  'import.assetNoRequired': {
    zh: '资产编号必填',
    vi: 'Mã tài sản là bắt buộc',
    en: 'Asset number is required',
  },
  'import.reviewersRequired': {
    zh: '请选择评审人员',
    vi: 'Vui lòng chọn người đánh giá',
    en: 'Please select the reviewers',
  },
  'import.jobClassRequired': {
    zh: '请选择职类',
    vi: 'Vui lòng chọn ngạch công việc',
    en: 'Please select a job category',
  },
  'import.inspectionTemplateMissing': {
    zh: '点检模板不存在',
    vi: 'Mẫu kiểm tra thiết bị không tồn tại',
    en: 'The inspection template does not exist',
  },
  'import.patrolTemplateMissing': {
    zh: '巡线模板不存在',
    vi: 'Mẫu tuần tra không tồn tại',
    en: 'The line patrol template does not exist',
  },
  'import.faiTemplateMissing': {
    zh: '首件模板不存在',
    vi: 'Mẫu kiểm tra đầu tiên không tồn tại',
    en: 'The FAI template does not exist',
  },
  'import.nameColumnRequired': {
    zh: '姓名必填',
    vi: 'Họ tên là bắt buộc',
    en: 'Name is required',
  },
  'import.sameNameAmbiguous': {
    zh: '疑似同名不同人，请补工号',
    vi: 'Nghi ngờ trùng tên khác người, vui lòng bổ sung mã nhân viên',
    en: 'Possibly two people with the same name; please provide the employee number',
  },
  'import.employeeListInvalid': {
    zh: '员工列表为空或格式不正确',
    vi: 'Danh sách nhân viên trống hoặc sai định dạng',
    en: 'The employee list is empty or has an invalid format',
  },
  'import.noActiveEmployeeInSection': {
    zh: '所选工段下没有在职员工',
    vi: 'Không có nhân viên đang làm việc trong công đoạn đã chọn',
    en: 'No active employees in the selected section',
  },
  'import.examMissing': {
    zh: '考试不存在',
    vi: 'Bài thi không tồn tại',
    en: 'The exam does not exist',
  },
  'import.examNotPublished': {
    zh: '考试尚未发布',
    vi: 'Bài thi chưa được phát hành',
    en: 'The exam has not been published yet',
  },
  'import.planMissing': {
    zh: '培训计划不存在',
    vi: 'Kế hoạch đào tạo không tồn tại',
    en: 'The training plan does not exist',
  },
  'import.answerSheetMissing': {
    zh: '答卷不存在',
    vi: 'Bài làm không tồn tại',
    en: 'The answer sheet does not exist',
  },
  'import.questionMissing': {
    zh: '题目不存在',
    vi: 'Câu hỏi không tồn tại',
    en: 'The question does not exist',
  },
  'import.trainingRecordMissing': {
    zh: '培训记录不存在',
    vi: 'Bản ghi đào tạo không tồn tại',
    en: 'The training record does not exist',
  },
  'import.examTitleRequired': {
    zh: '请填写考试名称',
    vi: 'Vui lòng điền tên bài thi',
    en: 'Please enter the exam name',
  },
  'import.planTitleRequired': {
    zh: '请填写计划名称',
    vi: 'Vui lòng điền tên kế hoạch',
    en: 'Please enter the plan name',
  },
  'import.planSelectRequired': {
    zh: '请选择培训计划',
    vi: 'Vui lòng chọn kế hoạch đào tạo',
    en: 'Please select a training plan',
  },
  'import.questionStemRequired': {
    zh: '请填写题干',
    vi: 'Vui lòng điền nội dung câu hỏi',
    en: 'Please enter the question text',
  },
  'import.optionsTooFew': {
    zh: '至少需要两个选项',
    vi: 'Cần ít nhất hai lựa chọn',
    en: 'At least two options are required',
  },
  'import.answerRequired': {
    zh: '请填写正确答案',
    vi: 'Vui lòng điền đáp án đúng',
    en: 'Please enter the correct answer',
  },
  'import.answerOutOfOptions': {
    zh: '正确答案必须落在选项内',
    vi: 'Đáp án đúng phải nằm trong các lựa chọn',
    en: 'The correct answer must be one of the options',
  },
  'import.singleAnswerOnly': {
    zh: '单选/判断题只能有一个答案',
    vi: 'Câu một đáp án / đúng-sai chỉ được có một đáp án',
    en: 'Single-choice and true/false questions accept only one answer',
  },
  'import.addQuestionsFirst': {
    zh: '请先添加题目再发布',
    vi: 'Vui lòng thêm câu hỏi trước khi phát hành',
    en: 'Add questions before publishing',
  },
  'import.batchTooLarge': {
    zh: '单次批量超过 2000 人，请缩小范围',
    vi: 'Một lần vượt quá 2000 người, vui lòng thu hẹp phạm vi',
    en: 'A single batch exceeds 2000 people; please narrow the scope',
  },
  'import.accountingNeedsEmpOrDate': {
    zh: '记账缺少员工或日期',
    vi: 'Bút toán thiếu nhân viên hoặc ngày',
    en: 'The entry is missing an employee or a date',
  },

  // ---------------- qc.*：品质管理（IQC 检验 / MRB 评审） ----------------
  'qc.lotNoRequired': {
    zh: 'payload.lot.lotNo 必填',
    vi: 'payload.lot.lotNo là bắt buộc',
    en: 'payload.lot.lotNo is required',
  },
  'qc.lotNotFound': {
    zh: '待检批次不存在',
    vi: 'Lô chờ kiểm không tồn tại',
    en: 'Inspection lot not found',
  },
  'qc.templateNotFound': {
    zh: '所选检验模板不存在或已停用',
    vi: 'Mẫu kiểm đã chọn không tồn tại hoặc đã ngưng dùng',
    en: 'Selected template does not exist or is inactive',
  },
  'qc.suspendedOpen': {
    zh: '该物料检验已暂停（严格度 suspended），不能开检验单。请品质主管确认供应方改进后恢复加严检验。',
    vi: 'Kiểm tra vật tư này đã tạm dừng (mức suspended), không thể mở phiếu kiểm. Vui lòng để trưởng bộ phận chất lượng xác nhận nhà cung cấp đã cải tiến rồi chuyển lại kiểm tra chặt.',
    en: 'Inspection for this material is suspended, so the inspection sheet cannot be opened. Ask the QA supervisor to confirm supplier improvement before resuming tightened inspection.',
  },
  'qc.suspendedClaim': {
    zh: '该物料检验已暂停（严格度 suspended），不能认领。请品质主管确认后恢复。',
    vi: 'Kiểm tra vật tư này đã tạm dừng (mức suspended), không thể nhận. Vui lòng để trưởng bộ phận chất lượng xác nhận rồi phục hồi.',
    en: 'Inspection for this material is suspended and cannot be claimed. Ask the QA supervisor to confirm and resume.',
  },
  'qc.claimedByOther': {
    zh: '该批次已被他人认领（4 小时后自动释放）',
    vi: 'Lô này đã được người khác nhận (tự động nhả sau 4 giờ)',
    en: 'This lot has been claimed by someone else (auto-released after 4 hours)',
  },
  'qc.releaseOwnOnly': {
    zh: '只能释放自己认领的批次',
    vi: 'Chỉ được nhả lô do bạn nhận',
    en: 'You can only release a lot you claimed',
  },
  'qc.lotCompleted': {
    zh: '该批次已完成，不能再修改检验记录',
    vi: 'Lô đã hoàn tất, không thể sửa phiếu kiểm',
    en: 'This lot is completed; the inspection record can no longer be modified',
  },
  'qc.recordSubmitted': {
    zh: '该记录已提交审批，不能直接修改',
    vi: 'Phiếu đã gửi duyệt, không thể sửa trực tiếp',
    en: 'This record has been submitted for approval and cannot be edited directly',
  },
  'qc.recordNotFound': {
    zh: '检验记录不存在',
    vi: 'Phiếu kiểm không tồn tại',
    en: 'Inspection record not found',
  },
  'qc.recordApproved': {
    zh: '该记录已审批完成',
    vi: 'Phiếu đã duyệt xong',
    en: 'This record has already been approved',
  },
  'qc.recordPosted': {
    zh: '该记录已落账，不能重复提交',
    vi: 'Phiếu đã ghi ngược WMS, không thể gửi lại',
    en: 'This record is already posted to WMS and cannot be resubmitted',
  },
  'qc.suspendedSubmit': {
    zh: '该物料检验已暂停，不能提交检验。请品质主管确认供应方改进后恢复加严检验。',
    vi: 'Kiểm tra vật tư này đã tạm dừng, không thể gửi phiếu. Vui lòng để trưởng bộ phận chất lượng xác nhận nhà cung cấp đã cải tiến rồi phục hồi kiểm tra chặt.',
    en: 'Inspection for this material is suspended and the sheet cannot be submitted. Ask the QA supervisor to confirm supplier improvement before resuming tightened inspection.',
  },
  'qc.emptyRecord': {
    zh: '检验记录为空，不能提交。若该批次确实无需检验小项，请由 IQC 主管使用「人工判定」并填写原因',
    vi: 'Phiếu kiểm trống, không thể gửi. Nếu lô thực sự không cần hạng mục kiểm, trưởng IQC dùng «đánh giá thủ công» và ghi lý do',
    en: 'The inspection record is empty and cannot be submitted. If this lot truly needs no items, the IQC supervisor should use manual judgement and state the reason',
  },
  'qc.lotInspected': {
    zh: '该批次已完成检验，不可重复提交',
    vi: 'Lô đã kiểm xong, không thể gửi lại',
    en: 'This lot has already been inspected and cannot be resubmitted',
  },
  'qc.flowNotConfigured': {
    zh: '未找到 IQC 审批流程定义（oa_iqc_report / wms_iqc_report）',
    vi: 'Không tìm thấy định nghĩa quy trình duyệt IQC (oa_iqc_report / wms_iqc_report)',
    en: 'No IQC approval flow definition found (oa_iqc_report / wms_iqc_report)',
  },
  'qc.notSubmitted': {
    zh: '该记录尚未提交，不能回填',
    vi: 'Phiếu chưa được gửi duyệt, không thể ghi ngược',
    en: 'This record has not been submitted yet and cannot be posted back',
  },
  'qc.notApproved': {
    zh: '审批尚未通过，不能落账（落账只允许由审批终态触发）',
    vi: 'Chưa duyệt xong, không thể ghi ngược (chỉ ghi khi quy trình ở trạng thái cuối)',
    en: 'Approval is not complete; posting is only allowed from a terminal approval state',
  },
  'qc.selfApprove': {
    zh: '检验人不能自行批准自己填写的报告',
    vi: 'Người kiểm không được tự duyệt phiếu do mình lập',
    en: 'An inspector cannot approve their own report',
  },
  'qc.mrbNoRequired': {
    zh: 'payload.mrb.mrbNo 必填',
    vi: 'payload.mrb.mrbNo là bắt buộc',
    en: 'payload.mrb.mrbNo is required',
  },
  'qc.mrbFlowNotConfigured': {
    zh: '未找到 MRB 评审流程定义（mrb_review / wms_mrb）',
    vi: 'Không tìm thấy định nghĩa quy trình thẩm định MRB (mrb_review / wms_mrb)',
    en: 'No MRB review flow definition found (mrb_review / wms_mrb)',
  },
  'qc.mrbNotFound': {
    zh: 'MRB 不存在',
    vi: 'MRB không tồn tại',
    en: 'MRB not found',
  },
  'qc.mrbNoReview': {
    zh: '该 MRB 尚未发起 OA 评审，不能直接回填；请联系管理员或先在流程中完成评审',
    vi: 'MRB này chưa khởi tạo thẩm định trên OA, không thể ghi ngược trực tiếp; hãy liên hệ quản trị viên hoặc hoàn tất thẩm định trong quy trình',
    en: 'This MRB has no OA review started, so it cannot be posted back directly; contact an administrator or complete the review in the flow',
  },
  'qc.mrbNotApproved': {
    zh: 'OA 评审尚未通过，不能回填 WMS（请在评审流程中完成审批，系统会自动回填）',
    vi: 'Thẩm định OA chưa duyệt xong, không thể ghi ngược WMS (hãy duyệt trong quy trình, hệ thống sẽ tự ghi)',
    en: 'The OA review is not approved yet, so it cannot be posted to WMS (approve in the flow and the system posts automatically)',
  },
  'qc.rejectReasonRequired': {
    zh: '否决必须填写原因',
    vi: 'Từ chối phải ghi lý do',
    en: 'A reason is required when rejecting',
  },
  'qc.approvalInProgress': {
    zh: '审批进行中，无需重复提交',
    vi: 'Đang duyệt, không cần gửi lại',
    en: 'Approval is in progress; no need to resubmit',
  },
  'qc.mrbAlreadyPosted': {
    zh: '该单已回填 WMS，无需再评审',
    vi: 'Phiếu đã ghi ngược WMS, không cần thẩm định lại',
    en: 'This MRB is already posted to WMS; no further review needed',
  },

  // ---------------- qc.*：模板库 / 通用参数校验 ----------------
  'qc.invalidParam': {
    zh: '参数不合法',
    vi: 'Tham số không hợp lệ',
    en: 'Invalid parameters',
  },
  'qc.tplNameRequired': {
    zh: '模板名称不能为空',
    vi: 'Tên mẫu không được để trống',
    en: 'Template name is required',
  },
  'qc.tplNameTooLong': {
    zh: '模板名称超长（≤200）',
    vi: 'Tên mẫu quá dài (≤200)',
    en: 'Template name is too long (max 200)',
  },
  'qc.tplNotExists': {
    zh: '模板不存在',
    vi: 'Mẫu kiểm không tồn tại',
    en: 'Template not found',
  },
  'qc.invalidSection': {
    zh: '检验工段不合法',
    vi: 'Công đoạn kiểm không hợp lệ',
    en: 'Invalid inspection section',
  },
  'qc.stdItemNotExists': {
    zh: '标准项目不存在',
    vi: 'Hạng mục tiêu chuẩn không tồn tại',
    en: 'Standard item not found',
  },
  'qc.invalidLibraryScope': {
    zh: '库归属只能是 iqc 或 oqc',
    vi: 'Thư viện chỉ có thể là iqc hoặc oqc',
    en: 'Library scope must be iqc or oqc',
  },
  'qc.invalidStatus': {
    zh: '状态只能是 active 或 inactive',
    vi: 'Trạng thái chỉ có thể là active hoặc inactive',
    en: 'Status must be active or inactive',
  },
  'qc.itemsMustBeArray': {
    zh: 'items 必须是数组',
    vi: 'items phải là một mảng',
    en: 'items must be an array',
  },
  'qc.materialCodesMustBeArray': {
    zh: 'materialCodes 必须是数组',
    vi: 'materialCodes phải là một mảng',
    en: 'materialCodes must be an array',
  },
  // ---------------- onboarding.*：员工入职（2026-10-24 补） ----------------
  'onboarding.cancelledCannotConfirm': {
    zh: '该登记已作废，不能确认入职',
    vi: 'Bản ghi này đã bị hủy, không thể xác nhận vào làm',
    en: 'This record has been cancelled and cannot be confirmed',
  },
  'onboarding.alreadyActive': {
    zh: '该员工已入职建号，请到「组织与人员」停用账号，而不是作废登记',
    vi: 'Nhân viên đã vào làm và đã có tài khoản; hãy vô hiệu hóa tài khoản trong «Tổ chức & Nhân sự» thay vì hủy bản ghi',
    en: 'The employee is already onboarded with an account; disable the account under Organization & Staff instead of cancelling the record',
  },
};

/**
 * 通知文案前缀规则（`notify()` 落库前按收件人语言替换）。
 * ------------------------------------------------------------
 * 通知标题绝大多数是模板串（`【待处理】${inst.title}`），无法整句反查，
 * 因此对**固定前缀**做映射：只替换开头的方括号/分隔片，正文顺序不变。
 * 未命中的前缀原样保留 ⇒ 最坏情况仍是中文前缀 + 业务数据，不会出现裸键。
 */
export const NOTIFY_PREFIXES = [
  { zh: '【待处理】', vi: '[Cần xử lý] ', en: '[To Handle] ' },
  { zh: '【抄送】', vi: '[Để biết] ', en: '[CC] ' },
  { zh: '【转交待办】', vi: '[Chuyển giao] ', en: '[Transferred] ' },
  { zh: '【超时催办】', vi: '[Nhắc quá hạn] ', en: '[Overdue reminder] ' },
  { zh: '【设备停用】', vi: '[Thiết bị ngưng dùng] ', en: '[Equipment disabled] ' },
  { zh: '【维修单创建失败】', vi: '[Tạo phiếu sửa chữa thất bại] ', en: '[Repair order failed] ' },
  { zh: '【纪要待填】', vi: '[Chờ điền biên bản] ', en: '[Minutes due] ' },
  { zh: '【纪要已发布】', vi: '[Biên bản đã phát hành] ', en: '[Minutes published] ' },
  { zh: '【点检任务】', vi: '[Tác vụ kiểm tra] ', en: '[Inspection task] ' },
  { zh: '【流程挂起】', vi: '[Luồng bị treo] ', en: '[Flow suspended] ' },
  { zh: '【文件评审】', vi: '[Đánh giá tài liệu] ', en: '[Document review] ' },
  { zh: '待办：', vi: 'Cần xử lý: ', en: 'To handle: ' },
  { zh: '已完成：', vi: 'Đã hoàn thành: ', en: 'Completed: ' },
  { zh: '待考试：', vi: 'Chờ thi: ', en: 'Exam pending: ' },
];

/**
 * **模板正则**：用于带插值的消息（无法逐字反查），如导入校验里的 `第 3 行：…`。
 * ------------------------------------------------------------
 * 规则：
 *   1) `re` **必须锚定** `^…$`，避免误伤（verify-messages.mjs 会校验这一点）；
 *   2) `{n}` 占位符按捕获组顺序替换；
 *   3) `nested: [i]` 表示第 i 个捕获组本身也是中文消息，需**递归翻译**；
 *      递归失败（子串无译文）时整条放弃，返回原中文 —— 宁可不译，也不中英混排；
 *   4) `sample` 是真实形态样例，CI 用它验证「正则确实能匹配、且译文与原文不同」。
 * 模板均取自 `server/src` 的真实模板串（`grep` 得到），未凭空假设。
 */
export const MESSAGE_PATTERNS = [
  {
    key: 'import.rowLimit',
    re: /^单次最多导入\s*(\d+)\s*行（本次\s*(\d+)\s*行），请分批导入$/u,
    sample: '单次最多导入 500 行（本次 620 行），请分批导入',
    vi: 'Mỗi lần chỉ nhập tối đa {1} dòng (lần này {2} dòng), vui lòng chia nhỏ tệp',
    en: 'You can import at most {1} rows at a time ({2} rows this time); please split the file',
  },
  {
    key: 'import.rowPrefix',
    re: /^第\s*(\d+)\s*行[：:]\s*(.+)$/u,
    sample: '第 3 行：比例应在 0~100',
    nested: [2],
    vi: 'Dòng {1}: {2}',
    en: 'Row {1}: {2}',
  },
  {
    key: 'import.rowCodeNameRequired',
    re: /^code\/name 必填$/u,
    sample: 'code/name 必填',
    vi: 'code và name là bắt buộc',
    en: 'code and name are required',
  },
  {
    key: 'import.rowSeqDuplicated',
    re: /^seq\s*(\S+)\s*重复$/u,
    sample: 'seq 12 重复',
    vi: 'seq {1} bị trùng',
    en: 'seq {1} is duplicated',
  },
  {
    key: 'import.rowCategoryInvalid',
    re: /^category 非法（(.+)）$/u,
    sample: 'category 非法（bonus）',
    vi: 'category không hợp lệ ({1})',
    en: 'invalid category ({1})',
  },
  {
    key: 'import.rowCalcModeUnsupported',
    re: /^(.+) 不支持 calc_mode=(\S+)$/u,
    sample: 'deduction 不支持 calc_mode=percent',
    vi: '{1} không hỗ trợ calc_mode={2}',
    en: '{1} does not support calc_mode={2}',
  },
  {
    key: 'import.rowRatioOutOfRange',
    re: /^比例应在 0~100$/u,
    sample: '比例应在 0~100',
    vi: 'tỷ lệ phải nằm trong khoảng 0~100',
    en: 'the ratio must be between 0 and 100',
  },
  {
    key: 'import.rowPerfBasePositive',
    re: /^绩效基数应大于 0$/u,
    sample: '绩效基数应大于 0',
    vi: 'cơ sở tính hiệu quả phải lớn hơn 0',
    en: 'the performance base must be greater than 0',
  },
  {
    key: 'import.rowBaseCapNotBelowFloor',
    re: /^基数上限不得小于下限$/u,
    sample: '基数上限不得小于下限',
    vi: 'mức trần không được nhỏ hơn mức sàn',
    en: 'the base cap must not be lower than the base floor',
  },
  {
    key: 'import.rowNonNegative',
    re: /^(\S+) 应为非负数$/u,
    sample: 'insurance_personal 应为非负数',
    vi: '{1} phải là số không âm',
    en: '{1} must be a non-negative number',
  },
  {
    key: 'import.rowOtCustomRateInvalid',
    re: /^ot_custom 缺少\/非法 (\S+) 单价$/u,
    sample: 'ot_custom 缺少/非法 weekend 单价',
    vi: 'ot_custom thiếu hoặc sai đơn giá {1}',
    en: 'ot_custom is missing or has an invalid {1} rate',
  },
  {
    key: 'import.rowBaseFieldInvalid',
    re: /^base_field 应为 base\/gross$/u,
    sample: 'base_field 应为 base/gross',
    vi: 'base_field phải là base/gross',
    en: 'base_field must be base or gross',
  },
  {
    key: 'import.rowLateEarlyModeInvalid',
    re: /^late_early\.mode 应为 per_minute\/per_time$/u,
    sample: 'late_early.mode 应为 per_minute/per_time',
    vi: 'late_early.mode phải là per_minute/per_time',
    en: 'late_early.mode must be per_minute or per_time',
  },
  {
    key: 'import.rowLateEarlyRateInvalid',
    re: /^late_early\.rate 非法$/u,
    sample: 'late_early.rate 非法',
    vi: 'late_early.rate không hợp lệ',
    en: 'late_early.rate is invalid',
  },
  {
    key: 'import.doneInsertedSkipped',
    re: /^导入完成：新增\s*(\d+)，跳过\s*(\d+)$/u,
    sample: '导入完成：新增 12，跳过 3',
    vi: 'Nhập xong: thêm {1}, bỏ qua {2}',
    en: 'Import finished: {1} added, {2} skipped',
  },
  {
    key: 'import.doneOkFailed',
    re: /^导入完成：成功\s*(\d+)，失败\s*(\d+)$/u,
    sample: '导入完成：成功 20，失败 2',
    vi: 'Nhập xong: {1} thành công, {2} thất bại',
    en: 'Import finished: {1} succeeded, {2} failed',
  },
  {
    key: 'import.doneInsertedUpdatedFailed',
    re: /^导入完成：新增\s*(\d+)，更新\s*(\d+)，失败\s*(\d+)$/u,
    sample: '导入完成：新增 5，更新 7，失败 1',
    vi: 'Nhập xong: thêm {1}, cập nhật {2}, thất bại {3}',
    en: 'Import finished: {1} added, {2} updated, {3} failed',
  },
  {
    key: 'import.doneInsertedSkippedFailed',
    re: /^导入完成：新增\s*(\d+)，跳过\s*(\d+)，失败\s*(\d+)$/u,
    sample: '导入完成：新增 8，跳过 2，失败 1',
    vi: 'Nhập xong: thêm {1}, bỏ qua {2}, thất bại {3}',
    en: 'Import finished: {1} added, {2} skipped, {3} failed',
  },
  {
    key: 'import.rosterDone',
    re: /^排班导入完成：新增\s*(\d+)，更新\s*(\d+)，失败\s*(\d+)$/u,
    sample: '排班导入完成：新增 5，更新 7，失败 1',
    vi: 'Nhập lịch ca xong: thêm {1}, cập nhật {2}, thất bại {3}',
    en: 'Roster import finished: {1} added, {2} updated, {3} failed',
  },
  {
    key: 'import.orgDone',
    re: /^导入完成：部门新增\s*(\d+)\/更新\s*(\d+)，用户新增\s*(\d+)\/更新\s*(\d+)，失败\s*(\d+)$/u,
    sample: '导入完成：部门新增 2/更新 1，用户新增 5/更新 3，失败 0',
    vi: 'Nhập xong: phòng ban thêm {1}/cập nhật {2}, người dùng thêm {3}/cập nhật {4}, thất bại {5}',
    en: 'Import finished: {1} departments added / {2} updated, {3} users added / {4} updated, {5} failed',
  },

  // ---------------- qc.*：品质模块带插值的整句（精确反查命中不了，必须用模板） ----------------
  {
    key: 'qc.unjudgedItems',
    re: /^以下项目尚未录入检验结果，不能提交：(.+)$/u,
    sample: '以下项目尚未录入检验结果，不能提交：尺寸1、外观检查',
    vi: 'Các mục sau chưa nhập kết quả kiểm, không thể gửi duyệt: {1}',
    en: 'These items have no inspection result and cannot be submitted: {1}',
  },
  {
    key: 'qc.requiredMissing',
    re: /^以下必检项未录入，不能提交：(.+)$/u,
    sample: '以下必检项未录入，不能提交：尺寸1 等 3 项',
    vi: 'Các hạng mục bắt buộc sau chưa nhập, không thể gửi duyệt: {1}',
    en: 'These required items are missing and cannot be submitted: {1}',
  },
  {
    key: 'qc.shortMeasured',
    re: /^以下项目实测值未录满抽样数，不能提交：(.+)$/u,
    sample: '以下项目实测值未录满抽样数，不能提交：尺寸1（已录 5/80）',
    vi: 'Các mục sau chưa nhập đủ giá trị đo theo số mẫu, không thể gửi duyệt: {1}',
    en: 'These items do not have enough measured values and cannot be submitted: {1}',
  },
  {
    key: 'qc.defectTypeRequired',
    re: /^检验判定为不合格时必须选择不合格类型（可选：(.+)）$/u,
    sample: '检验判定为不合格时必须选择不合格类型（可选：外观、尺寸）',
    vi: 'Khi kết luận không đạt, phải chọn loại lỗi (có thể chọn: {1})',
    en: 'A defect type must be selected when the result is FAIL (options: {1})',
  },
  {
    key: 'qc.defectQtyTooLarge',
    re: /^第\s*(\d+)\s*行不良数（(\d+)）超过抽样数量（(\d+)）$/u,
    sample: '第 2 行不良数（30）超过抽样数量（20）',
    vi: 'Dòng {1}: số lỗi ({2}) vượt quá số mẫu ({3})',
    en: 'Row {1}: defect qty ({2}) exceeds sample size ({3})',
  },
  {
    key: 'qc.defectQtyInvalid',
    re: /^第\s*(\d+)\s*行不良数必须为 0 或正整数$/u,
    sample: '第 2 行不良数必须为 0 或正整数',
    vi: 'Dòng {1}: số lỗi phải là 0 hoặc số nguyên dương',
    en: 'Row {1}: defect qty must be 0 or a positive integer',
  },
  {
    key: 'qc.minorQtyTooLarge',
    re: /^第\s*(\d+)\s*行轻缺陷不良数（(\d+)）超过抽样数量（(\d+)）$/u,
    sample: '第 2 行轻缺陷不良数（30）超过抽样数量（20）',
    vi: 'Dòng {1}: số lỗi nhẹ ({2}) vượt quá số mẫu ({3})',
    en: 'Row {1}: minor defect qty ({2}) exceeds sample size ({3})',
  },
  {
    key: 'qc.minorQtyInvalid',
    re: /^第\s*(\d+)\s*行轻缺陷不良数必须为 0 或正整数$/u,
    sample: '第 2 行轻缺陷不良数必须为 0 或正整数',
    vi: 'Dòng {1}: số lỗi nhẹ phải là 0 hoặc số nguyên dương',
    en: 'Row {1}: minor defect qty must be 0 or a positive integer',
  },
  // ---- 员工入职：重复登记/账号已存在的收口提示（2026-10-24） ----
  {
    key: 'onboarding.duplicateMerged',
    re: /^该员工已由登记 #(\d+)（工号 (\S+)）办理入职，本条属于重复登记，已自动作废并留痕，密码未变更$/u,
    sample: '该员工已由登记 #64（工号 RJ008）办理入职，本条属于重复登记，已自动作废并留痕，密码未变更',
    vi: 'Nhân viên này đã được vào làm theo bản ghi #{1} (mã NV {2}); đây là bản ghi trùng nên đã tự động hủy và giữ lại dấu vết, mật khẩu không đổi',
    en: 'This employee was already onboarded under record #{1} (employee no. {2}). This row was a duplicate, so it was cancelled and kept for traceability; the password is unchanged',
  },
  {
    key: 'onboarding.accountLinked',
    re: /^该员工账号已存在（工号 (\S+)），本次仅补齐入职登记，未新建账号、密码未变更$/u,
    sample: '该员工账号已存在（工号 RJ008），本次仅补齐入职登记，未新建账号、密码未变更',
    vi: 'Tài khoản đã tồn tại (mã NV {1}); lần này chỉ bổ sung bản ghi vào làm, không tạo tài khoản mới, mật khẩu không đổi',
    en: 'The account already exists (employee no. {1}); this only fills in the onboarding record. No new account, password unchanged',
  },
  {
    key: 'onboarding.noTakenByOther',
    re: /^工号 (\S+) 已被「(.+?)」的账号占用，请修改本次登记里的工号后重试$/u,
    sample: '工号 RJ008 已被「Nguyễn Văn A」的账号占用，请修改本次登记里的工号后重试',
    vi: 'Mã NV {1} đã bị tài khoản của "{2}" chiếm, vui lòng sửa mã NV trong bản ghi này rồi thử lại',
    en: 'Employee no. {1} is already used by the account of "{2}"; change the employee no. in this record and retry',
  },
  {
    key: 'onboarding.noTakenByActive',
    re: /^工号 (\S+) 已被登记 #(\d+)（(.+?)）办理入职，不能重复登记$/u,
    sample: '工号 RJ008 已被登记 #64（Dương Thị Liên）办理入职，不能重复登记',
    vi: 'Mã NV {1} đã được dùng để vào làm ở bản ghi #{2} ({3}), không thể đăng ký trùng',
    en: 'Employee no. {1} was already used to onboard under record #{2} ({3}); duplicate registration is not allowed',
  },
  {
    key: 'onboarding.noTakenByDraft',
    re: /^工号 (\S+) 有未确认的登记 #(\d+)（(.+?)），不能重复登记；如确需重建请先作废原登记$/u,
    sample: '工号 RJ008 有未确认的登记 #18（Dương Thị Liên），不能重复登记；如确需重建请先作废原登记',
    vi: 'Mã NV {1} đã có bản ghi chưa xác nhận #{2} ({3}), không thể đăng ký trùng; nếu cần tạo lại hãy hủy bản ghi cũ trước',
    en: 'Employee no. {1} already has an unconfirmed record #{2} ({3}); duplicate registration is not allowed. Cancel the old record first if you need to re-create it',
  },
  {
    key: 'onboarding.alreadyConfirmed',
    re: /^该员工已入职（工号 (.+?)），无需重复确认$/u,
    sample: '该员工已入职（工号 RJ008），无需重复确认',
    vi: 'Nhân viên này đã vào làm (mã NV {1}), không cần xác nhận lại',
    en: 'This employee is already onboarded (employee no. {1}); no need to confirm again',
  },
];

export default { MESSAGES, NOTIFY_PREFIXES, MESSAGE_PATTERNS };
