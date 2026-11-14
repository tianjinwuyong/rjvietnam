import { type HelpChapter, p, h3, ul, ol, note, table, flow, T } from './helpTypes';

export const productionChapters: HelpChapter[] = [
  // ================================================================ 9 工单与需求
  {
    id: 'workorder',
    icon: 'factory',
    title: T('工单与物料需求', 'Lệnh sản xuất và nhu cầu vật tư', 'Work Orders & Material Requirements'),
    summary: T(
      '从下达工单到生成物料需求、生成领料单的完整链路。计划员与生产主管的主战场。',
      'Toàn bộ chuỗi từ phát hành lệnh sản xuất đến sinh nhu cầu vật tư và phiếu lĩnh. Địa bàn chính của kế hoạch và trưởng sản xuất.',
      'The full chain from releasing a work order to generating material requirements and picking orders.',
    ),
    sections: [
      {
        id: 'workorder-flow',
        title: T('领料链路总览', 'Tổng quan chuỗi lĩnh vật tư', 'Picking Chain Overview'),
        blocks: [
          flow(
            ['下达工单', 'Phát hành lệnh', 'Release order'],
            ['生成物料需求', 'Sinh nhu cầu vật tư', 'Generate requirement'],
            ['提交需求', 'Gửi nhu cầu', 'Submit requirement'],
            ['自动生成领料单', 'Tự sinh phiếu lĩnh', 'Auto-create picking order'],
            ['提交领料审批', 'Gửi phê duyệt lĩnh', 'Submit for approval'],
            ['生产主管审批', 'Trưởng sản xuất duyệt', 'Production manager approves'],
            ['发料出库', 'Xuất kho', 'Issue stock'],
          ),
          note(
            'info',
            '这条链路上的每一步都由不同角色完成：计划员做前三步，生产物料员发起审批与领料，仓管员或物料员执行发料。任何一步卡住，后面都动不了。',
            'Mỗi bước do vai trò khác nhau thực hiện: kế hoạch làm ba bước đầu, nhân viên vật tư khởi tạo phê duyệt và lĩnh, nhân viên kho hoặc vật tư thực hiện xuất kho. Kẹt một bước là các bước sau không chạy được.',
            'Each step belongs to a different role: planners do the first three, material handlers initiate approval and picking, keepers execute issuing. If one step stalls, the rest cannot proceed.',
          ),
        ],
      },
      {
        id: 'workorder-list',
        title: T('工单列表', 'Danh sách lệnh sản xuất', 'Work Order List'),
        blocks: [
          ul(
            ['菜单路径：工单 → 工单列表。', 'Đường dẫn: Lệnh sản xuất → Danh sách lệnh.', 'Menu: Work Orders → Work Order List.'],
            ['主要字段：工单号、产品编码、产品名称、计划数量、完工数量、工单日期、工段、计划员、状态。', 'Trường chính: số lệnh, mã sản phẩm, tên sản phẩm, số kế hoạch, số hoàn thành, ngày lệnh, công đoạn, kế hoạch, trạng thái.', 'Key fields: order no., product code/name, planned qty, finished qty, order date, work section, planner, status.'],
            ['「工单日期」为必填，缺失时系统会拒绝而不是默认当天。', 'Trường "Ngày lệnh" là bắt buộc; nếu thiếu, hệ thống từ chối chứ không mặc định hôm nay.', 'Order Date is mandatory; if missing the system rejects rather than defaulting to today.'],
          ),
          h3('工单状态流转', 'Luồng trạng thái lệnh sản xuất', 'Work Order Status Flow'),
          table(
            [['状态', 'Trạng thái', 'Status'], ['含义', 'Ý nghĩa', 'Meaning'], ['可做操作', 'Thao tác được phép', 'Allowed actions']],
            [
              [
                ['已创建', 'Đã tạo', 'created'],
                ['工单刚建立', 'Lệnh vừa tạo', 'Just created'],
                ['生成物料需求', 'Sinh nhu cầu vật tư', 'Generate requirements'],
              ],
              [
                ['已下达', 'Đã phát hành', 'released'],
                ['已下发给车间', 'Đã phát xuống xưởng', 'Released to the shop floor'],
                ['生成物料需求、领料', 'Sinh nhu cầu, lĩnh vật tư', 'Generate requirements, pick'],
              ],
              [
                ['进行中', 'Đang sản xuất', 'in_progress'],
                ['车间正在生产', 'Xưởng đang sản xuất', 'In production'],
                ['领料、退料、补料', 'Lĩnh, hoàn trả, bổ sung', 'Pick, return, supplement'],
              ],
              [
                ['已完工', 'Đã hoàn thành', 'completed'],
                ['生产完成', 'Sản xuất xong', 'Production finished'],
                ['退料、结案', 'Hoàn trả, kết thúc', 'Return, close'],
              ],
              [
                ['已关闭', 'Đã kết thúc', 'closed'],
                ['已结案归档', 'Đã kết thúc và lưu trữ', 'Closed and archived'],
                ['查询', 'Tra cứu', 'Query'],
              ],
              [
                ['已取消', 'Đã hủy', 'cancelled'],
                ['作废', 'Hủy bỏ', 'Voided'],
                ['查询', 'Tra cứu', 'Query'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'workorder-requirement',
        title: T('生成与提交物料需求', 'Sinh và gửi nhu cầu vật tư', 'Generating & Submitting Requirements'),
        blocks: [
          p(
            '物料需求是"这张工单要用的料一共多少"的清单。系统按 BOM 自动展开计算，不需要人工填数量。',
            'Nhu cầu vật tư là danh sách "lệnh này cần tổng cộng bao nhiêu vật tư". Hệ thống tự bung theo BOM để tính, không cần nhập tay.',
            'Material requirements list how much material the order needs. The system explodes the BOM automatically; no manual entry needed.',
          ),
          ol(
            [
              '菜单路径：工单 → 物料需求。输入或选择工单号，系统自动加载。',
              'Đường dẫn: Lệnh sản xuất → Nhu cầu vật tư. Nhập hoặc chọn số lệnh; hệ thống tự tải.',
              'Menu: Work Orders → Material Requirements. Enter or pick the work order; the system loads automatically.',
            ],
            [
              '点「生成需求单」。系统按 BOM 全工段展开，算出每个物料的「需求数量」。',
              'Bấm "Sinh nhu cầu". Hệ thống bung toàn bộ công đoạn theo BOM và tính "số lượng cần" cho từng vật tư.',
              'Click Generate Requirement. The BOM is exploded across all work sections to compute the required quantity per material.',
            ],
            [
              '核对需求清单，确认数量与工段无误。此时需求单为「草稿」状态。',
              'Đối chiếu danh sách nhu cầu, xác nhận số lượng và công đoạn. Lúc này nhu cầu ở trạng thái "Nháp".',
              'Check the list for quantity and work section. The requirement is now in draft.',
            ],
            [
              '点「提交需求」，系统自动生成对应的领料单。',
              'Bấm "Gửi nhu cầu"; hệ thống tự sinh phiếu lĩnh tương ứng.',
              'Click Submit Requirement; the system creates the matching picking orders.',
            ],
          ),
          note(
            'warn',
            '提交需求会一次性生成领料单，提交前务必核对。若同一工单重复生成需求，会造成重复领料风险。',
            'Gửi nhu cầu sẽ sinh phiếu lĩnh một lần; phải kiểm tra kỹ trước khi gửi. Nếu sinh nhu cầu lặp cho cùng một lệnh sẽ có nguy cơ lĩnh trùng.',
            'Submitting generates picking orders in one shot — verify first. Regenerating requirements for the same order risks duplicate picking.',
          ),
          note(
            'info',
            '若提示"该工单无草稿状态的需求单"，说明需求已经生成并提交过了，请到「领料单」页面继续后续流程，不要重复生成。',
            'Nếu báo "lệnh này không có nhu cầu ở trạng thái nháp", nghĩa là nhu cầu đã sinh và gửi rồi; hãy sang trang "Phiếu lĩnh" để tiếp tục, đừng sinh lại.',
            'If it says the order has no draft requirement, the requirement was already generated and submitted — continue on the Picking Orders page instead.',
          ),
        ],
      },
    ],
  },

  // ================================================================ 10 生产管理
  {
    id: 'production',
    icon: 'package-check',
    title: T('生产管理', 'Quản lý sản xuất', 'Production Management'),
    summary: T(
      '领料单审批、退料、超补领料与补料记录。生产主管在这里把控物料发放。',
      'Phê duyệt phiếu lĩnh, hoàn trả, lĩnh vượt và hồ sơ bổ sung. Trưởng sản xuất kiểm soát cấp phát vật tư tại đây.',
      'Picking approval, returns, over-picking and supplement records. Production managers control material release here.',
    ),
    sections: [
      {
        id: 'production-approval',
        title: T('领料单审批', 'Phê duyệt phiếu lĩnh vật tư', 'Picking Approval'),
        blocks: [
          ol(
            [
              '菜单路径：生产管理 → 领料单审批。',
              'Đường dẫn: Quản lý sản xuất → Phê duyệt phiếu lĩnh.',
              'Menu: Production → Picking Approval.',
            ],
            [
              '按工单筛选出待审批的领料单，勾选需要处理的单据。',
              'Lọc phiếu lĩnh chờ duyệt theo lệnh sản xuất, chọn các phiếu cần xử lý.',
              'Filter pending picking orders by work order and select those to process.',
            ],
            [
              '核对物料、数量、工段。无误则点「批准」，批准后单据下发到发料管理，可以开始发料。',
              'Đối chiếu vật tư, số lượng, công đoạn. Nếu đúng, bấm "Phê duyệt"; sau đó phiếu xuống quản lý xuất kho và có thể phát hàng.',
              'Check material, quantity and work section. If correct, click Approve; the order then goes to Issuing Management.',
            ],
            [
              '有问题则点「驳回」，必须填写驳回原因，单据退回申请人修改。',
              'Nếu có vấn đề, bấm "Từ chối"; bắt buộc nhập lý do từ chối, phiếu trả về người gửi để sửa.',
              'If there is a problem, click Reject; a reason is mandatory and the order returns to the requester.',
            ],
          ),
          note(
            'warn',
            '未审批的领料单不能发料。发料时会提示"该领料单未审批"，这是系统在拦截越权发料。',
            'Phiếu lĩnh chưa duyệt không xuất kho được. Khi xuất sẽ báo "phiếu lĩnh chưa được duyệt" — đây là hệ thống chặn xuất kho vượt quyền.',
            'Unapproved picking orders cannot be issued. The system reports that the order is not approved, blocking unauthorized issuing.',
          ),
        ],
      },
      {
        id: 'production-overpicking',
        title: T('超补领料单', 'Phiếu lĩnh vượt', 'Over-Picking / Supplement Order'),
        blocks: [
          p(
            '当生产过程中物料损耗超出 BOM 用量（报废、损坏、试产），需要额外领料时，走「超补领料单」，而不是修改原领料单。',
            'Khi hao hụt vượt định mức BOM (tiêu hủy, hỏng, chạy thử), cần lĩnh thêm thì dùng "Phiếu lĩnh vượt" chứ không sửa phiếu lĩnh gốc.',
            'When usage exceeds the BOM allowance (scrap, damage, trial runs), use an Over-Picking order instead of editing the original.',
          ),
          ol(
            [
              '菜单路径：生产管理 → 超补领料单，点「创建超补领料单」。',
              'Đường dẫn: Quản lý sản xuất → Phiếu lĩnh vượt, bấm "Tạo phiếu lĩnh vượt".',
              'Menu: Production → Over-Picking, click Create.',
            ],
            [
              '选择或搜索原工单号（正常工单），系统会关联该工单。',
              'Chọn hoặc tìm số lệnh gốc (lệnh bình thường); hệ thống sẽ liên kết lệnh đó.',
              'Select or search the original work order; the system links to it.',
            ],
            [
              '添加需要超补的物料明细与数量，填写超补原因（如实填写，会进入审批依据）。',
              'Thêm chi tiết vật tư và số lượng cần lĩnh vượt, nhập lý do (ghi trung thực vì đây là căn cứ phê duyệt).',
              'Add the material lines and quantities, and enter the reason (it becomes the approval basis).',
            ],
            [
              '提交后等待生产主管审批。审批通过即生效，可进入发料环节。',
              'Sau khi gửi, chờ trưởng sản xuất duyệt. Duyệt xong là có hiệu lực và vào bước xuất kho.',
              'After submission, wait for the production manager. Once approved it takes effect and enters issuing.',
            ],
          ),
          table(
            [['页面', 'Trang', 'Page'], ['用途', 'Mục đích', 'Purpose']],
            [
              [
                ['超补领料单', 'Phiếu lĩnh vượt', 'Over-Picking Order'],
                ['创建与审批超补申请，统计已生效单数、累计超补数量与金额', 'Tạo và duyệt yêu cầu lĩnh vượt; thống kê số phiếu hiệu lực, tổng số lượng và số tiền lĩnh vượt', 'Create and approve requests; stats on effective orders, total quantity and amount'],
              ],
              [
                ['补料记录', 'Hồ sơ bổ sung', 'Supplement Record'],
                ['查看所有补料/超补的历史记录', 'Xem toàn bộ hồ sơ bổ sung/lĩnh vượt', 'View all supplement/over-pick history'],
              ],
              [
                ['超补报表', 'Báo cáo lĩnh vượt', 'Over-Supplement Report'],
                ['按工单、物料、时间段统计超补情况，用于成本分析', 'Thống kê lĩnh vượt theo lệnh, vật tư, khoảng thời gian để phân tích chi phí', 'Analyze over-picking by order, material and period for costing'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'production-return',
        title: T('退料单', 'Phiếu hoàn trả vật tư', 'Production Return'),
        blocks: [
          ul(
            ['菜单路径：生产管理 → 退料单。', 'Đường dẫn: Quản lý sản xuất → Phiếu hoàn trả.', 'Menu: Production → Production Return.'],
            ['工单完工后用不完的物料退回仓库，退料数量不能超过该工单已领用的数量。', 'Vật tư dùng không hết sau khi lệnh hoàn thành được trả về kho; số lượng trả không vượt số đã lĩnh của lệnh.', 'Unused material after completion returns to the warehouse; the return quantity cannot exceed what was picked.'],
            ['退料入库后库存回到良品仓，可再次被领用。', 'Sau khi nhập kho hoàn trả, tồn về kho hàng tốt và có thể lĩnh lại.', 'After storing, stock returns to the good warehouse and can be picked again.'],
            ['对应的收货动作在「收料 → 退料单」中完成（见收料章节）。', 'Thao tác nhận tương ứng thực hiện ở "Nhận hàng → Phiếu hoàn trả" (xem chương Nhận hàng).', 'The matching receipt action happens under Receiving → Production Return.'],
          ),
        ],
      },
    ],
  },

  // ================================================================ 11 发料
  {
    id: 'issuing',
    icon: 'send',
    title: T('发料管理', 'Quản lý xuất kho', 'Issuing Management'),
    summary: T(
      '已审批的领料单在这里执行实际发料，支持扫码发料、数量调整与 FIFO 提醒。',
      'Phiếu lĩnh đã duyệt được phát hàng tại đây, hỗ trợ quét mã, điều chỉnh số lượng và nhắc FIFO.',
      'Approved picking orders are issued here, with scanning, quantity adjustment and FIFO reminders.',
    ),
    sections: [
      {
        id: 'issuing-execute',
        title: T('执行发料', 'Thực hiện xuất kho', 'Executing an Issue'),
        blocks: [
          ol(
            [
              '菜单路径：发料 → 领料单列表。列表显示已审批可发料的单据。',
              'Đường dẫn: Xuất kho → Danh sách phiếu lĩnh. Danh sách hiển thị phiếu đã duyệt, sẵn sàng phát hàng.',
              'Menu: Issuing → Picking Order List. Shows approved orders ready to issue.',
            ],
            [
              '输入领料单号或扫描领料单二维码，打开该单据。',
              'Nhập số phiếu lĩnh hoặc quét mã QR của phiếu để mở.',
              'Enter the picking order number or scan its QR code to open it.',
            ],
            [
              '扫描物料标签，或手工输入本次发料数量。',
              'Quét nhãn vật tư, hoặc nhập tay số lượng phát hàng lần này.',
              'Scan material labels or type the issue quantity manually.',
            ],
            [
              '核对「已扫数量」与「领料数量」，点「确认发料出库」。',
              'Đối chiếu "số đã quét" với "số cần lĩnh", bấm "Xác nhận xuất kho".',
              'Check scanned versus required quantity, then click Confirm Issue.',
            ],
            [
              '系统扣减库存并写入库存流水，发料完成。',
              'Hệ thống trừ tồn kho và ghi giao dịch; phát hàng hoàn tất.',
              'The system decrements stock, writes a transaction and the issue is complete.',
            ],
          ),
          note(
            'warn',
            '「以下物料不在该领料单中」：说明扫的物料与该领料单的明细不匹配。请核对是否扫错箱子，或该物料本就不在这张单上。',
            '"Vật tư sau không thuộc phiếu lĩnh này": nghĩa là vật tư quét vào không khớp chi tiết phiếu. Kiểm tra xem có quét nhầm thùng hoặc vật tư đó không thuộc phiếu này.',
            '"The following materials are not on this picking order": the scanned material does not match the order lines. Check for a wrong box or a material not on this order.',
          ),
          note(
            'info',
            '盘装料（Reel）怎么发：不需要另外扫「盘号」。系统按物料主数据里的「包装类型」自动判断——盘装料把扫到的六段码第 6 段「流水号」当作盘号写进盘台账，普通料按数量收发。',
            'Cách xuất hàng cuộn (Reel): không cần quét thêm "số cuộn". Hệ thống tự phán định theo "Loại đóng gói" trong dữ liệu vật tư — hàng cuộn lấy đoạn thứ 6 (số thứ tự) của mã sáu đoạn làm số cuộn và ghi vào sổ cuộn; hàng thường nhận/xuất theo số lượng.',
            'Issuing reels: no separate "reel number" scan is needed. The system reads Packaging Type from master data — for reels it records segment 6 (the serial) of the six-segment label as the reel number in the reel ledger; normal materials are issued by quantity.',
          ),
          note(
            'tip',
            '想让某个料按「盘」管理，只需在「物料主数据」把它改成「盘装料（Reel）」保存，下次发料立即生效，不用改任何单据。',
            'Muốn quản lý một vật tư theo "cuộn", chỉ cần đổi thành "Cuộn (Reel)" trong "Dữ liệu vật tư" và lưu; lần xuất sau có hiệu lực ngay, không cần sửa phiếu.',
            'To manage a material per reel, set it to Reel in Material Master and save; the next issue follows immediately with no document changes.',
          ),
        ],
      },
      {
        id: 'issuing-fifo',
        title: T('FIFO 先进先出提醒', 'Nhắc FIFO (nhập trước xuất trước)', 'FIFO Reminder'),
        blocks: [
          p(
            '系统会对比当前要发的批次与该物料最早可用批次的生产日期。如果发了较晚的批次，会弹出提醒。',
            'Hệ thống so lô sắp phát với ngày sản xuất của lô khả dụng sớm nhất. Nếu phát lô muộn hơn, sẽ hiện cảnh báo.',
            'The system compares the batch being issued with the earliest available batch. Issuing a later batch raises a warning.',
          ),
          ul(
            ['提醒会显示「最早可用生产日期」，便于判断是否真的需要发新批次。', 'Cảnh báo hiển thị "ngày sản xuất sớm nhất còn dùng được" để đánh giá có thật sự cần phát lô mới.', 'The warning shows the earliest available production date so you can judge whether a newer batch is really needed.'],
            ['若确实需要发该批次（如旧批次有质量问题），点「强制继续发放」即可越过提醒。', 'Nếu thật sự cần phát lô đó (ví dụ lô cũ có vấn đề chất lượng), bấm "Tiếp tục phát bắt buộc" để bỏ qua cảnh báo.', 'If you really need that batch (e.g. the old one has quality issues), click Force Continue to bypass the warning.'],
            ['强制继续会记录在发料记录中。', 'Việc tiếp tục bắt buộc được ghi vào hồ sơ phát hàng.', 'Force-continue is recorded in the issue history.'],
          ),
          note(
            'tip',
            'FIFO 提醒是提示而非禁止。系统不会阻止你发新批次，但会留下记录，便于事后分析是否符合物料先进先出原则。',
            'Nhắc FIFO là gợi ý, không phải cấm. Hệ thống không chặn phát lô mới nhưng có ghi lại để phân tích sau này.',
            'The FIFO reminder advises rather than forbids. The system does not block a newer batch but records the deviation for later analysis.',
          ),
        ],
      },
      {
        id: 'issuing-records',
        title: T('发料记录查询', 'Tra cứu hồ sơ xuất kho', 'Issue Record Query'),
        blocks: [
          ul(
            ['菜单路径：发料 → 发料记录。', 'Đường dẫn: Xuất kho → Hồ sơ xuất kho.', 'Menu: Issuing → Issue Records.'],
            ['可按工单、物料、领料人、时间段筛选。', 'Lọc theo lệnh, vật tư, người lĩnh, khoảng thời gian.', 'Filter by work order, material, picker and date range.'],
            ['记录包含：物料、批次、库位、发料数量、发料时间、操作人。', 'Hồ sơ gồm: vật tư, lô, vị trí, số lượng phát, thời gian, người thao tác.', 'Records include material, batch, location, quantity, time and operator.'],
            ['这是追溯"某批料被谁在什么时候发给哪张工单"的关键报表。', 'Đây là báo cáo then chốt để truy vết "lô nào được ai phát cho lệnh nào, lúc nào".', 'This is the key report for tracing who issued which batch to which order and when.'],
          ),
        ],
      },
      {
        id: 'issuing-picking',
        title: T('拣货与领料签收', 'Nhặt hàng và nhận vật tư', 'Picking & Receipt'),
        blocks: [
          table(
            [['状态', 'Trạng thái', 'Status'], ['含义', 'Ý nghĩa', 'Meaning']],
            [
              [
                ['待审批', 'Chờ duyệt', 'pending_approval'],
                ['已提交，等生产主管审批', 'Đã gửi, chờ trưởng sản xuất duyệt', 'Submitted, awaiting manager'],
              ],
              [
                ['已批准', 'Đã duyệt', 'approved'],
                ['可以发料', 'Có thể phát hàng', 'Ready to issue'],
              ],
              [
                ['待签收', 'Chờ nhận', 'issued'],
                ['仓库已发料、库存已扣，等待领料方确认实收', 'Kho đã phát, đã trừ tồn, chờ bên nhận xác nhận', 'Issued and stock deducted; awaiting receipt confirmation'],
              ],
              [
                ['已签收', 'Đã nhận', 'received'],
                ['领料方确认实收数量，单据完结', 'Bên nhận xác nhận số thực nhận, phiếu kết thúc', 'Recipient confirmed the received qty; order closed'],
              ],
            ],
          ),
          note(
            'info',
            '签收入口：PDA「发料过账」或电脑端「生产 → 领料签收」。逐行核对实收数量，短收必须填写差异原因；差额由业务决定走补料或退料。',
            'Nơi nhận: PDA "Xác nhận xuất kho" hoặc "Sản xuất → Nhận vật tư" trên máy tính. Đối chiếu từng dòng; thiếu phải ghi lý do; chênh lệch xử lý bằng bổ sung hoặc trả lại.',
            'Receipt entry: PDA "Issue posting" or PC Production → Picking Receipt. Check each line; a shortage requires a reason; the difference is settled by supplementary picking or return.',
          ),
        ],
      },
    ],
  },

  // ================================================================ 12 BOM
  {
    id: 'bom',
    icon: 'file-spreadsheet',
    title: T('BOM 物料清单', 'BOM Danh mục vật tư', 'BOM (Bill of Materials)'),
    summary: T(
      'BOM 决定物料需求怎么算。这里说明 BOM 的结构、工段字段与维护要点。',
      'BOM quyết định cách tính nhu cầu vật tư. Phần này giải thích cấu trúc BOM, trường công đoạn và điểm cần lưu ý khi bảo trì.',
      'The BOM drives requirement calculation. This explains its structure, work-section field and maintenance points.',
    ),
    sections: [
      {
        id: 'bom-structure',
        title: T('BOM 的结构', 'Cấu trúc BOM', 'BOM Structure'),
        blocks: [
          p(
            'BOM 描述"一个产品由哪些物料、各用多少组成"。它是一对多的关系：一张 BOM 主表 + 多条物料明细。',
            'BOM mô tả "một sản phẩm gồm những vật tư nào, mỗi thứ bao nhiêu". Đây là quan hệ một-nhiều: một bảng BOM chính + nhiều dòng chi tiết.',
            'A BOM describes which materials a product uses and in what quantity. It is one-to-many: a BOM header plus many item lines.',
          ),
          table(
            [['层级', 'Cấp', 'Level'], ['字段', 'Trường', 'Field'], ['说明', 'Mô tả', 'Description']],
            [
              [
                ['BOM 主表', 'Bảng BOM chính', 'BOM header'],
                ['BOM 编号', 'Mã BOM', 'BOM code'],
                ['BOM 的唯一标识', 'Mã định danh duy nhất của BOM', 'Unique BOM identifier'],
              ],
              [
                ['BOM 主表', 'Bảng BOM chính', 'BOM header'],
                ['产品编码 / 产品名称', 'Mã / tên sản phẩm', 'Product code / name'],
                ['这个 BOM 对应的成品', 'Thành phẩm tương ứng của BOM này', 'The finished product this BOM describes'],
              ],
              [
                ['BOM 主表', 'Bảng BOM chính', 'BOM header'],
                ['版本', 'Phiên bản', 'Version'],
                ['设计变更时升版本，保留历史', 'Tăng phiên bản khi thay đổi thiết kế, giữ lịch sử', 'Bump on design change and keep history'],
              ],
              [
                ['BOM 主表', 'Bảng BOM chính', 'BOM header'],
                ['状态', 'Trạng thái', 'Status'],
                ['仅启用状态的 BOM 参与需求计算', 'Chỉ BOM ở trạng thái hoạt động mới tham gia tính nhu cầu', 'Only active BOMs participate in requirement calculation'],
              ],
              [
                ['物料明细', 'Chi tiết vật tư', 'BOM items'],
                ['物料编码 / 名称', 'Mã / tên vật tư', 'Material code / name'],
                ['组成该产品的每一种物料', 'Từng loại vật tư cấu thành sản phẩm', 'Each material making up the product'],
              ],
              [
                ['物料明细', 'Chi tiết vật tư', 'BOM items'],
                ['用量', 'Số lượng dùng', 'Quantity'],
                ['生产一个产品需要多少', 'Số lượng cần cho một sản phẩm', 'Quantity needed per unit'],
              ],
              [
                ['物料明细', 'Chi tiết vật tư', 'BOM items'],
                ['工段', 'Công đoạn', 'Work section'],
                ['该物料在哪个工段使用（SMT / DIP / 组装 / 包装）', 'Vật tư dùng ở công đoạn nào (SMT / DIP / Lắp ráp / Đóng gói)', 'Which work section uses it (SMT / DIP / Assembly / Packing)'],
              ],
              [
                ['物料明细', 'Chi tiết vật tư', 'BOM items'],
                ['排序', 'Thứ tự', 'Sort order'],
                ['明细显示顺序', 'Thứ tự hiển thị chi tiết', 'Display order of lines'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'bom-worksection',
        title: T('工段的作用', 'Vai trò của công đoạn', 'The Role of Work Sections'),
        blocks: [
          p(
            '工段决定了「谁领这份料」。系统按工段把物料需求拆分给不同的物料员，SMT 物料员只看到 SMT 工段的物料。',
            'Công đoạn quyết định "ai lĩnh vật tư này". Hệ thống tách nhu cầu theo công đoạn cho từng nhân viên vật tư; nhân viên SMT chỉ thấy vật tư của công đoạn SMT.',
            'The work section decides who picks which material. The system splits requirements by section; an SMT handler only sees SMT materials.',
          ),
          table(
            [['工段值', 'Giá trị công đoạn', 'Work section value'], ['中文', 'Tiếng Trung', 'Chinese'], ['对应角色', 'Vai trò tương ứng', 'Role']],
            [
              [
                ['smt', 'smt', 'smt'],
                ['SMT 贴片', 'SMT dán', 'SMT'],
                ['SMT 物料员', 'Nhân viên vật tư SMT', 'SMT Material Handler'],
              ],
              [
                ['dip', 'dip', 'dip'],
                ['DIP 插件', 'DIP cắm', 'DIP'],
                ['插件物料员', 'Nhân viên vật tư DIP', 'DIP Material Handler'],
              ],
              [
                ['assembly', 'assembly', 'assembly'],
                ['组装', 'Lắp ráp', 'Assembly'],
                ['组装物料员', 'Nhân viên vật tư Lắp ráp', 'Assembly Material Handler'],
              ],
              [
                ['packing', 'packing', 'packing'],
                ['包装', 'Đóng gói', 'Packing'],
                ['包装物料员', 'Nhân viên vật tư Đóng gói', 'Packing Material Handler'],
              ],
            ],
          ),
          note(
            'warn',
            'BOM 明细若不填工段，物料在需求展开时可能无法正确分配到工段，导致对应物料员看不到这份需求。维护 BOM 时务必填写工段。',
            'Nếu chi tiết BOM không nhập công đoạn, khi bung nhu cầu vật tư có thể không được phân bổ đúng, khiến nhân viên tương ứng không thấy nhu cầu. Nhập công đoạn khi bảo trì BOM.',
            'If a BOM line has no work section, requirement explosion may not assign it correctly and the right handler will not see it. Always fill it in.',
          ),
        ],
      },
      {
        id: 'bom-maintain',
        title: T('BOM 变更注意事项', 'Lưu ý khi thay đổi BOM', 'BOM Change Cautions'),
        blocks: [
          ul(
            ['变更 BOM 影响后续所有新工单的需求计算，但不回溯修改已生成的领料单。', 'Thay đổi BOM ảnh hưởng cách tính nhu cầu của mọi lệnh mới, nhưng không sửa ngược các phiếu lĩnh đã sinh.', 'BOM changes affect requirement calculation for new work orders but do not retroactively modify existing picking orders.'],
            ['设计变更建议升版本而不是直接改原 BOM，便于追溯历史产品用料。', 'Khi thay đổi thiết kế, nên tăng phiên bản thay vì sửa trực tiếp BOM gốc, để truy vết vật tư của sản phẩm cũ.', 'For design changes, bump the version rather than editing the original, so historical material usage stays traceable.'],
            ['停用的 BOM 不参与需求计算，但历史单据仍可查看。', 'BOM ngừng dùng không tham gia tính nhu cầu, nhưng phiếu lịch sử vẫn xem được.', 'Disabled BOMs do not participate in calculation but historical documents remain viewable.'],
            ['替代料关系不在 BOM 中维护，而在「基础数据 → 替代料」中维护。', 'Quan hệ vật tư thay thế không bảo trì trong BOM mà ở "Dữ liệu nền → Vật tư thay thế".', 'Substitutions are maintained under Master Data → Substitution, not in the BOM.'],
          ),
        ],
      },
    ],
  },
];
