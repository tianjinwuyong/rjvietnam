import { type HelpChapter, p, h3, ul, ol, note, table, flow, T } from './helpTypes';

export const stockChapters: HelpChapter[] = [
  // ================================================================ 7 库存
  {
    id: 'inventory',
    icon: 'boxes',
    title: T('库存管理', 'Quản lý tồn kho', 'Inventory Management'),
    summary: T(
      '库存查询、内部调拨、库存调拨、不良品转移，以及锁定与解锁的含义。',
      'Tra cứu tồn kho, điều chuyển nội bộ, điều chuyển kho, chuyển hàng lỗi, cùng ý nghĩa của khóa và mở khóa.',
      'Inventory query, intra transfer, stock transfer, defective moves, and what locking and unlocking mean.',
    ),
    sections: [
      {
        id: 'inventory-states',
        title: T('库存状态字典（最重要的一节）', 'Từ điển trạng thái tồn kho (mục quan trọng nhất)', 'Inventory Status Dictionary (Most Important)'),
        blocks: [
          p(
            '理解库存状态是理解整个 WMS 的钥匙。同一批物料可能因为质检结果不同而处于完全不同的状态，能不能被领用取决于状态。',
            'Hiểu trạng thái tồn kho là chìa khóa hiểu toàn bộ WMS. Cùng một lô vật tư có thể ở trạng thái hoàn toàn khác nhau tùy kết quả kiểm; việc có lĩnh được hay không phụ thuộc vào trạng thái.',
            'Understanding stock status is the key to the whole WMS. The same batch can sit in very different states depending on inspection results, and whether it can be picked depends on the state.',
          ),
          table(
            [['状态值', 'Giá trị trạng thái', 'Status value'], ['中文含义', 'Ý nghĩa tiếng Trung', 'Chinese meaning'], ['可见位置', 'Vị trí hiển thị', 'Visible location'], ['能否发料', 'Có xuất kho được?', 'Issuable?']],
            [
              [
                ['good', 'good', 'good'],
                ['良品仓可用库存', 'Tồn kho khả dụng kho hàng tốt', 'Usable stock in good warehouse'],
                ['良品仓库位', 'Vị trí kho hàng tốt', 'Good warehouse location'],
                ['能（且需未锁定）', 'Có (và phải chưa khóa)', 'Yes (and unlocked)'],
              ],
              [
                ['good + locked', 'good + locked', 'good + locked'],
                ['良品仓但被锁定（待检/冻结）', 'Kho hàng tốt nhưng bị khóa (chờ kiểm/phong tỏa)', 'Good warehouse but locked (pending/held)'],
                ['良品仓库位', 'Vị trí kho hàng tốt', 'Good warehouse location'],
                ['不能', 'Không', 'No'],
              ],
              [
                ['defective', 'defective', 'defective'],
                ['不良品仓，待 MRB 处置', 'Kho hàng lỗi, chờ xử lý MRB', 'Defective warehouse, awaiting MRB'],
                ['不良品仓库位', 'Vị trí kho hàng lỗi', 'Defective warehouse location'],
                ['不能，可重新评审', 'Không; có thể đánh giá lại', 'No; can be reviewed again'],
              ],
              [
                ['returned', 'returned', 'returned'],
                ['退货冻结，已被退货单占用', 'Phong tỏa trả hàng, đã bị phiếu trả hàng chiếm', 'Held for return, claimed by a return order'],
                ['不良品仓库位', 'Vị trí kho hàng lỗi', 'Defective warehouse location'],
                ['不能，需先取消退货单', 'Không; cần hủy phiếu trả hàng trước', 'No; cancel the return order first'],
              ],
              [
                ['rework', 'rework', 'rework'],
                ['返工占用，正在返工', 'Đang làm lại', 'In rework'],
                ['不良品仓库位', 'Vị trí kho hàng lỗi', 'Defective warehouse location'],
                ['不能，返工后重新检验', 'Không; kiểm lại sau khi làm lại', 'No; re-inspect after rework'],
              ],
              [
                ['scrapped', 'scrapped', 'scrapped'],
                [
                  '已判报废，待销毁（销毁前仍有数量）',
                  'Đã quyết tiêu hủy, chờ tiêu hủy (vẫn còn số lượng trước khi hủy)',
                  'Marked scrap, pending destruction (quantity remains until destroyed)',
                ],
                ['不良品仓（报废区）', 'Kho hàng lỗi (khu tiêu hủy)', 'Defective warehouse (scrap area)'],
                ['不能，需先调拨后销毁', 'Không; phải chuyển kho rồi tiêu hủy', 'No; transfer then destroy'],
              ],
            ],
          ),
          note(
            'warn',
            '发料只认「良品仓 + 未锁定」。任何处于 locked 状态的物料，即使数量充足也无法被领用。领料报"库存不足"时，先确认是不是被锁定了。',
            'Xuất kho chỉ chấp nhận "kho hàng tốt + chưa khóa". Vật tư ở trạng thái khóa dù đủ số lượng cũng không lĩnh được. Khi báo "thiếu tồn kho", trước tiên kiểm tra xem có bị khóa không.',
            'Issuing accepts only good warehouse and unlocked. Locked material cannot be picked even with sufficient quantity. If picking reports insufficient stock, first check whether it is locked.',
          ),
        ],
      },
      {
        id: 'inventory-query',
        title: T('库存查询', 'Tra cứu tồn kho', 'Inventory Query'),
        blocks: [
          ul(
            ['菜单路径：库存 → 库存查询。这是使用频率最高的查询页面。', 'Đường dẫn: Tồn kho → Tra cứu tồn kho. Đây là trang tra cứu dùng nhiều nhất.', 'Menu: Inventory → Inventory Query. This is the most-used query page.'],
            ['支持按物料、仓库、库位、批次、库存状态、是否锁定等条件筛选。', 'Lọc theo vật tư, kho, vị trí, lô, trạng thái tồn, có khóa hay không.', 'Filter by material, warehouse, location, batch, stock status and lock state.'],
            ['查询结果按「物料 + 库位 + 批次 + 状态」四要素分行。同一批料放在两个库位就是两行。', 'Kết quả chia dòng theo bốn yếu tố "vật tư + vị trí + lô + trạng thái". Cùng một lô ở hai vị trí là hai dòng.', 'Results are split by material + location + batch + status; the same batch in two locations is two rows.'],
            ['点击某行可查看该库存的流水明细，追溯每一次增减的来源单据。', 'Bấm một dòng để xem chi tiết giao dịch, truy vết chứng từ nguồn của từng lần tăng giảm.', 'Click a row to see the transaction history and trace each increase or decrease to its source document.'],
          ),
          note(
            'tip',
            '查不到料时按这个顺序排查：① 是否已经扫码收货？② 是否还在待检状态？③ 库位或仓库是否选错？④ 是否在不良品仓？',
            'Khi không tìm thấy hàng, kiểm tra theo thứ tự: ① Đã quét mã nhận hàng chưa? ② Còn ở trạng thái chờ kiểm không? ③ Có chọn sai vị trí/kho không? ④ Có ở kho hàng lỗi không?',
            'If material is missing, check in order: ① Was it scanned in? ② Is it still pending inspection? ③ Wrong location or warehouse? ④ Is it in the defective warehouse?',
          ),
        ],
      },
      {
        id: 'inventory-lock',
        title: T('锁定与解锁', 'Khóa và mở khóa', 'Lock & Unlock'),
        blocks: [
          p(
            '锁定表示"这批料暂时不能动"。常见场景：质检待检、质量异常冻结、客户退货暂存、样品保留。',
            'Khóa nghĩa là "lô này tạm thời không được động vào". Tình huống thường gặp: chờ kiểm, phong tỏa do bất thường chất lượng, giữ hàng khách trả, giữ mẫu.',
            'Locking means "this stock must not be touched for now". Common cases: pending inspection, quality hold, customer-return staging, sample retention.',
          ),
          ol(
            ['在库存查询中找到目标行，点击「锁定」。', 'Tìm dòng mục tiêu trong tra cứu tồn kho, bấm "Khóa".', 'Find the target row in Inventory Query and click Lock.'],
            ['填写锁定原因（必填），例如「质量异常，等待 MRB 结论」。', 'Nhập lý do khóa (bắt buộc), ví dụ "bất thường chất lượng, chờ kết luận MRB".', 'Enter the lock reason (required), e.g. "quality issue, awaiting MRB".'],
            ['锁定后该行显示锁定标记，发料时会自动跳过。', 'Sau khi khóa, dòng hiển thị dấu khóa và bị bỏ qua khi xuất kho.', 'The row shows a lock marker and is skipped during issuing.'],
            ['需要恢复时点击「解锁」，填写解锁原因。', 'Khi cần khôi phục, bấm "Mở khóa" và nhập lý do.', 'To restore, click Unlock and enter a reason.'],
          ),
          note(
            'warn',
            '锁定状态下的库存不能被盘点调整改写数量。这是为了防止"冻结中的物料被账面调整掩盖"。若确需调整，须由系统管理员执行强制调整并留痕。',
            'Tồn kho đang khóa không thể bị sửa số lượng bằng điều chỉnh kiểm kê. Điều này ngăn việc "vật tư đang phong tỏa bị che giấu bằng điều chỉnh sổ sách". Nếu buộc phải điều chỉnh, quản trị viên hệ thống phải thực hiện cưỡng bức và lưu vết.',
            'Locked stock cannot have its quantity changed by stock-take adjustment, preventing a held item from being masked by a book adjustment. If adjustment is truly needed, the administrator must force it with an audit trail.',
          ),
        ],
      },
      {
        id: 'inventory-intra',
        title: T('内部调拨 / 不良品转移', 'Điều chuyển nội bộ / Chuyển hàng lỗi', 'Intra Transfer / Defective Move'),
        blocks: [
          h3('内部调拨（同仓库内换库位）', 'Điều chuyển nội bộ (đổi vị trí trong cùng kho)', 'Intra Transfer (within one warehouse)'),
          ul(
            ['菜单路径：库存 → 内部调拨。', 'Đường dẫn: Tồn kho → Điều chuyển nội bộ.', 'Menu: Inventory → Intra Transfer.'],
            ['用于在同一仓库内把物料从一个库位搬到另一个库位，例如整理货架、腾挪空间。', 'Dùng để chuyển vật tư từ vị trí này sang vị trí khác trong cùng kho, ví dụ sắp xếp kệ, giải phóng chỗ.', 'Moves material between locations in the same warehouse, e.g. tidying shelves or freeing space.'],
            ['物料、批次、数量都不变，只是库位变化，因此不影响总库存。', 'Vật tư, lô, số lượng không đổi, chỉ vị trí đổi nên không ảnh hưởng tổng tồn kho.', 'Material, batch and quantity stay the same; only the location changes, so total stock is unaffected.'],
            ['源库位与目标库位不能相同。', 'Vị trí nguồn và vị trí đích không được trùng nhau.', 'Source and target locations must differ.'],
          ),
          h3('不良品转移（良品仓 ↔ 不良品仓）', 'Chuyển hàng lỗi (kho tốt ↔ kho lỗi)', 'Defective Move (good ↔ defective)'),
          ul(
            ['菜单路径：库存 → 不良品转移。', 'Đường dẫn: Tồn kho → Chuyển hàng lỗi.', 'Menu: Inventory → Defective Transfer.'],
            ['用于把物料在良品仓与不良品仓之间移动，同时改变库存状态。', 'Dùng để chuyển vật tư giữa kho hàng tốt và kho hàng lỗi, đồng thời đổi trạng thái tồn.', 'Moves material between the good and defective warehouses and changes stock status.'],
            ['从良品仓转出时必须填写原因，用于追溯为何判定为不良。', 'Khi chuyển ra khỏi kho hàng tốt phải nhập lý do để truy vết vì sao bị coi là lỗi.', 'Moving out of the good warehouse requires a reason for traceability.'],
            ['转移到不良品仓后，该批物料不可发料，等待 MRB 处置。', 'Sau khi chuyển vào kho hàng lỗi, lô đó không xuất được, chờ xử lý MRB.', 'Once in the defective warehouse the batch cannot be issued and awaits MRB.'],
          ),
        ],
      },
      {
        id: 'inventory-transfer',
        title: T('库存调拨（跨仓库）', 'Điều chuyển kho (giữa các kho)', 'Stock Transfer (Cross-warehouse)'),
        blocks: [
          ul(
            ['菜单路径：库存 → 库存调拨。', 'Đường dẫn: Tồn kho → Điều chuyển kho.', 'Menu: Inventory → Stock Transfer.'],
            ['用于把物料从一个仓库调到另一个仓库，源库位与目标库位分属不同仓库。', 'Dùng để điều chuyển vật tư từ kho này sang kho khác; vị trí nguồn và đích thuộc kho khác nhau.', 'Moves material from one warehouse to another, with source and target locations in different warehouses.'],
            ['调拨会生成流水记录，可追溯到调拨人与时间。', 'Điều chuyển sinh bản ghi giao dịch, truy vết được người và thời gian.', 'Transfers create transaction records traceable to operator and time.'],
            ['调拨数量不能超过源库位的现有可用数量。', 'Số lượng điều chuyển không được vượt tồn khả dụng hiện có ở vị trí nguồn.', 'The transfer quantity cannot exceed available stock at the source location.'],
          ),
        ],
      },
      {
        id: 'inventory-expiry',
        title: T('库存超期预警', 'Cảnh báo tồn kho quá hạn', 'Inventory Expiry Alert'),
        blocks: [
          ul(
            ['菜单路径：库存 → 库存超期。', 'Đường dẫn: Tồn kho → Quá hạn.', 'Menu: Inventory → Expiry.'],
            ['系统按「收货日期 + 物料保质期天数」计算到期日，临近或超过时进入预警。', 'Hệ thống tính ngày hết hạn theo "ngày nhận + số ngày hạn dùng", đưa vào cảnh báo khi gần hoặc đã quá hạn.', 'The system computes the expiry date as receipt date + shelf life and flags near or past items.'],
            ['超期物料仍可查询，但需走超期复检后才能继续使用。', 'Vật tư quá hạn vẫn tra cứu được, nhưng phải kiểm lại do quá hạn mới dùng tiếp.', 'Expired material remains queryable but requires expiry re-inspection before further use.'],
            ['建议每周检查一次该列表，避免呆滞料长期积压。', 'Nên kiểm tra danh sách này mỗi tuần để tránh tồn đọng hàng chậm luân chuyển.', 'Review this list weekly to avoid slow-moving stock accumulating.'],
          ),
        ],
      },
    ],
  },

  // ================================================================ 8 盘点
  {
    id: 'stocktake',
    icon: 'clipboard-list',
    title: T('盘点作业', 'Nghiệp vụ kiểm kê', 'Stock-Take'),
    summary: T(
      '盘点单从建单、扫码、提交、审批到调整库存的完整流程与状态机。',
      'Quy trình đầy đủ và máy trạng thái của phiếu kiểm kê: tạo phiếu, quét mã, gửi, phê duyệt, điều chỉnh tồn kho.',
      'The full flow and state machine of a stock-take: create, scan, submit, approve and adjust inventory.',
    ),
    sections: [
      {
        id: 'stocktake-flow',
        title: T('盘点流程图', 'Sơ đồ quy trình kiểm kê', 'Stock-Take Flow'),
        blocks: [
          flow(
            ['建盘点单', 'Tạo phiếu', 'Create'],
            ['扫码盘点', 'Quét mã kiểm', 'Scan count'],
            ['提交审批', 'Gửi phê duyệt', 'Submit'],
            ['主管审批', 'Trưởng duyệt', 'Approve'],
            ['生成调整', 'Sinh điều chỉnh', 'Generate adjustment'],
          ),
          table(
            [['状态', 'Trạng thái', 'Status'], ['含义', 'Ý nghĩa', 'Meaning'], ['可执行操作', 'Thao tác khả dụng', 'Available actions'], ['执行角色', 'Vai trò thực hiện', 'Executing role']],
            [
              [
                ['draft', 'draft', 'draft'],
                ['已建单，尚未盘完', 'Đã tạo phiếu, chưa kiểm xong', 'Created, counting not finished'],
                ['扫码盘点、提交、取消', 'Quét mã kiểm, gửi, hủy', 'Scan, submit, cancel'],
                ['仓管员', 'Nhân viên kho', 'Warehouse Keeper'],
              ],
              [
                ['pending_approval', 'pending_approval', 'pending_approval'],
                ['已提交，等待主管确认', 'Đã gửi, chờ trưởng xác nhận', 'Submitted, awaiting manager'],
                ['审批（批准/驳回）', 'Phê duyệt (đồng ý/từ chối)', 'Approve / reject'],
                ['仓库主管', 'Trưởng kho', 'Warehouse Manager'],
              ],
              [
                ['approved', 'approved', 'approved'],
                ['审批通过，生成库存调整', 'Duyệt xong, sinh điều chỉnh tồn kho', 'Approved, adjustment generated'],
                ['查看', 'Xem', 'View'],
                ['—', '—', '—'],
              ],
              [
                ['cancelled', 'cancelled', 'cancelled'],
                ['作废，不影响库存', 'Hủy bỏ, không ảnh hưởng tồn kho', 'Voided, no inventory impact'],
                ['查看', 'Xem', 'View'],
                ['—', '—', '—'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'stocktake-create',
        title: T('建立盘点单', 'Tạo phiếu kiểm kê', 'Creating a Stock-Take Order'),
        blocks: [
          ol(
            [
              '菜单路径：库存 → 盘点。点击「新建盘点单」。',
              'Đường dẫn: Tồn kho → Kiểm kê. Bấm "Tạo phiếu kiểm kê".',
              'Menu: Inventory → Stock-Take. Click New Stock-Take.',
            ],
            [
              '选择盘点月份（期间）、仓库、盘点类型（月度盘点 / 临时抽盘）与盘点名称；同月可多次盘点。',
              'Chọn tháng kiểm kê (kỳ) và kho.',
              'Choose the period month and warehouse.',
            ],
            [
              '选择建单方式：物料少选「单张盘点单」（整仓一次盘完）；物料多选「主盘点单」，后续按区域 / 地址码范围拆成多张子盘点单。',
              'Chọn cách tạo phiếu: ít vật tư chọn "Phiếu đơn" (kiểm cả kho một lần); nhiều vật tư chọn "Phiếu chính" rồi tách thành nhiều phiếu con theo khu vực / dải mã vị trí.',
              'Choose the mode: Single for a small warehouse counted in one pass, or Main to split into sub-orders by area or location range.',
            ],
            [
              '单张盘点单：系统自动带出该仓库下的库存明细作为盘点清单。',
              'Phiếu đơn: hệ thống tự đưa ra danh sách tồn kho chi tiết của kho đó.',
              'Single order: the system loads the inventory lines of that warehouse as the count list.',
            ],
            [
              '主盘点单：主单本身不带明细，进入主单详情 →「子盘点单」→「新建子盘点单」，填区域 / 货架 / 层 / 起始与结束地址码，先「预览范围」确认生成行数再创建。',
              'Phiếu chính: phiếu chính không có chi tiết; vào chi tiết → "Phiếu con" → "Tạo phiếu con", nhập khu vực / kệ / tầng / mã vị trí bắt đầu - kết thúc, bấm "Xem trước phạm vi" để kiểm tra số dòng rồi tạo.',
              'Main order: it has no lines itself. Open it → Sub-orders → New sub-order, enter area / shelf / layer and the location range, preview the scope, then create.',
            ],
            [
              '保存后状态为「草稿」，可以开始扫码盘点。',
              'Sau khi lưu, trạng thái là "Nháp" và có thể bắt đầu quét mã kiểm.',
              'After saving, the status is draft and counting can begin.',
            ],
          ),
          note(
            'info',
            '同一月份、同一仓库可以建多张盘点单（月度盘点、临时抽盘、复盘各自独立），用「盘点类型 + 盘点名称」区分批次；单号由系统按月流水递增，互不影响。',
            'Cùng tháng, cùng kho có thể tạo nhiều phiếu kiểm kê (kiểm tháng, kiểm đột xuất, kiểm lại độc lập), phân biệt bằng "Loại kiểm kê + Tên phiếu"; số phiếu tăng theo tháng, không ảnh hưởng nhau.',
            'Multiple orders can exist for the same month and warehouse (monthly count, spot check, recount). Use count type + order name to tell them apart; order numbers increase independently.',
          ),
        ],
      },
      {
        id: 'stocktake-hierarchy',
        title: T('主盘点单与子盘点单', 'Phiếu chính và phiếu con', 'Main and Sub Stock-Take Orders'),
        blocks: [
          p(
            '一个仓库物料很多时，一张单盘完不现实。主盘点单负责「期间 + 仓库」的汇总结论，子盘点单负责具体库位范围的实盘，多人可以同时作业。',
            'Khi kho có nhiều vật tư, kiểm trong một phiếu là không thực tế. Phiếu chính giữ kết luận tổng hợp theo "kỳ + kho", phiếu con phụ trách phạm vi vị trí cụ thể để nhiều người làm song song.',
            'For a large warehouse, one order is impractical. The main order holds the period + warehouse conclusion; sub-orders cover specific location ranges so several people can count in parallel.',
          ),
          ol(
            [
              '主盘点单不生成明细、不能直接扫码或提交，只做汇总。',
              'Phiếu chính không sinh chi tiết, không quét mã hay gửi trực tiếp, chỉ tổng hợp.',
              'The main order has no lines and cannot be scanned or submitted directly; it only aggregates.',
            ],
            [
              '子单按「区域 + 地址码起止」生成账面快照，同一库存行不会被两张子单重复盘点（重叠会直接拒绝并提示已占用的子单号）。',
              'Phiếu con sinh ảnh chụp sổ sách theo "khu vực + dải mã vị trí"; một dòng tồn kho không bị hai phiếu con kiểm trùng (nếu chồng lấn sẽ bị từ chối kèm số phiếu đã chiếm).',
              'A sub-order snapshots by area + location range. The same stock line cannot be counted twice; overlapping ranges are rejected with the conflicting sub-order number.',
            ],
            [
              '仓管员或仓库主管都可以在子单扫码／手工录入，子单各自提交、各自审批。',
              'Thủ kho hoặc trưởng kho đều có thể quét mã / nhập tay trên phiếu con; mỗi phiếu con gửi và duyệt riêng.',
              'Keepers and warehouse managers can both scan or enter quantities in a sub-order; each sub-order is submitted and approved independently.',
            ],
            [
              '全部子单提交后，回到主单点「确认盈亏」：主单汇总应盘行数、已盘行数、盘盈盘亏与差异数量，确认后主单归档。',
              'Sau khi tất cả phiếu con được gửi, quay lại phiếu chính bấm "Xác nhận chênh lệch": phiếu chính tổng hợp số dòng, số đã kiểm, thừa/thiếu và chênh lệch số lượng, sau đó lưu trữ.',
              'After all sub-orders are submitted, return to the main order and click Confirm Result: it aggregates lines, counted lines, surplus/shortage and quantity difference, then archives.',
            ],
          ),
          note(
            'warn',
            '主单的「明细 / 报表」页签会显示所有子单的行，并标注来源子单号；发现某一行有问题，点子单号进入对应子单处理，不要在汇总页改数。',
            'Tab "Chi tiết / Báo cáo" của phiếu chính hiển thị dòng của mọi phiếu con kèm số phiếu nguồn; nếu một dòng có vấn đề, mở phiếu con tương ứng để xử lý, không sửa trên trang tổng hợp.',
            'The main order tabs show lines from all sub-orders with their source sub-order number; fix issues in the sub-order, not on the summary page.',
          ),
        ],
      },
      {
        id: 'stocktake-scan',
        title: T('扫码盘点', 'Quét mã kiểm kê', 'Scanning the Count'),
        blocks: [
          p(
            '盘点采用「按实物扫码」的方式：扫物料的标签，系统记录实盘数量，与账面数量自动比对出差额。',
            'Kiểm kê theo cách "quét mã theo hàng thực tế": quét nhãn vật tư, hệ thống ghi số thực đếm và tự so với số trên sổ để ra chênh lệch.',
            'Counting works by scanning physical labels: the system records the counted quantity and compares it with the book quantity to derive the difference.',
          ),
          ol(
            [
              '打开盘点单详情，选择「扫码盘点」。',
              'Mở chi tiết phiếu kiểm kê, chọn "Quét mã kiểm".',
              'Open the stock-take detail and choose Scan Count.',
            ],
            [
              '扫描物料标签。标签格式与收货二维码相同（六段码，供应商*料号*生产日期*数量*批次*流水号）；仓管员与仓库主管都可以扫码。',
              'Quét nhãn vật tư. Định dạng nhãn giống mã QR nhận hàng (mã sáu đoạn: nhà cung cấp*mã vật tư*ngày sản xuất*số lượng*lô*số thứ tự).',
              'Scan the material label. The format matches the receipt QR (six segments).',
            ],
            [
              '系统找到对应库存行，录入实盘数量。若实物数量与标签不符，以实物为准并填写差异说明。',
              'Hệ thống tìm dòng tồn kho tương ứng và nhập số thực đếm. Nếu số thực tế khác nhãn, lấy thực tế làm chuẩn và ghi chú chênh lệch.',
              'Warehouse keepers and warehouse managers can both scan. The system matches the line by material + batch; if it differs from the label, use the physical count and note the variance.',
            ],
            [
              '全部盘完后点击「提交」，状态变为「待审批」。',
              'Sau khi kiểm hết, bấm "Gửi"; trạng thái chuyển thành "Chờ phê duyệt".',
              'When done, click Submit; the status becomes pending approval.',
            ],
          ),
          note(
            'warn',
            '提交后不能继续扫码。若发现遗漏，需要撤回到草稿状态（若系统允许）或取消后重建。',
            'Sau khi gửi không quét tiếp được. Nếu phát hiện thiếu, cần đưa về trạng thái nháp (nếu hệ thống cho phép) hoặc hủy rồi tạo lại.',
            'Scanning stops after submission. If you find omissions, revert to draft if allowed, or cancel and recreate.',
          ),
          note(
            'info',
            '并发保护：多人同时对同一张盘点单点提交，只有第一个请求成功，其余会提示"该盘点单已提交或状态已变更"，不会产生重复的提交日志。',
            'Bảo vệ đồng thời: nhiều người cùng gửi một phiếu, chỉ yêu cầu đầu thành công; các yêu cầu sau báo "phiếu đã gửi hoặc trạng thái đã đổi", không sinh log trùng.',
            'Concurrency protection: only the first submit succeeds; the rest report that the order was already submitted or changed, with no duplicate log entries.',
          ),
        ],
      },
      {
        id: 'stocktake-pda',
        title: T('PDA 盘点', 'Kiểm kê trên PDA', 'Stock-Take on PDA'),
        blocks: [
          p(
            'PDA 的「库存 / 盘点 → 盘点登记」按**盘点单**执行，不再直接调整库存。必须先由电脑端建立盘点单。',
            'Mục "Kho / Kiểm kê → Đăng ký kiểm kê" trên PDA thực hiện theo **phiếu kiểm kê**, không điều chỉnh tồn kho trực tiếp. Phiếu phải được tạo trên máy tính trước.',
            'The PDA tab Stock / Stock-Take → Count works against a **stock-take order** and no longer adjusts inventory directly. The order must be created on PC first.',
          ),
          ol(
            [
              '进入「盘点登记」，列表显示所有「盘点中」的盘点单（单号、仓库、期间、已盘进度），点选要盘的那张。',
              'Vào "Đăng ký kiểm kê"; danh sách hiển thị các phiếu "Đang kiểm kê" (số phiếu, kho, kỳ, tiến độ). Chọn phiếu cần kiểm.',
              'Open Count; the list shows all orders in Counting status (No., warehouse, period, progress). Tap the one to count.',
            ],
            [
              '扫描（或手动选择）库位码，确定当前作业库位；之后扫到的物料都会累加到该库位的账面行。',
              'Quét (hoặc chọn) mã vị trí để xác định vị trí đang làm; các nhãn quét sau sẽ cộng vào dòng sổ sách của vị trí đó.',
              'Scan (or pick) the location code to set the working location; subsequent labels accumulate into that location lines.',
            ],
            [
              '逐箱扫描物料标签：系统按「料号 + 批次」找到本库位的账面行并累加实盘数，扫错料、扫到别的库位会立即红字提示。',
              'Quét từng thùng nhãn vật tư: hệ thống tìm dòng sổ sách của vị trí theo "mã vật tư + lô" và cộng dồn số thực đếm; quét sai vật tư hoặc khác vị trí sẽ báo đỏ ngay.',
              'Scan labels box by box: the system matches the line in this location by material + batch and accumulates the counted qty; a wrong material or wrong location is rejected immediately.',
            ],
            [
              '整位确实全部相符时，可点「全部账实相符」按账面数填充，避免逐行录入；有差异的行仍可手工改数并填写原因。',
              'Nếu vị trí thực sự khớp toàn bộ, bấm "Tất cả khớp sổ sách" để điền theo sổ; dòng chênh lệch vẫn có thể sửa tay và ghi lý do.',
              'If the location truly matches, tap "All match book qty" to fill book quantities; variance lines can still be edited manually with a reason.',
            ],
            [
              '点「保存盘点结果」写回盘点单（不动物库存）；继续扫下一个库位，重复直到盘完。',
              'Bấm "Lưu kết quả" để ghi vào phiếu (không đổi tồn kho); tiếp tục quét vị trí khác đến khi xong.',
              'Tap Save to write results into the order (inventory unchanged); continue with other locations until done.',
            ],
            [
              '全部盘完后点「提交审批」，状态变为待审批，由仓库主管在电脑端审批后才会按实盘数调整库存。',
              'Sau khi xong, bấm "Gửi duyệt"; phiếu chuyển Chờ duyệt. Trưởng kho duyệt trên máy tính thì tồn kho mới được điều chỉnh.',
              'When done, tap Submit; the order becomes pending approval. Inventory is adjusted only after the warehouse manager approves on PC.',
            ],
          ),
          note(
            'info',
            '列表里没有盘点单，说明还没有「盘点中」的单据：请先在电脑端「库存 → 盘点」新建。同一月份、同一仓库可以有多张盘点单。',
            'Nếu danh sách trống, chưa có phiếu "Đang kiểm kê": hãy tạo trên máy tính tại "Kho → Kiểm kê". Mỗi kỳ + mỗi kho chỉ có một phiếu.',
            'If the list is empty, there is no order in Counting status: create one on PC under Inventory → Stock-Take. Only one order per period and warehouse.',
          ),
        ],
      },
      {
        id: 'stocktake-approve',
        title: T('审批与库存调整', 'Phê duyệt và điều chỉnh tồn kho', 'Approval & Inventory Adjustment'),
        blocks: [
          ol(
            [
              '仓库主管进入盘点单，核对盘点结果与差异明细。',
              'Trưởng kho mở phiếu kiểm kê, đối chiếu kết quả và chi tiết chênh lệch.',
              'The warehouse manager reviews the count results and variance details.',
            ],
            [
              '差异合理则点「批准」，系统按实盘数量调整库存并写入调整流水。',
              'Nếu chênh lệch hợp lý, bấm "Phê duyệt"; hệ thống điều chỉnh tồn kho theo số thực đếm và ghi giao dịch điều chỉnh.',
              'If variances are reasonable, click Approve; the system adjusts inventory to the counted quantity and writes an adjustment transaction.',
            ],
            [
              '差异异常则「驳回」，盘点单退回草稿，重新盘点。',
              'Nếu chênh lệch bất thường, chọn "Từ chối"; phiếu trở về nháp để kiểm lại.',
              'If variances are abnormal, reject; the order returns to draft for recounting.',
            ],
            [
              '审批同样有并发保护：只有第一次审批会生效，避免了重复调整库存。',
              'Phê duyệt cũng có bảo vệ đồng thời: chỉ lần duyệt đầu có hiệu lực, tránh điều chỉnh tồn kho trùng.',
              'Approval is also concurrency-protected: only the first approval takes effect, avoiding duplicate adjustments.',
            ],
          ),
          note(
            'tip',
            '盘点调整会写一条库存流水，记录调整前后数量与操作人。财务对账时以流水为准，而不是以当前库存快照为准。',
            'Điều chỉnh kiểm kê ghi một giao dịch tồn kho, lưu số trước/sau và người thao tác. Khi đối chiếu tài chính, lấy giao dịch làm chuẩn chứ không lấy ảnh chụp tồn kho hiện tại.',
            'Adjustments write an inventory transaction recording before/after quantities and the operator. Reconciliation relies on transactions, not the current snapshot.',
          ),
        ],
      },
      {
        id: 'stocktake-tips',
        title: T('盘点实操建议', 'Gợi ý thực hành kiểm kê', 'Practical Tips'),
        blocks: [
          ul(
            ['盘点前先停止该仓库的收发料动作，避免边盘边动导致数字对不上。', 'Trước khi kiểm, tạm dừng nhận/xuất kho đó để tránh vừa kiểm vừa động làm số liệu lệch.', 'Pause receiving and issuing in that warehouse during the count to avoid moving targets.'],
            ['按库位顺序逐个区域盘，不要跳着盘，容易漏。', 'Kiểm theo thứ tự từng khu vực vị trí, không nhảy cóc để tránh sót.', 'Count location by location in order; skipping around causes omissions.'],
            ['发现账实不符先记录，不要当场调整库存，统一走盘点差异流程。', 'Khi phát hiện lệch, ghi nhận trước, không điều chỉnh tồn kho tại chỗ; đi theo quy trình chênh lệch kiểm kê.', 'Record discrepancies first; do not adjust on the spot — follow the stock-take variance process.'],
            ['锁定状态或已报废的库存不参与正常盘点调整。', 'Tồn kho bị khóa hoặc đã tiêu hủy không tham gia điều chỉnh kiểm kê thông thường.', 'Locked or scrapped stock does not participate in normal count adjustments.'],
          ),
        ],
      },
    ],
  },
];
