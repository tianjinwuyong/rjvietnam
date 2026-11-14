import { type HelpChapter, p, h3, ul, ol, note, table, flow, T } from './helpTypes';

export const qcChapters: HelpChapter[] = [
  // ================================================================ 5 收料
  {
    id: 'receipt',
    icon: 'inbox',
    title: T('收料管理', 'Quản lý nhận hàng', 'Receiving'),
    summary: T(
      '扫码收货是整个系统的入口。本章讲清扫码、批次收货、收货单与提交 IQC 的完整操作。',
      'Quét mã nhận hàng là lối vào của toàn hệ thống. Chương này trình bày đầy đủ thao tác quét mã, nhận hàng theo lô, phiếu nhận hàng và gửi IQC.',
      'Scanning receipts is the entry point of the whole system. This chapter covers scanning, batch receipt, receipt orders and submitting to IQC.',
    ),
    sections: [
      {
        id: 'receipt-qr',
        title: T('二维码标签格式（六段码）', 'Định dạng nhãn QR (mã sáu đoạn)', 'QR Label Format (Six Segments)'),
        blocks: [
          p(
            '每个物料箱上的二维码内容由六个字段组成，用星号 * 分隔，顺序固定、缺一不可：',
            'Nội dung mã QR trên mỗi thùng vật tư gồm sáu trường, phân tách bằng dấu sao *, thứ tự cố định và không được thiếu:',
            'The QR content on each material box has six fields separated by asterisks, in a fixed order, none optional:',
          ),
          note(
            'info',
            '供应商编码 * 料号 * 生产日期 * 数量 * 批次号 * 流水号',
            'Mã nhà cung cấp * Mã vật tư * Ngày sản xuất * Số lượng * Số lô * Số thứ tự',
            'Supplier Code * Part No. * Production Date * Quantity * Batch No. * Serial No.',
          ),
          table(
            [['段位', 'Đoạn', 'Segment'], ['字段', 'Trường', 'Field'], ['示例', 'Ví dụ', 'Example'], ['校验规则', 'Quy tắc kiểm tra', 'Validation rule']],
            [
              [
                ['第 1 段', 'Đoạn 1', 'Segment 1'],
                ['供应商编码', 'Mã nhà cung cấp', 'Supplier code'],
                ['A.967', 'A.967', 'A.967'],
                ['必须在供应商表中存在，且等于该物料的默认供应商', 'Phải tồn tại trong bảng nhà cung cấp và bằng nhà cung cấp mặc định của vật tư', 'Must exist in the supplier table and equal the material default supplier'],
              ],
              [
                ['第 2 段', 'Đoạn 2', 'Segment 2'],
                ['料号', 'Mã vật tư', 'Part No.'],
                ['QAMAT001', 'QAMAT001', 'QAMAT001'],
                ['必须在物料表中存在，区分大小写', 'Phải tồn tại trong bảng vật tư, phân biệt chữ hoa/thường', 'Must exist in the material table, case-sensitive'],
              ],
              [
                ['第 3 段', 'Đoạn 3', 'Segment 3'],
                ['生产日期', 'Ngày sản xuất', 'Production date'],
                ['2026-10-08', '2026-10-08', '2026-10-08'],
                ['格式 YYYY-MM-DD，不能为空', 'Định dạng YYYY-MM-DD, không được để trống', 'Format YYYY-MM-DD, mandatory'],
              ],
              [
                ['第 4 段', 'Đoạn 4', 'Segment 4'],
                ['数量', 'Số lượng', 'Quantity'],
                ['100', '100', '100'],
                ['必须是大于 0 的数字', 'Phải là số lớn hơn 0', 'Must be a number greater than 0'],
              ],
              [
                ['第 5 段', 'Đoạn 5', 'Segment 5'],
                ['批次号', 'Số lô', 'Batch No.'],
                ['B20261001', 'B20261001', 'B20261001'],
                ['用于同批合并，同一批必须完全一致', 'Dùng để gộp cùng lô; trong cùng lô phải hoàn toàn giống nhau', 'Used for batch merging; must be identical within a batch'],
              ],
              [
                ['第 6 段', 'Đoạn 6', 'Segment 6'],
                ['流水号', 'Số thứ tự', 'Serial No.'],
                ['S0001', 'S0001', 'S0001'],
                ['区分同批次内的每一箱，用于识别重码', 'Phân biệt từng thùng trong cùng lô, dùng để nhận biết trùng mã', 'Distinguishes boxes in a batch and detects duplicates'],
              ],
            ],
          ),
          note(
            'warn',
            '重码判定是「整串六段码完全相同」。也就是说：同一批次（第 5 段相同）的不同箱子，只要流水号不同就都是合法的，可以正常收货。',
            'Việc nhận biết trùng mã dựa trên "toàn bộ chuỗi sáu đoạn giống hệt nhau". Nghĩa là: các thùng khác nhau trong cùng một lô (đoạn 5 giống nhau) chỉ cần khác số thứ tự là hợp lệ và nhận bình thường.',
            'Duplicate detection compares the entire six-segment string. So different boxes in the same batch (same segment 5) are all valid as long as the serial differs.',
          ),
        ],
      },
      {
        id: 'receipt-scan',
        title: T('扫码收货（单张）', 'Quét mã nhận hàng (từng thùng)', 'Scan Receipt (Single Box)'),
        blocks: [
          p(
            '菜单路径：收料 → 扫码收货。这是仓管员日常使用最频繁的页面。',
            'Đường dẫn: Nhận hàng → Quét mã nhận hàng. Đây là trang nhân viên kho dùng thường xuyên nhất.',
            'Menu: Receiving → Scan Receipt. This is the page warehouse keepers use most.',
          ),
          ol(
            [
              '选择收货库位。库位类型决定物料进入良品仓还是不良品仓，务必选对。',
              'Chọn vị trí nhận hàng. Loại vị trí quyết định vật tư vào kho hàng tốt hay hàng lỗi; phải chọn đúng.',
              'Select the receiving location. Its type decides whether material goes to the good or defective warehouse — choose correctly.',
            ],
            [
              '将光标定位到扫码输入框，用扫码枪扫描物料箱上的二维码；也可用摄像头扫码或手工粘贴六段码。',
              'Đặt con trỏ vào ô nhập mã, dùng súng quét mã quét mã QR trên thùng; cũng có thể dùng camera hoặc dán thủ công mã sáu đoạn.',
              'Focus the scan input and use the scanner gun on the QR label; camera scanning or pasting the six-segment code also works.',
            ],
            [
              '系统立刻校验四件事：格式是否正确、物料是否认可、供应商是否合格、该码是否已收过。',
              'Hệ thống kiểm tra ngay bốn điều: định dạng đúng không, vật tư có được công nhận không, nhà cung cấp có đạt không, mã này đã nhận chưa.',
              'The system immediately validates four things: format, whether the material is registered, whether the supplier is approved, and whether the code was already received.',
            ],
            [
              '校验通过则生成一张收货单，状态为「已收货」，同时库存中增加一条待检记录（锁定状态）。',
              'Nếu hợp lệ, hệ thống tạo một phiếu nhận hàng trạng thái "Đã nhận", đồng thời thêm một bản ghi chờ kiểm trong tồn kho (trạng thái khóa).',
              'On success it creates a receipt order with status "received" and adds a pending-inspection inventory record (locked).',
            ],
            [
              '继续扫下一箱。同一批次的多个箱子重复上述步骤即可。',
              'Tiếp tục quét thùng tiếp theo. Lặp lại các bước trên cho từng thùng trong cùng lô.',
              'Continue with the next box. Repeat for every box in the batch.',
            ],
          ),
          note(
            'warn',
            '收货的实物必须与二维码内容一致。系统只校验标签数据，不校验实物；贴错标签会导致账实不符。',
            'Hàng thực tế phải khớp nội dung mã QR. Hệ thống chỉ kiểm tra dữ liệu nhãn, không kiểm tra hàng thực tế; dán nhãn sai sẽ làm sổ sách lệch thực tế.',
            'The physical goods must match the QR content. The system validates label data only, not the goods; a wrong label causes a book-versus-reality mismatch.',
          ),
        ],
      },
      {
        id: 'receipt-batch',
        title: T('批次收货（一次提交多箱）', 'Nhận hàng theo lô (gửi nhiều thùng một lần)', 'Batch Receipt (Multiple Boxes at Once)'),
        blocks: [
          p(
            '当一车货有几十箱时，逐箱提交效率低。批次收货允许先把多箱录入列表，确认无误后一次性提交。',
            'Khi một xe hàng có hàng chục thùng, gửi từng thùng sẽ chậm. Nhận hàng theo lô cho phép nhập nhiều thùng vào danh sách trước, xác nhận rồi gửi một lần.',
            'When a truck carries dozens of boxes, submitting one by one is slow. Batch receipt lets you queue many boxes and submit them together after checking.',
          ),
          ol(
            [
              '进入「批次收货」，逐箱扫码，每扫一箱在列表中增加一行。',
              'Vào "Nhận hàng theo lô", quét từng thùng; mỗi lần quét thêm một dòng vào danh sách.',
              'Open Batch Receipt and scan box by box; each scan adds a row to the list.',
            ],
            [
              '检查列表：数量、批次、流水号是否正确，发现错扫的行删除重扫。',
              'Kiểm tra danh sách: số lượng, lô, số thứ tự có đúng không; xóa dòng quét sai và quét lại.',
              'Review the list for quantity, batch and serial; delete wrong rows and rescan.',
            ],
            [
              '确认全部无误后点击「提交」，系统统一生成收货单。',
              'Sau khi xác nhận không sai, bấm "Gửi"; hệ thống tạo phiếu nhận hàng hàng loạt.',
              'Click Submit to generate the receipt orders in one go.',
            ],
            [
              '若列表中或与已收货记录存在重复的六段码，整批提交会被拒绝，需要删除重复行后重新提交。',
              'Nếu trong danh sách hoặc so với bản ghi đã nhận có mã sáu đoạn trùng, toàn bộ lô sẽ bị từ chối; cần xóa dòng trùng rồi gửi lại.',
              'If any duplicate six-segment code exists in the list or against prior receipts, the whole batch is rejected — remove duplicates and resubmit.',
            ],
          ),
          note(
            'tip',
            '多人同时扫同一批货时，批次收货能避免互相打断。系统保证同一张收货单只会被创建一次。',
            'Khi nhiều người cùng quét một lô hàng, nhận hàng theo lô tránh việc giẫm chân nhau. Hệ thống đảm bảo mỗi phiếu chỉ được tạo một lần.',
            'When several people scan the same shipment, batch receipt avoids stepping on each other. The system guarantees each receipt order is created once.',
          ),
        ],
      },
      {
        id: 'receipt-list',
        title: T('收货单列表与查询', 'Danh sách phiếu nhận hàng và tra cứu', 'Receipt Order List & Search'),
        blocks: [
          ul(
            ['菜单路径：收料 → 收货单。', 'Đường dẫn: Nhận hàng → Phiếu nhận hàng.', 'Menu: Receiving → Receipt Orders.'],
            ['可按收货单号、物料、供应商、批次、日期范围筛选。', 'Lọc theo số phiếu, vật tư, nhà cung cấp, lô, khoảng ngày.', 'Filter by receipt no., material, supplier, batch or date range.'],
            ['列表显示收货单号、物料、数量、供应商、库位、状态、收货时间与操作人。', 'Danh sách hiển thị số phiếu, vật tư, số lượng, nhà cung cấp, vị trí, trạng thái, thời gian và người nhận.', 'The list shows receipt no., material, quantity, supplier, location, status, time and operator.'],
            ['状态为「已收货」的单据可勾选后提交 IQC；已提交的会显示为「待检」或「已检验」。', 'Phiếu trạng thái "Đã nhận" có thể chọn rồi gửi IQC; đã gửi sẽ hiển thị "Chờ kiểm" hoặc "Đã kiểm".', 'Orders with status "received" can be selected and submitted to IQC; submitted ones show as pending or inspected.'],
          ),
          h3('收货单状态说明', 'Giải thích trạng thái phiếu nhận hàng', 'Receipt Order Statuses'),
          table(
            [['状态', 'Trạng thái', 'Status'], ['含义', 'Ý nghĩa', 'Meaning'], ['下一步', 'Bước tiếp theo', 'Next step']],
            [
              [
                ['已收货', 'Đã nhận', 'received'],
                ['扫码成功，尚未提交质检', 'Quét thành công, chưa gửi kiểm', 'Scanned successfully, not yet submitted'],
                ['提交 IQC', 'Gửi IQC', 'Submit to IQC'],
              ],
              [
                ['待检', 'Chờ kiểm', 'pending_iqc'],
                ['已提交，等待 IQC 检验', 'Đã gửi, chờ IQC kiểm', 'Submitted, awaiting inspection'],
                ['等待检验员处理', 'Chờ nhân viên kiểm xử lý', 'Wait for the inspector'],
              ],
              [
                ['已检验 / 通过', 'Đã kiểm / Đạt', 'inspected / pass'],
                ['检验完成并合格', 'Kiểm xong và đạt', 'Inspection done and passed'],
                ['物料已进入良品仓，可被领用', 'Vật tư đã vào kho hàng tốt, có thể lĩnh', 'Material is in the good warehouse and can be picked'],
              ],
              [
                ['已检验 / 不合格', 'Đã kiểm / Không đạt', 'inspected / fail'],
                ['检验完成且不合格', 'Kiểm xong và không đạt', 'Inspection done and failed'],
                ['进入 MRB 评审流程', 'Vào quy trình đánh giá MRB', 'Enters the MRB process'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'receipt-submit',
        title: T('提交 IQC（批次合并规则）', 'Gửi IQC (quy tắc gộp lô)', 'Submitting to IQC (Batch Merging)'),
        blocks: [
          p(
            '提交 IQC 时，系统不是"一张收货单建一个检验批"，而是按下面的组合键把多张收货单合并成一个 IQC 批次：',
            'Khi gửi IQC, hệ thống không tạo "một phiếu nhận hàng = một lô kiểm" mà gộp nhiều phiếu nhận hàng thành một lô IQC theo khóa tổ hợp sau:',
            'When submitting to IQC, the system does not create one inspection lot per receipt order; it merges them by this composite key:',
          ),
          note(
            'info',
            '合并键 = 物料 + 供应商 + 生产日期 + 批次号 + 收货日期',
            'Khóa gộp = Vật tư + Nhà cung cấp + Ngày sản xuất + Số lô + Ngày nhận hàng',
            'Merge key = Material + Supplier + Production Date + Batch No. + Receipt Date',
          ),
          p(
            '也就是说：同一物料的同一批次，只要在同一天收货，就会合并成同一个 IQC 批次，检验员只需检验一次。',
            'Nghĩa là: cùng vật tư, cùng lô, nếu nhận trong cùng một ngày sẽ gộp thành cùng một lô IQC; nhân viên kiểm chỉ cần kiểm một lần.',
            'So the same material and batch received on the same day merges into one IQC lot, inspected only once.',
          ),
          note(
            'warn',
            '并发提交已被系统保护：多人同时对同一批次点提交，只会创建一个 IQC 批次，不会重复建批。',
            'Gửi đồng thời đã được bảo vệ: nhiều người cùng gửi một lô chỉ tạo một lô IQC, không tạo trùng.',
            'Concurrent submission is protected: many users submitting the same batch create only one IQC lot.',
          ),
        ],
      },
      {
        id: 'receipt-return',
        title: T('退料单收货（生产退料）', 'Nhận hàng hoàn trả (hoàn vật tư sản xuất)', 'Production Return Receipt'),
        blocks: [
          p(
            '生产线用不完的物料退回仓库时，走「退料单收货」，而不是普通扫码收货。这类物料已经过 IQC，不需要重新检验。',
            'Khi dây chuyền trả vật tư dùng không hết về kho, dùng "Nhận hàng hoàn trả" chứ không phải quét mã nhận hàng thường. Loại vật tư này đã qua IQC, không cần kiểm lại.',
            'When the line returns unused material to the warehouse, use Production Return Receipt rather than a normal scan. This material already passed IQC and is not re-inspected.',
          ),
          ul(
            ['菜单路径：收料 → 退料单。', 'Đường dẫn: Nhận hàng → Phiếu hoàn trả.', 'Menu: Receiving → Production Return.'],
            ['退料数量不能超过该工单已领用数量。', 'Số lượng hoàn trả không được vượt số đã lĩnh của lệnh sản xuất.', 'The return quantity cannot exceed what was picked for that work order.'],
            ['退料入库后，库存回到良品仓，可再次被领用。', 'Sau khi nhập kho hoàn trả, tồn kho về kho hàng tốt và có thể lĩnh lại.', 'After the return is stored, stock goes back to the good warehouse and can be picked again.'],
          ),
        ],
      },
    ],
  },

  // ================================================================ 6 IQC
  {
    id: 'iqc',
    icon: 'clipboard-check',
    title: T('IQC 来料检验', 'IQC Kiểm tra hàng đến', 'IQC Incoming Inspection'),
    summary: T(
      '物料只有通过 IQC 才能被领用。本章讲检验流程、严格度规则、免检确认与超期复检。',
      'Chỉ vật tư đạt IQC mới được lĩnh. Chương này trình bày quy trình kiểm, quy tắc mức độ nghiêm ngặt, xác nhận miễn kiểm và kiểm lại khi quá hạn.',
      'Only material that passes IQC can be picked. This chapter covers the inspection flow, strictness rules, exemption confirmation and expiry re-inspection.',
    ),
    sections: [
      {
        id: 'iqc-flow',
        title: T('检验流程图', 'Sơ đồ quy trình kiểm', 'Inspection Flow'),
        blocks: [
          flow(
            ['待检批次', 'Lô chờ kiểm', 'Pending lot'],
            ['录入检验结果', 'Nhập kết quả', 'Enter results'],
            ['判定合格', 'Kết luận đạt', 'Verdict: pass'],
            ['解锁库存', 'Mở khóa tồn kho', 'Unlock stock'],
            ['可被领用', 'Có thể lĩnh', 'Available for picking'],
          ),
          p(
            '若判定不合格，物料不会被解锁，而是转入不良品仓并进入 MRB 评审（见「MRB 评审」章节）。',
            'Nếu kết luận không đạt, vật tư không được mở khóa mà chuyển vào kho hàng lỗi và vào đánh giá MRB (xem chương "Đánh giá MRB").',
            'If the verdict is fail, material is not unlocked; it moves to the defective warehouse and enters MRB review (see the MRB chapter).',
          ),
        ],
      },
      {
        id: 'iqc-pending',
        title: T('待检与录入检验结果', 'Chờ kiểm và nhập kết quả', 'Pending & Entering Results'),
        blocks: [
          ol(
            [
              '菜单路径：IQC → 待检。列表显示所有等待检验的批次。',
              'Đường dẫn: IQC → Chờ kiểm. Danh sách hiển thị mọi lô đang chờ kiểm.',
              'Menu: IQC → Pending. The list shows every lot awaiting inspection.',
            ],
            [
              '点击某一行进入检验页面，逐项录入检验数据。检验项目来自该物料的检验模板。',
              'Bấm một dòng để vào trang kiểm, nhập dữ liệu kiểm theo từng mục. Hạng mục kiểm lấy từ mẫu kiểm của vật tư.',
              'Click a row to open the inspection page and enter data item by item. Items come from the material inspection template.',
            ],
            [
              '需要增删检验项或改用另一套标准时，点右上角「切换模板」重新选择；选定新模板后按新模板重建检验项，旧模板下已填写的内容不再带入（点「取消切换」可保留原数据）。',
              'Khi cần thêm/bớt hạng mục hoặc dùng bộ tiêu chuẩn khác, bấm "Đổi mẫu" ở góc trên phải để chọn lại; sau khi chọn, hạng mục được tạo lại theo mẫu mới và dữ liệu đã nhập của mẫu cũ không được mang sang (bấm "Hủy" để giữ nguyên).',
              'To add/remove items or use another standard set, click Switch template at the top right. Items are rebuilt from the new template and data entered under the old one is not carried over (click Cancel to keep it).',
            ],
            [
              '录入完成后提交，系统按检验标准自动判定合格或不合格。',
              'Sau khi nhập xong, gửi đi; hệ thống tự động kết luận đạt hoặc không đạt theo tiêu chuẩn kiểm.',
              'Submit when done; the system applies the inspection standard to decide pass or fail.',
            ],
            [
              '判定合格：库存解锁，物料进入良品仓，收货单状态更新，欠料自动冲减。',
              'Kết luận đạt: tồn kho mở khóa, vật tư vào kho hàng tốt, trạng thái phiếu cập nhật, nợ vật tư tự động ghi giảm.',
              'Verdict pass: stock unlocks, material enters the good warehouse, the receipt order updates and supplier debt is offset.',
            ],
            [
              '判定不合格：物料进入不良品仓，同时产生供应商欠料记录，等待 MRB 评审。',
              'Kết luận không đạt: vật tư vào kho hàng lỗi, đồng thời sinh bản ghi nợ vật tư nhà cung cấp, chờ đánh giá MRB.',
              'Verdict fail: material enters the defective warehouse and supplier debt is created, awaiting MRB review.',
            ],
          ),
          note(
            'warn',
            '审批是幂等的：同一份检验报告重复审批不会重复冲减欠料。但仍建议按实际检验次数提交，避免数据混乱。',
            'Phê duyệt là bất biến (idempotent): duyệt lặp cùng một báo cáo không ghi giảm nợ hai lần. Tuy vậy vẫn nên gửi theo số lần kiểm thực tế để tránh dữ liệu rối.',
            'Approval is idempotent: approving the same report twice does not offset debt twice. Still, submit according to actual inspections to avoid confusion.',
          ),
        ],
      },
      {
        id: 'iqc-spec',
        title: T('SPEC 规格识别（超差自动判定）', 'Nhận dạng quy cách SPEC (tự động phán định vượt quy cách)', 'SPEC Recognition (Automatic Out-of-Spec Judging)'),
        blocks: [
          p(
            '「SPEC」是检验项目上填写的规格表达式。系统会自动把它解析成上限（USL）与下限（LSL），再与检验员录入的每个测量值比对，自动统计不良数并判定合格与否。因此规格怎么写，直接决定判定结果。',
            '"SPEC" là biểu thức quy cách nhập cho hạng mục kiểm. Hệ thống tự động phân tích thành giới hạn trên (USL) và giới hạn dưới (LSL), rồi so với từng giá trị đo để tự động đếm số lượng lỗi và phán định đạt/không đạt. Vì vậy cách viết quy cách quyết định trực tiếp kết quả phán định.',
            '"SPEC" is the specification expression entered on an inspection item. The system parses it into an upper limit (USL) and a lower limit (LSL), compares it against every measured value, counts defects automatically and decides pass/fail. How you write the spec therefore directly determines the verdict.',
          ),
          note(
            'info',
            '填写位置：IQC → 检验模板（或标准库）里每个检验项的「SPEC / 规格」输入框。检验页面录入测量值时，右侧会自动标红超差的数值。',
            'Vị trí nhập: ô "SPEC / quy cách" của từng hạng mục trong IQC → Mẫu kiểm (hoặc Thư viện tiêu chuẩn). Khi nhập giá trị đo ở trang kiểm, giá trị vượt quy cách sẽ tự động hiện đỏ bên phải.',
            'Where to enter: the "SPEC" field of each item under IQC → Inspection Template (or Standard Library). While entering measurements, out-of-spec values are highlighted in red automatically.',
          ),

          h3('一、支持的 7 类表达方式（附实测结果）', 'I. 7 nhóm biểu thức được hỗ trợ (kèm kết quả thực đo)', 'I. The 7 Supported Formats (with measured results)'),
          p(
            '下表为各类写法的实测解析结果。解析成功即启用自动判定；解析失败则系统不自动判超差，由检验员手动选择 Pass/Fail。',
            'Bảng dưới là kết quả phân tích thực đo của từng cách viết. Phân tích thành công thì bật phán định tự động; thất bại thì hệ thống không tự phán định, nhân viên kiểm chọn Pass/Fail thủ công.',
            'The table below lists measured parsing results for each format. A successful parse enables automatic judging; on failure the system does not auto-judge and the inspector chooses Pass/Fail manually.',
          ),

          h3('第 1 类 · 文字描述（单边限）', 'Nhóm 1 · Mô tả bằng chữ (giới hạn một phía)', 'Group 1 · Text Description (Single Limit)'),
          table(
            [['你填写的 SPEC', 'Tác dụng', 'Effect'], ['解析结果', 'Kết quả', 'Parsed as'], ['等于边界值时', 'Khi bằng giá trị biên', 'At the boundary value']],
            [
              [
                ['不小于 5 / 不低于 5', 'Không nhỏ hơn 5', 'Not less than 5'],
                ['下限 5（含）', 'Cận dưới 5 (bao gồm)', 'LSL = 5, inclusive'],
                ['合格', 'Đạt', 'Pass'],
              ],
              [
                ['不大于 5 / 不高于 5', 'Không lớn hơn 5', 'Not greater than 5'],
                ['上限 5（含）', 'Cận trên 5 (bao gồm)', 'USL = 5, inclusive'],
                ['合格', 'Đạt', 'Pass'],
              ],
              [
                ['大于 5 / 高于 5', 'Lớn hơn 5', 'Greater than 5'],
                ['下限 5（不含）', 'Cận dưới 5 (không gồm)', 'LSL = 5, exclusive'],
                ['判超差（NG）', 'Vượt quy cách (NG)', 'Out of spec (NG)'],
              ],
              [
                ['小于 5 / 低于 5', 'Nhỏ hơn 5', 'Less than 5'],
                ['上限 5（不含）', 'Cận trên 5 (không gồm)', 'USL = 5, exclusive'],
                ['判超差（NG）', 'Vượt quy cách (NG)', 'Out of spec (NG)'],
              ],
            ],
          ),
          p(
            '带单位或前置文字也没问题：「直径不小于10」「厚度不低于 0.8 mm」都能正确取到数字。',
            'Có đơn vị hoặc chữ phía trước cũng không sao: "đường kính không nhỏ hơn 10", "độ dày không thấp hơn 0.8 mm" đều lấy đúng số.',
            'Units or leading text are fine: "diameter not less than 10" or "thickness not lower than 0.8 mm" both extract the number correctly.',
          ),

          h3('第 2 类 · 不等号（区分含不含边界）', 'Nhóm 2 · Dấu bất đẳng thức (phân biệt bao gồm/không bao gồm biên)', 'Group 2 · Inequality Signs (inclusive vs exclusive)'),
          table(
            [['你填写的 SPEC', 'Tác dụng', 'Effect'], ['解析结果', 'Kết quả', 'Parsed as'], ['= 5 时', 'Khi = 5', 'At value 5']],
            [
              [
                ['≥5 或 >=5', 'Không nhỏ hơn 5', 'Greater or equal'],
                ['下限 5（含）', 'Cận dưới 5 (bao gồm)', 'LSL = 5, inclusive'],
                ['合格', 'Đạt', 'Pass'],
              ],
              [
                ['≤5 或 <=5', 'Không lớn hơn 5', 'Less or equal'],
                ['上限 5（含）', 'Cận trên 5 (bao gồm)', 'USL = 5, inclusive'],
                ['合格', 'Đạt', 'Pass'],
              ],
              [
                ['＞5 或 >5', 'Lớn hơn 5', 'Greater than'],
                ['下限 5（不含）', 'Cận dưới 5 (không gồm)', 'LSL = 5, exclusive'],
                ['判超差（NG）', 'Vượt quy cách (NG)', 'Out of spec (NG)'],
              ],
              [
                ['＜5 或 <5', 'Nhỏ hơn 5', 'Less than'],
                ['上限 5（不含）', 'Cận trên 5 (không gồm)', 'USL = 5, exclusive'],
                ['判超差（NG）', 'Vượt quy cách (NG)', 'Out of spec (NG)'],
              ],
            ],
          ),
          note(
            'warn',
            '半角与全角是两套不同含义，别混用：「≤ ≤」是「含边界」，「＜ ＜」是「不含边界」。这个区别在检验结论上会直接导致同一批料一批判合格、一批判不合格。',
            'Nửa rộng và toàn rộng mang nghĩa khác nhau, đừng lẫn: "≤" là bao gồm biên, "＜" là không bao gồm biên. Khác biệt này trực tiếp làm cùng một lô có thể lúc đạt lúc không đạt.',
            'Half-width and full-width signs mean different things: ≤ includes the boundary, ＜ excludes it. Mixing them can make the same lot pass in one inspection and fail in another.',
          ),

          h3('第 3 类 · 范围值（最常用）', 'Nhóm 3 · Khoảng giá trị (dùng nhiều nhất)', 'Group 3 · Range Values (most common)'),
          p(
            '上下限之间可用 6 种连接符：半角减号 -、波浪号 ~、全角波浪号 ～、中文「到」、破折号 — / –、中文逗号，。以下写法结果完全等价：',
            'Giữa hai giới hạn có thể dùng 6 ký tự nối: dấu trừ -, dấu ngã ~, dấu ngã toàn rộng ～, chữ "到", gạch ngang — / –, dấu phẩy tiếng Trung. Các cách viết sau hoàn toàn tương đương:',
            'Six separators are accepted between limits: hyphen -, tilde ~, full-width tilde ～, the word 到, dashes — / –, and the Chinese comma. All of these are equivalent:',
          ),
          table(
            [['写法示例', 'Cách viết', 'Example'], ['解析结果', 'Kết quả', 'Parsed as']],
            [
              [
                ['3-5 ｜ 3~5 ｜ 3～5', '3-5 ｜ 3~5 ｜ 3～5', '3-5 | 3~5 | 3～5'],
                ['下限 3、上限 5', 'Cận dưới 3, cận trên 5', 'LSL = 3, USL = 5'],
              ],
              [
                ['3到5 ｜ 3 — 5 ｜ 3–5', '3到5 ｜ 3 — 5 ｜ 3–5', '3 to 5 | 3 — 5 | 3–5'],
                ['下限 3、上限 5', 'Cận dưới 3, cận trên 5', 'LSL = 3, USL = 5'],
              ],
              [
                ['3，5', '3，5', '3，5'],
                ['下限 3、上限 5', 'Cận dưới 3, cận trên 5', 'LSL = 3, USL = 5'],
              ],
              [
                ['5-3（写反了）', '5-3 (viết ngược)', '5-3 (reversed)'],
                ['自动纠正为 3~5', 'Tự sửa thành 3~5', 'Auto-corrected to 3~5'],
              ],
              [
                ['0.8-1.2mm', '0.8-1.2mm', '0.8-1.2mm'],
                ['带单位，正常解析', 'Có đơn vị, phân tích bình thường', 'With unit, parsed normally'],
              ],
            ],
          ),

          h3('第 4 类 · 正负公差 ±', 'Nhóm 4 · Dung sai cộng trừ ±', 'Group 4 · Plus/Minus Tolerance'),
          p(
            '支持绝对值与百分比两种写法，百分比按基准值换算：',
            'Hỗ trợ giá trị tuyệt đối và phần trăm; phần trăm quy đổi theo giá trị cơ sở:',
            'Both absolute and percentage forms are supported; percentages are converted against the nominal value:',
          ),
          table(
            [['你填写的 SPEC', 'Tác dụng', 'Effect'], ['换算后的上下限', 'Giới hạn sau quy đổi', 'Converted limits']],
            [
              [
                ['10±0.5', '10±0.5', '10±0.5'],
                ['9.5 ~ 10.5', '9.5 ~ 10.5', '9.5 ~ 10.5'],
              ],
              [
                ['10 ± 2（带空格）', '10 ± 2 (có dấu cách)', '10 ± 2 (with spaces)'],
                ['8 ~ 12', '8 ~ 12', '8 ~ 12'],
              ],
              [
                ['10±0.5%', '10±0.5%', '10±0.5%'],
                ['9.95 ~ 10.05', '9.95 ~ 10.05', '9.95 ~ 10.05'],
              ],
              [
                ['100±1%（百分比）', '100±1% (phần trăm)', '100±1% (percent)'],
                ['99 ~ 101', '99 ~ 101', '99 ~ 101'],
              ],
              [
                ['1.2±0.1mm', '1.2±0.1mm', '1.2±0.1mm'],
                ['1.1 ~ 1.3（带单位）', '1.1 ~ 1.3 (có đơn vị)', '1.1 ~ 1.3 (with unit)'],
              ],
            ],
          ),

          h3('第 5 类 · 上下偏差（工程图纸写法）', 'Nhóm 5 · Sai lệch trên dưới (kiểu bản vẽ kỹ thuật)', 'Group 5 · Deviation Pairs (drawing style)'),
          p(
            '格式为「基准值(上偏差/下偏差)」，括号内用 / 或 , 分隔，不写正负号默认按正数叠加：',
            'Định dạng "giá trị cơ sở (sai lệch trên/sai lệch dưới)", trong ngoặc dùng / hoặc , để phân cách; không ghi dấu thì mặc định cộng số dương:',
            'Format is "nominal (upper deviation/lower deviation)", separated by / or , inside the parentheses; an unsigned number is added as positive:',
          ),
          table(
            [['你填写的 SPEC', 'Tác dụng', 'Effect'], ['换算后的上下限', 'Giới hạn sau quy đổi', 'Converted limits']],
            [
              [
                ['10(+0.5/-0.2)', '10(+0.5/-0.2)', '10(+0.5/-0.2)'],
                ['9.8 ~ 10.5', '9.8 ~ 10.5', '9.8 ~ 10.5'],
              ],
              [
                ['10.5(+0.3/-0.3)', '10.5(+0.3/-0.3)', '10.5(+0.3/-0.3)'],
                ['10.2 ~ 10.8（对称公差）', '10.2 ~ 10.8 (dung sai đối xứng)', '10.2 ~ 10.8 (symmetric)'],
              ],
              [
                ['10(+0.5,+0.2)', '10(+0.5,+0.2)', '10(+0.5,+0.2)'],
                ['10.2 ~ 10.5（都用逗号）', '10.2 ~ 10.5 (dùng dấu phẩy)', '10.2 ~ 10.5 (comma separated)'],
              ],
              [
                ['10(+0.5/0.2)（下偏差漏写+）', '10(+0.5/0.2) (thiếu dấu + ở dưới)', '10(+0.5/0.2) (missing +)'],
                ['10.2 ~ 10.5（自动按正数）', '10.2 ~ 10.5 (tự coi là dương)', '10.2 ~ 10.5 (treated positive)'],
              ],
            ],
          ),
          note(
            'warn',
            '下偏差必须带减号。「10(+0.5/0.2)」会被当成「+0.5 与 +0.2」，算出 10.2~10.5 —— 这与图纸本意「10.2 ~ 10.5」看似巧合一致，但若想表达「+0.5 / -0.2」务必写成「10(+0.5/-0.2)」。',
            'Sai lệch dưới phải có dấu trừ. "10(+0.5/0.2)" bị hiểu là "+0.5 và +0.2", ra 10.2~10.5. Muốn biểu diễn "+0.5 / -0.2" bắt buộc viết "10(+0.5/-0.2)".',
            'The lower deviation must carry a minus sign. "10(+0.5/0.2)" is read as "+0.5 and +0.2" giving 10.2~10.5. To express "+0.5 / -0.2" you must write "10(+0.5/-0.2)".',
          ),

          h3('第 6 类 · MAX / MIN 标注', 'Nhóm 6 · Ký hiệu MAX / MIN', 'Group 6 · MAX / MIN Markers'),
          p(
            'MAX 与 MIN 不分大小写、可放数字前后，带空格或无空格都能识别：',
            'MAX và MIN không phân biệt hoa thường, đặt trước hoặc sau số, có dấu cách hay không đều nhận được:',
            'MAX and MIN are case-insensitive, may precede or follow the number, with or without spaces:',
          ),
          table(
            [['你填写的 SPEC', 'Tác dụng', 'Effect'], ['解析结果', 'Kết quả', 'Parsed as']],
            [
              [
                ['100MAX ｜ MAX100 ｜ max 100', '100MAX ｜ MAX100 ｜ max 100', '100MAX | MAX100 | max 100'],
                ['上限 100', 'Cận trên 100', 'USL = 100'],
              ],
              [
                ['100MIN ｜ min. 5 ｜ 5MIN', '100MIN ｜ min. 5 ｜ 5MIN', '100MIN | min. 5 | 5MIN'],
                ['下限（取该数字）', 'Cận dưới (lấy số đó)', 'LSL = that number'],
              ],
            ],
          ),

          h3('第 7 类 · 科学计数法', 'Nhóm 7 · Ký hiệu khoa học', 'Group 7 · Scientific Notation'),
          p(
            '用 ^ 表示乘方，可与其他写法组合：',
            'Dùng ^ để biểu diễn lũy thừa, có thể kết hợp với cách viết khác:',
            'Use ^ for powers; it can combine with other formats:',
          ),
          table(
            [['你填写的 SPEC', 'Tác dụng', 'Effect'], ['解析结果', 'Kết quả', 'Parsed as']],
            [
              [
                ['10^9', '10^9', '10^9'],
                ['1000000000（单个值 → 不判定）', '1000000000 (một giá trị → không phán định)', '1000000000 (single value → no judging)'],
              ],
              [
                ['1.5^3-2.5^3', '1.5^3-2.5^3', '1.5^3-2.5^3'],
                ['3.375 ~ 15.625', '3.375 ~ 15.625', '3.375 ~ 15.625'],
              ],
              [
                ['10^9 ± 10^8', '10^9 ± 10^8', '10^9 ± 10^8'],
                ['900000000 ~ 1100000000', '900000000 ~ 1100000000', '900000000 ~ 1100000000'],
              ],
            ],
          ),

          h3('二、两个自动容错规则', 'II. Hai quy tắc tự động chịu lỗi', 'II. Two Automatic Fault-Tolerance Rules'),
          ul(
            [
              '欧式逗号小数点：「3.15-4,15」自动理解为 3.15 ~ 4.15。规则是逗号后跟 1~2 位数字视为小数点。',
              'Dấu phẩy thập phân kiểu Âu: "3.15-4,15" tự hiểu là 3.15 ~ 4.15. Quy tắc: dấu phẩy theo sau 1~2 chữ số được coi là dấu thập phân.',
              'European decimal comma: "3.15-4,15" is understood as 3.15 ~ 4.15. A comma followed by 1–2 digits is treated as a decimal point.',
            ],
            [
              '千分位逗号：「1,000-2,000」自动理解为 1000 ~ 2000。规则是逗号后跟恰好 3 位数字视为千分位并剥离。',
              'Dấu phẩy phân cách nghìn: "1,000-2,000" tự hiểu là 1000 ~ 2000. Dấu phẩy theo sau đúng 3 chữ số được coi là phân cách nghìn và bị bỏ.',
              'Thousands separator: "1,000-2,000" is understood as 1000 ~ 2000. A comma followed by exactly 3 digits is treated as a thousands separator and stripped.',
            ],
          ),
          note(
            'warn',
            '这两条规则靠「逗号后几位数字」区分，因此不要用逗号表达其他含义。若上下限本身精度需要 3 位小数且用逗号书写（如「3,150-4,150」），会被当成千分位解析成 3150~4150。建议小数一律用小数点。',
            'Hai quy tắc này phân biệt bằng "số chữ số sau dấu phẩy", nên đừng dùng dấu phẩy với nghĩa khác. Nếu giới hạn cần 3 chữ số thập phân mà viết bằng dấu phẩy (như "3,150-4,150") sẽ bị hiểu là phân cách nghìn thành 3150~4150. Nên luôn dùng dấu chấm thập phân.',
            'These rules key off the digit count after the comma, so do not use the comma for other purposes. If a limit genuinely needs three decimals written with a comma (e.g. "3,150-4,150") it will be read as a thousands separator and become 3150~4150. Always use a period for decimals.',
          ),

          h3('三、不支持的写法（会解析失败）', 'III. Cách viết không hỗ trợ (phân tích thất bại)', 'III. Unsupported Formats (parse failure)'),
          p(
            '以下写法解析失败。失败时系统不会自动判超差，测量值不会标红，改由检验员手动选择结论：',
            'Các cách viết sau phân tích thất bại. Khi thất bại, hệ thống không tự phán định, giá trị đo không hiện đỏ, nhân viên kiểm tự chọn kết luận:',
            'The following formats fail to parse. On failure the system does not auto-judge, values are not highlighted, and the inspector selects the verdict manually:',
          ),
          table(
            [['不支持的写法', 'Cách viết không hỗ trợ', 'Unsupported'], ['原因', 'Nguyên nhân', 'Reason'], ['报错 / 结果', 'Kết quả', 'Result']],
            [
              [
                ['5', '5', '5'],
                ['只有一个数，无法判断是上限还是下限', 'Chỉ một số, không biết là cận trên hay dưới', 'A single number is ambiguous'],
                ['提示「请指定公差或上下限」', 'Báo "hãy chỉ định dung sai hoặc giới hạn"', '"Specify tolerance or limits"'],
              ],
              [
                ['外观无划痕', 'Ngoại quan không trầy xước', 'No scratches on appearance'],
                ['纯文字、不含数字，无法量化', 'Thuần chữ, không có số, không định lượng được', 'Pure text with no number'],
                ['提示「无法识别的规格格式」', 'Báo "định dạng quy cách không nhận dạng được"', '"Unrecognized spec format"'],
              ],
              [
                ['5≤X≤10 ｜ 0.5≤X≤1.2', '5≤X≤10 ｜ 0.5≤X≤1.2', '5≤X≤10 | 0.5≤X≤1.2'],
                ['区间加变量的写法不识别', 'Cách viết khoảng kèm biến không nhận được', 'Interval-with-variable form not supported'],
                ['解析失败', 'Phân tích thất bại', 'Parse failure'],
              ],
              [
                ['直径≥5 ｜ L≥5', 'Đường kính≥5 ｜ L≥5', 'Diameter≥5 | L≥5'],
                ['不等号必须写在最前面', 'Dấu bất đẳng thức phải ở đầu', 'The inequality sign must come first'],
                ['解析失败', 'Phân tích thất bại', 'Parse failure'],
              ],
              [
                ['100+0.5/-0.2（无括号）', '100+0.5/-0.2 (không ngoặc)', '100+0.5/-0.2 (no parentheses)'],
                ['偏差必须用括号包裹', 'Sai lệch phải đặt trong ngoặc', 'Deviations must be wrapped in parentheses'],
                ['解析失败', 'Phân tích thất bại', 'Parse failure'],
              ],
              [
                ['10mm±0.5mm（数字后带单位再写±）', '10mm±0.5mm (đơn vị xen giữa)', '10mm±0.5mm (unit in the middle)'],
                ['± 前必须是纯数字，夹单位会断裂', 'Trước ± phải là số thuần, chèn đơn vị sẽ đứt', 'A unit before ± breaks the match'],
                ['解析失败', 'Phân tích thất bại', 'Parse failure'],
              ],
              [
                ['10±０.５（全角数字）', '10±０.５ (số toàn rộng)', '10±０.５ (full-width digits)'],
                ['只认半角数字，全角不转', 'Chỉ nhận số nửa rộng, toàn rộng không chuyển', 'Only half-width digits are recognized'],
                ['解析失败', 'Phân tích thất bại', 'Parse failure'],
              ],
            ],
          ),
          note(
            'warn',
            '「表面不允许大于0.5mm划痕」这类带否定词的描述会被识别成「大于 0.5」而启用下限判定 —— 但语义其实完全相反。文字描述规格时请避免使用「不允许大于 / 不得小于」这类句式，直接写数值范围。',
            '"Bề mặt không cho phép vết xước lớn hơn 0.5mm" sẽ bị nhận thành "lớn hơn 0.5" và bật phán định cận dưới — trong khi nghĩa thực tế ngược lại. Khi mô tả bằng chữ, tránh dùng câu phủ định kiểu "không cho phép lớn hơn"; hãy viết thẳng khoảng số.',
            'Descriptions with negation such as "no scratch greater than 0.5mm" are read as "greater than 0.5" and enable a lower-limit rule — the opposite of the intent. Avoid negated phrasing in text specs; write the numeric range directly.',
          ),

          h3('四、判定优先级与短路行为', 'IV. Thứ tự ưu tiên và hành vi dừng sớm', 'IV. Precedence and Short-Circuit Behavior'),
          p(
            '系统按固定顺序自上而下匹配，命中即返回，不再继续尝试后面的规则。这个顺序带来一个必须注意的后果：',
            'Hệ thống khớp từ trên xuống theo thứ tự cố định, khớp là trả về ngay, không thử tiếp các quy tắc sau. Thứ tự này gây ra một hệ quả cần lưu ý:',
            'The system matches top-down in a fixed order and returns on the first hit without trying later rules. This order has an important consequence:',
          ),
          flow(
            [
              '① 文字单边（不小于/不大于/大于/小于）',
              '① Mô tả một phía bằng chữ',
              '① Text single limit',
            ],
            ['② 范围（- ~ ～ 到 — ，）', '② Khoảng giá trị', '② Range'],
            ['③ 不等号（≤ ≥ ＜ ＞ <= >= < >）', '③ Bất đẳng thức', '③ Inequality'],
            ['④ MAX / MIN', '④ MAX / MIN', '④ MAX / MIN'],
            ['⑤ ± 公差', '⑤ Dung sai ±', '⑤ ± tolerance'],
            ['⑥ 上下偏差 (a/b)', '⑥ Sai lệch trên dưới', '⑥ Deviation pair'],
          ),
          note(
            'warn',
            '若规格字符串里同时出现范围与文字描述，文字描述会抢先命中并吃掉第一个数字。实测「不小于5且不大于10」只解析出「下限 5」，上限 10 被丢弃 —— 系统不会自动判上限超差。所以一条 SPEC 只写一个条件，需要双边界时用范围写法（如 5-10）。',
            'Nếu chuỗi quy cách chứa cả khoảng và mô tả chữ, mô tả chữ sẽ khớp trước và lấy số đầu tiên. Thực đo "không nhỏ hơn 5 và không lớn hơn 10" chỉ ra "cận dưới 5", cận trên 10 bị bỏ — hệ thống không tự phán định vượt cận trên. Vì vậy mỗi SPEC chỉ viết một điều kiện; cần hai biên thì dùng khoảng (ví dụ 5-10).',
            'If a spec string contains both a range and text, the text rule wins and consumes the first number. Measured: "not less than 5 and not greater than 10" yields only "LSL = 5" and the upper limit 10 is dropped — the system will not flag an upper-limit violation. Write one condition per SPEC; for two bounds use a range (e.g. 5-10).',
          ),

          h3('五、判定与不良数统计规则', 'V. Quy tắc phán định và đếm số lỗi', 'V. Judging and Defect Counting Rules'),
          ul(
            [
              '逐个测量值比对上下限，超出即计一个不良；空值与非数值自动跳过，不计入分母也不计不良。',
              'So từng giá trị đo với giới hạn; vượt là tính một lỗi; giá trị rỗng và không phải số tự động bỏ qua.',
              'Each measured value is compared against the limits; a violation counts as one defect. Empty and non-numeric entries are skipped.',
            ],
            [
              'SPEC 解析失败时不做自动判定，该项目的结论完全由检验员手动选择，不会因为「无法解析」而误判合格。',
              'Khi SPEC phân tích thất bại thì không tự phán định; kết luận do nhân viên kiểm chọn, không bị phán đạt sai do "không phân tích được".',
              'When the SPEC fails to parse there is no automatic judging; the verdict is chosen manually and will not be wrongly passed due to a parse failure.',
            ],
            [
              '整体结论按 GB/T 2828.1：不良数 ≤ Ac 判接收，不良数 ≥ Re 判拒收；Ac = 0 时要求零不良。',
              'Kết luận chung theo GB/T 2828.1: số lỗi ≤ Ac là nhận, ≥ Re là loại; Ac = 0 nghĩa là không cho phép lỗi.',
              'The overall verdict follows GB/T 2828.1: defects ≤ Ac accept, ≥ Re reject; Ac = 0 requires zero defects.',
            ],
            [
              '切换到检验页面或恢复草稿时系统会重算不良数与结论，历史数据中按旧规则算错的值会被自动纠正。',
              'Khi mở trang kiểm hoặc khôi phục bản nháp, hệ thống tính lại số lỗi và kết luận; dữ liệu cũ tính sai sẽ tự sửa.',
              'Opening the inspection page or restoring a draft recomputes defects and verdict, auto-correcting values mis-calculated under older rules.',
            ],
          ),

          h3('六、推荐写法速查', 'VI. Cách viết khuyến nghị', 'VI. Recommended Formats'),
          table(
            [['需求', 'Nhu cầu', 'Requirement'], ['推荐写法', 'Cách viết khuyến nghị', 'Recommended'], ['说明', 'Ghi chú', 'Note']],
            [
              [
                ['双向对称公差', 'Dung sai đối xứng hai phía', 'Symmetric tolerance'],
                ['10±0.5', '10±0.5', '10±0.5'],
                ['最简洁，优先使用', 'Ngắn gọn nhất, ưu tiên dùng', 'Simplest, use first'],
              ],
              [
                ['双向不等公差', 'Dung sai hai phía không đối xứng', 'Asymmetric tolerance'],
                ['10(+0.5/-0.2)', '10(+0.5/-0.2)', '10(+0.5/-0.2)'],
                ['下偏差必须带减号', 'Sai lệch dưới phải có dấu trừ', 'Lower deviation must be negative'],
              ],
              [
                ['只有下限', 'Chỉ cận dưới', 'Lower bound only'],
                ['不小于10', 'Không nhỏ hơn 10', 'Not less than 10'],
                ['比写 ≥10 更直观', 'Trực quan hơn ≥10', 'Clearer than ≥10'],
              ],
              [
                ['只有上限', 'Chỉ cận trên', 'Upper bound only'],
                ['不大于10', 'Không lớn hơn 10', 'Not greater than 10'],
                ['注意含边界', 'Lưu ý bao gồm biên', 'Boundary is inclusive'],
              ],
              [
                ['上下限区间', 'Khoảng hai giới hạn', 'Two-sided range'],
                ['10-20', '10-20', '10-20'],
                ['不要写成一个 SPEC 两条文字条件', 'Đừng viết hai điều kiện chữ trong một SPEC', 'Do not put two text conditions in one SPEC'],
              ],
              [
                ['外观等定性项目', 'Hạng mục định tính như ngoại quan', 'Qualitative items like appearance'],
                ['留空，手动判定', 'Để trống, phán định thủ công', 'Leave blank, judge manually'],
                ['填文字会导致解析失败', 'Điền chữ sẽ làm phân tích thất bại', 'Text will cause a parse failure'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'iqc-strictness',
        title: T('检验严格度（加严 / 放宽 / 免检 / 暂停）', 'Mức độ nghiêm ngặt (siết chặt / nới lỏng / miễn kiểm / tạm dừng)', 'Inspection Strictness'),
        blocks: [
          p(
            '为平衡质量与效率，系统按供应商的历史表现自动调整检验力度。严格度分五档：',
            'Để cân bằng chất lượng và hiệu quả, hệ thống tự điều chỉnh mức kiểm theo lịch sử nhà cung cấp. Có năm mức:',
            'To balance quality and efficiency, the system adjusts inspection intensity by supplier history. There are five levels:',
          ),
          table(
            [['严格度', 'Mức nghiêm ngặt', 'Strictness'], ['含义', 'Ý nghĩa', 'Meaning'], ['适用场景', 'Tình huống áp dụng', 'Applicable scenario']],
            [
              [
                ['加严', 'Siết chặt', 'tightened'],
                ['抽检比例提高、检验项增多', 'Tăng tỷ lệ lấy mẫu, tăng hạng mục kiểm', 'Higher sampling ratio, more items'],
                ['近期出现不合格，需重点盯防', 'Gần đây có hàng không đạt, cần giám sát trọng điểm', 'Recent failures need close monitoring'],
              ],
              [
                ['正常', 'Bình thường', 'normal'],
                ['标准检验力度', 'Mức kiểm tiêu chuẩn', 'Standard inspection level'],
                ['默认状态', 'Trạng thái mặc định', 'Default state'],
              ],
              [
                ['放宽', 'Nới lỏng', 'reduced'],
                ['抽检比例降低', 'Giảm tỷ lệ lấy mẫu', 'Lower sampling ratio'],
                ['连续多批合格，表现稳定', 'Nhiều lô liên tiếp đạt, ổn định', 'Several consecutive passes, stable performance'],
              ],
              [
                ['免检', 'Miễn kiểm', 'exempt'],
                ['物料免检，可直接确认通过', 'Vật tư miễn kiểm, có thể xác nhận đạt trực tiếp', 'Material exempt; can confirm pass directly'],
                ['长期稳定且经批准的供应商/物料', 'Nhà cung cấp/vật tư ổn định lâu dài và đã được phê duyệt', 'Long-stable, approved supplier/material'],
              ],
              [
                ['暂停', 'Tạm dừng', 'suspended'],
                ['停止收货或强制全检', 'Dừng nhận hàng hoặc bắt buộc kiểm toàn bộ', 'Stop receiving or force 100% inspection'],
                ['出现严重质量问题', 'Có vấn đề chất lượng nghiêm trọng', 'Serious quality issues'],
              ],
            ],
          ),
          h3('接收批数的计数口径', 'Cách đếm số lô đã nhận', 'How Received Batches Are Counted'),
          ul(
            ['列表范围是「仓库实际收到过货的物料」（有收货单或库存）；尚未产生检验记录的物料按正常检验展示，可提前人工加严。', 'Danh sách gồm các vật tư **đã từng được nhận về kho** (có phiếu nhận hoặc tồn kho); vật tư chưa có phiếu kiểm hiển thị là bình thường và có thể siết chặt trước.', 'The list covers materials **actually received into the warehouse** (receipt or stock); materials without inspection records show as normal and can be tightened in advance.'],
            ['严格度按**物料**维护一条账，不再区分外观 / 尺寸功能；所有检验工段共用同一档。', 'Mức nghiêm ngặt được duy trì **theo vật tư** (một bản ghi), không tách ngoại quan / kích thước; mọi công đoạn dùng chung một mức.', 'Strictness is kept as **one record per material**, not split by appearance / dimension; all sections share the same level.'],
            ['计数口径只看每份检验报告的**最终判定**：整批接收或整批不接收，一份报告只计一次，不按 NG 出在哪个工段拆分。', 'Chỉ tính theo **kết luận cuối cùng** của phiếu: cả lô đạt hoặc không đạt, mỗi phiếu tính một lần, không tách theo công đoạn có lỗi.', 'Counting uses only the report **final judgment**: the lot is accepted or rejected as a whole, once per report, not split by the defective section.'],
            ['计数单位是「提交到 IQC 后合并成的批次」，不是收货单张数。', 'Đơn vị đếm là "lô được gộp sau khi gửi IQC", không phải số phiếu nhận hàng.', 'The unit is the merged IQC lot, not the number of receipt orders.'],
            ['批次号以 IQC 开头的计入统计；超期复检批次（前缀 EXP）不计入。', 'Lô có số bắt đầu bằng IQC được tính; lô kiểm lại do quá hạn (tiền tố EXP) không tính.', 'Lots whose number starts with IQC count; expiry re-inspection lots (prefix EXP) do not.'],
            ['同一批次只计一次：重复审批不会重复累加接收批数。', 'Mỗi lô chỉ tính một lần: duyệt lặp không cộng dồn số lô đã nhận.', 'Each lot counts once: repeated approvals do not increment the count.'],
            ['免检与暂停状态的批次不参与自动计数。', 'Lô ở trạng thái miễn kiểm và tạm dừng không tham gia đếm tự động.', 'Lots in exempt or suspended status do not participate in automatic counting.'],
          ),
          h3('严格度如何影响抽样', 'Mức nghiêm ngặt ảnh hưởng thế nào đến lấy mẫu', 'How Strictness Affects Sampling'),
          ul(
            ['检验单打开时，系统按物料当前严格度自动取表：加严用表 2-B、放宽用表 2-C、正常用表 2-A（GB/T 2828.1-2012）；外观、尺寸等所有工段共用同一张表。', 'Khi mở phiếu kiểm, hệ thống tự lấy bảng theo mức hiện tại: siết chặt dùng bảng 2-B, nới lỏng dùng bảng 2-C, bình thường dùng bảng 2-A (GB/T 2828.1-2012); mọi công đoạn dùng chung một bảng.', 'When an inspection sheet opens, the table for the current strictness is applied: 2-B for tightened, 2-C for reduced, 2-A for normal (GB/T 2828.1-2012).'],
            ['抽样数量、Ac / Re 都随严格度变化，页面上会显示当前档位；手工切换抽样方案时同样按当前严格度计算。', 'Cỡ mẫu và Ac / Re thay đổi theo mức; trang hiển thị mức hiện tại. Khi đổi phương án lấy mẫu thủ công cũng tính theo mức hiện tại.', 'Sample size and Ac / Re change with strictness, and the page shows the current level; switching the sampling plan manually also uses the current strictness.'],
            ['固定样本量（N=5）、全检、自定义文本不受严格度影响，仍按模板设置执行。', 'Cỡ mẫu cố định (N=5), kiểm toàn bộ, văn bản tùy chỉnh không bị ảnh hưởng, vẫn theo cấu hình mẫu.', 'Fixed sample size (N=5), 100% inspection and custom text are not affected and follow the template settings.'],
            ['暂停状态下检验员无法提交检验（服务端硬校验），须由品质主管确认供方改进后恢复加严。', 'Ở trạng thái tạm dừng, kiểm tra viên không thể gửi phiếu (chặn ở máy chủ); phải được trưởng bộ phận chất lượng xác nhận cải tiến rồi chuyển sang siết chặt.', 'While suspended, inspectors cannot submit (server-side enforcement); the quality manager must confirm supplier improvement before returning to tightened.'],
          ),
          note(
            'tip',
            '拒收批数按最近 5 批的真实结果滚动统计（不是「合格一批就冲掉一笔」的衰减计数）；连续 10 批接收才放宽。计数口径是每份检验报告的最终判定，不按不合格工段拆分。',
            'Số lô bị từ chối được tính trượt theo 5 lô gần nhất (không phải kiểu trừ dần); phải 10 lô liên tiếp đạt mới nới lỏng. Cách tính theo kết luận cuối cùng của phiếu, không tách theo công đoạn lỗi.',
            'Rejected batches are counted over a rolling window of the last 5 lots (not decayed by passes); 10 consecutive accepted lots are required for reduced inspection. Counting uses each report final judgment, not the defective section.',
          ),
          h3('人工调整通道', 'Kênh điều chỉnh thủ công', 'Manual Adjustment Path'),
          p(
            '有权限人员（质量经理 / IQC 主管 / 系统管理员）可在「IQC → 严格度」对**任何已收货物料**手工调整检验属性，调整理由必填并写入系统留痕：',
            'Người có quyền (quản lý chất lượng / trưởng IQC / quản trị hệ thống) có thể điều chỉnh thủ công mức kiểm cho **mọi vật tư đã nhận** tại "IQC → Mức nghiêm ngặt"; lý do bắt buộc và được lưu lại:',
            'Authorized users (quality manager / IQC manager / system administrator) can adjust the inspection level for **any received material** under IQC → Strictness; a reason is mandatory and stored for audit:',
          ),
          ol(
            ['任意状态 → 正常检验（to_normal）：产线异常处置完成、供方整改验证通过后恢复正常抽检力度。', 'Mọi trạng thái → Kiểm tra bình thường (to_normal): sau khi xử lý xong sự cố hoặc xác nhận nhà cung cấp đã cải tiến.', 'Any status → normal inspection (to_normal): after the production issue is closed or supplier corrective action is verified.'],
            ['任意状态 → 加严检验（to_tightened）：产线或客户反馈质量问题时立即收紧，遏制不良扩大；加严期计数从零重新累积。', 'Mọi trạng thái → Kiểm tra chặt (to_tightened): siết chặt ngay khi dây chuyền hoặc khách hàng phản hồi lỗi; bộ đếm bắt đầu lại từ 0.', 'Any status → tightened inspection (to_tightened): tighten immediately on production or customer quality issues; counters restart from zero.'],
            ['放宽 → 免检（to_exempt）：放宽检验下**连续 10 批接收**后，列表对应行标绿并显示「可转免检」，此时才能人工转免检。', 'Nới lỏng → Miễn kiểm (to_exempt): sau **10 lô liên tiếp đạt** dưới mức nới lỏng, dòng tương ứng chuyển xanh và hiện "Có thể chuyển miễn kiểm"; chỉ khi đó mới chuyển được.', 'reduced → exempt (to_exempt): only after **10 consecutive accepted lots** under reduced inspection; the row turns green with an "eligible" tag.'],
            ['免检 → 放宽（to_reduced_from_exempt）：退出免检但仍保留较松的抽样力度。', 'Miễn kiểm → Nới lỏng (to_reduced_from_exempt): thoát miễn kiểm nhưng vẫn giữ lấy mẫu nhẹ.', 'exempt → reduced (to_reduced_from_exempt): leave exemption but keep lighter sampling.'],
          ),
          note(
            'tip',
            '免检的门槛是硬性的：放宽期连续接收不足 10 批时，页面不显示「放宽 → 免检」入口，直接调接口也会被拒绝并提示当前进度。人工改为正常 / 加严则不受原状态限制，随时可用。',
            'Ngưỡng miễn kiểm là bắt buộc: chưa đủ 10 lô liên tiếp đạt thì không có mục "Nới lỏng → Miễn kiểm" và API cũng từ chối kèm tiến độ hiện tại. Chuyển thủ công sang bình thường / siết chặt không bị giới hạn bởi trạng thái cũ.',
            'The exemption gate is hard: below 10 consecutive accepted lots the "Reduced → Exempt" action is hidden and the API rejects with the current progress. Manual normal / tightened changes work from any status at any time.',
          ),
        ],
      },
      {
        id: 'iqc-exempt',
        title: T('免检确认', 'Xác nhận miễn kiểm', 'Exemption Confirmation'),
        blocks: [
          p(
            '当物料的严格度为免检时，检验员不需要逐项录入数据，可以直接做一次免检确认。',
            'Khi mức nghiêm ngặt của vật tư là miễn kiểm, nhân viên kiểm không cần nhập từng mục mà có thể xác nhận miễn kiểm một lần.',
            'When both the appearance and dimension inspection functions of a lot are exempt, the inspector does not need to enter item data but can confirm once.',
          ),
          ol(
            [
              '在待检列表中找到标记为「免检」的批次。',
              'Tìm lô được đánh dấu "Miễn kiểm" trong danh sách chờ kiểm.',
              'Find the lot flagged as exempt in the pending list.',
            ],
            [
              '点击「免检确认」，可填写备注说明确认依据。',
              'Bấm "Xác nhận miễn kiểm", có thể ghi chú căn cứ xác nhận.',
              'Click Exemption Confirm; you may add a note explaining the basis.',
            ],
            [
              '系统直接判定为通过：解锁库存、更新收货单、冲减欠料。',
              'Hệ thống kết luận đạt ngay: mở khóa tồn kho, cập nhật phiếu nhận hàng, ghi giảm nợ vật tư.',
              'The system marks it pass immediately: unlocks stock, updates the receipt order and offsets debt.',
            ],
            [
              '确认信息会写入批次备注，格式为「[免检确认] 确认人:xxx 备注:yyy」，便于追溯。',
              'Thông tin xác nhận được ghi vào ghi chú lô theo định dạng "[免检确认] 确认人:xxx 备注:yyy" để truy vết.',
              'The confirmation is written to the lot remark as "[Exemption confirmed] by:xxx note:yyy" for traceability.',
            ],
          ),
          note(
            'info',
            '免检确认不会生成检验报告和检验记录明细，这是设计如此——免检意味着没有实测数据。但备注栏一定会有确认人与时间。',
            'Xác nhận miễn kiểm không tạo báo cáo và chi tiết hồ sơ kiểm; đây là thiết kế có chủ đích — miễn kiểm nghĩa là không có dữ liệu đo. Nhưng phần ghi chú luôn có người xác nhận và thời gian.',
            'Exemption confirmation creates no inspection report or detail records by design — exemption means no measured data. However, the remark always records who confirmed and when.',
          ),
        ],
      },
      {
        id: 'iqc-expiry',
        title: T('超期复检', 'Kiểm lại do quá hạn', 'Expiry Re-inspection'),
        blocks: [
          ul(
            ['物料超过保质期后，库存会进入超期预警列表（菜单：库存 → 库存超期）。', 'Sau khi vật tư quá hạn sử dụng, tồn kho vào danh sách cảnh báo quá hạn (menu: Tồn kho → Quá hạn).', 'After shelf life expires, stock appears in the expiry alert list (Inventory → Expiry).'],
            ['需要继续使用时，发起超期复检，生成前缀为 EXP 的检验批次。', 'Khi cần tiếp tục dùng, khởi tạo kiểm lại do quá hạn, sinh lô kiểm có tiền tố EXP.', 'To keep using it, initiate an expiry re-inspection, creating a lot prefixed EXP.'],
            ['复检批次的编号前缀为 EXP，不计入供应商接收批数统计，不会影响严格度评级。', 'Lô kiểm lại có tiền tố EXP, không tính vào số lô đã nhận của nhà cung cấp và không ảnh hưởng xếp hạng mức nghiêm ngặt.', 'Re-inspection lots are prefixed EXP; they do not count toward supplier batch counts or affect strictness rating.'],
            ['复检合格后库存恢复可用；不合格则转不良品仓并进入 MRB。', 'Sau khi kiểm lại đạt, tồn kho khả dụng trở lại; không đạt thì chuyển kho hàng lỗi và vào MRB.', 'Passing restores usable stock; failing moves it to the defective warehouse and into MRB.'],
          ),
        ],
      },
      {
        id: 'iqc-report',
        title: T('检验报告、记录与模板', 'Báo cáo, hồ sơ và mẫu kiểm', 'Reports, Records & Templates'),
        blocks: [
          table(
            [['页面', 'Trang', 'Page'], ['用途', 'Mục đích', 'Purpose'], ['谁用', 'Ai dùng', 'Who uses it']],
            [
              [
                ['IQC → 检验报告', 'IQC → Báo cáo kiểm', 'IQC → Inspection Report'],
                ['查看每次检验的结论、检验项数据与判定依据', 'Xem kết luận, dữ liệu hạng mục và căn cứ kết luận của mỗi lần kiểm', 'View each inspection verdict, item data and basis'],
                ['IQC 主管、SQE、质量经理', 'Trưởng IQC, SQE, Trưởng chất lượng', 'IQC Manager, SQE, Quality Manager'],
              ],
              [
                ['IQC → 检验记录', 'IQC → Hồ sơ kiểm', 'IQC → Inspection Record'],
                ['按批次查询原始检验数据明细', 'Tra cứu chi tiết dữ liệu kiểm gốc theo lô', 'Query raw inspection data by lot'],
                ['IQC 检验员', 'Nhân viên IQC', 'IQC Inspector'],
              ],
              [
                ['IQC → 检验模板', 'IQC → Mẫu kiểm', 'IQC → Inspection Template'],
                ['维护检验项目与判定标准（尺寸上下限、外观要求）', 'Bảo trì hạng mục kiểm và tiêu chuẩn (giới hạn kích thước, yêu cầu ngoại quan)', 'Maintain inspection items and criteria (dimension limits, appearance)'],
                ['IQC 主管', 'Trưởng IQC', 'IQC Manager'],
              ],
              [
                ['IQC → 标准库', 'IQC → Thư viện tiêu chuẩn', 'IQC → Standard Library'],
                ['维护可复用的检验标准条目', 'Bảo trì các mục tiêu chuẩn kiểm dùng lại được', 'Maintain reusable standard entries'],
                ['IQC 主管', 'Trưởng IQC', 'IQC Manager'],
              ],
              [
                ['IQC → 检验统计', 'IQC → Thống kê kiểm', 'IQC → Inspection Stats'],
                ['合格率、供应商质量趋势等统计报表', 'Báo cáo tỷ lệ đạt, xu hướng chất lượng nhà cung cấp', 'Pass rate and supplier quality trends'],
                ['IQC 主管、质量经理', 'Trưởng IQC, Trưởng chất lượng', 'IQC Manager, Quality Manager'],
              ],
              [
                ['IQC → 供应商欠料', 'IQC → Nợ vật tư nhà cung cấp', 'IQC → Supplier Debt'],
                ['因检验不合格产生的供应商欠料清单与核销', 'Danh sách nợ vật tư do kiểm không đạt và ghi giảm', 'Supplier debt from failed inspections and settlement'],
                ['SQE、财务、质量经理', 'SQE, Tài chính, Trưởng chất lượng', 'SQE, Finance, Quality Manager'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'iqc-prodreturn',
        title: T('生产退料待检', 'Chờ kiểm hàng hoàn trả sản xuất', 'Production Return Pending'),
        blocks: [
          p(
            '生产退回的物料若需重新确认质量，会进入「IQC → 生产退料待检」列表，走与来料相同的检验流程，但不会产生供应商欠料（问题不在供应商）。',
            'Vật tư hoàn trả từ sản xuất nếu cần xác nhận lại chất lượng sẽ vào danh sách "IQC → Chờ kiểm hàng hoàn trả", đi theo quy trình kiểm như hàng đến nhưng không sinh nợ nhà cung cấp (lỗi không thuộc nhà cung cấp).',
            'Material returned from production that needs quality re-confirmation enters IQC → Production Return Pending. It follows the same inspection flow but creates no supplier debt, since the supplier is not at fault.',
          ),
        ],
      },
    ],
  },
];
