import { type HelpChapter, p, h3, ul, ol, note, table, flow, T } from './helpTypes';

export const qualityChapters: HelpChapter[] = [
  // ================================================================ 13 MRB
  {
    id: 'mrb',
    icon: 'shield-alert',
    title: T('MRB 不合格品评审', 'MRB Đánh giá hàng không đạt', 'MRB Nonconforming Review'),
    summary: T(
      '不合格品如何处置：特采、退货、返工、报废。含两视图、多次评审与拆量处置规则。',
      'Cách xử lý hàng không đạt: chấp nhận đặc biệt, trả hàng, làm lại, tiêu hủy. Gồm hai chế độ xem, đánh giá nhiều lần và quy tắc chia số lượng.',
      'How nonconforming material is dispositioned: special admit, return, rework, scrap — including dual views, repeated reviews and split dispositions.',
    ),
    sections: [
      {
        id: 'mrb-flow',
        title: T('MRB 流程与状态', 'Quy trình và trạng thái MRB', 'MRB Flow & Statuses'),
        blocks: [
          flow(
            ['IQC 判不合格', 'IQC kết luận không đạt', 'IQC fails'],
            ['发起并制定方案', 'Khởi tạo & lập phương án', 'Initiate & plan'],
            ['提交评审', 'Gửi đánh giá', 'Submit for review'],
            ['评审员评审', 'Người đánh giá cho ý kiến', 'Reviewers review'],
            ['IQC 主管审核', 'Trưởng IQC duyệt', 'IQC manager review'],
            ['质量经理审批', 'Quản lý chất lượng phê duyệt', 'Quality manager approval'],
            ['执行处置', 'Thực hiện xử lý', 'Execute disposition'],
          ),
          table(
            [['状态', 'Trạng thái', 'Status'], ['含义', 'Ý nghĩa', 'Meaning']],
            [
              [
                ['draft', 'draft', 'draft'],
                ['评审单已建，未提交', 'Phiếu đánh giá đã tạo, chưa gửi', 'Created, not submitted'],
              ],
              [
                ['pending_review', 'pending_review', 'pending_review'],
                [
                  '待 SQE 制定方案（分配特采/返工/退货/报废数量），撤回或驳回后也回到这里',
                  'Chờ SQE lập phương án (phân bổ số lượng), cũng là nơi quay về sau khi rút lại/trả về',
                  'Awaiting SQE disposition plan; withdrawal or return also lands here',
                ],
              ],
              [
                ['reviewing', 'reviewing', 'reviewing'],
                ['评审员正在给出意见（SQE 可撤回修改）', 'Người đánh giá đang cho ý kiến (SQE có thể rút lại)', 'Reviewers giving opinions (SQE may withdraw)'],
              ],
              [
                ['pending_approval', 'pending_approval', 'pending_approval'],
                ['待 IQC 主管审核，可驳回退回 SQE', 'Chờ trưởng IQC duyệt, có thể trả về SQE', 'Awaiting IQC manager review; may return to SQE'],
              ],
              [
                ['pending_final', 'pending_final', 'pending_final'],
                ['待质量经理审批：通过 / 驳回退回 / 否决并全批退货', 'Chờ quản lý chất lượng: duyệt / trả về / từ chối trả toàn bộ', 'Awaiting quality manager: approve / return / reject whole batch'],
              ],
              [
                ['approved', 'approved', 'approved'],
                ['终审通过，处置生效', 'Duyệt cuối xong, xử lý có hiệu lực', 'Final approved, disposition effective'],
              ],
              [
                ['pending_execute', 'pending_execute', 'pending_execute'],
                ['含退货/返工等下游单据，等待执行完成', 'Có phiếu trả hàng/làm lại, chờ thực hiện xong', 'Has downstream return/rework documents awaiting execution'],
              ],
              [
                ['closed', 'closed', 'closed'],
                ['所有处置执行完毕，流程结束', 'Mọi xử lý đã xong, kết thúc quy trình', 'All dispositions executed, process closed'],
              ],
              [
                ['rejected', 'rejected', 'rejected'],
                ['终审否决，整批退货（不是退回修改）', 'Bị từ chối, trả toàn bộ lô (không phải trả về sửa)', 'Rejected with whole-batch return (not a return for revision)'],
              ],
              [
                ['cancelled', 'cancelled', 'cancelled'],
                ['评审作废', 'Đánh giá bị hủy', 'Review cancelled'],
              ],
            ],
          ),
          note(
            'info',
            '「撤回」与「驳回」都退回 SQE 改方案（回到 pending_review），方案数据保留、已投评审意见清空，改完重新提交即可；两者都不改动库存、不生成下游单。真正结束单据的只有两种：「作废」（draft / pending_review / reviewing 可用，终态）和「否决并全批退货」（终审节点，终态）。',
            '"Rút lại" và "Trả về" đều đưa phiếu về SQE sửa phương án (pending_review): giữ phương án, xóa ý kiến đánh giá, sửa xong gửi lại; cả hai không đổi tồn kho và không tạo phiếu downstream. Chỉ có hai cách kết thúc phiếu: "Hủy" (draft/pending_review/reviewing, trạng thái cuối) và "Từ chối & trả toàn bộ" (nút duyệt cuối, trạng thái cuối).',
            '"Withdraw" and "Return" both send the MRB back to the SQE for plan revision (pending_review): the plan is kept, review opinions are cleared, and resubmitting restarts the flow. Neither changes stock nor creates downstream documents. Only two actions end the MRB: "Cancel" (draft/pending_review/reviewing, terminal) and "Reject & return whole batch" (final approval, terminal).',
          ),
          note(
            'info',
            '「已批准」与「已结案」都算已处理。区别在于：处置若全部即时执行完（如特采、报废）就是 approved；若包含退货、返工等需要下游单据执行的动作，则先进入 pending_execute，等下游单据执行完（或被取消）才变成 closed。',
            '"Đã duyệt" và "Đã kết thúc" đều được coi là đã xử lý. Khác biệt: nếu mọi xử lý hoàn tất ngay (như chấp nhận đặc biệt, tiêu hủy) thì là approved; nếu gồm trả hàng, làm lại cần phiếu下游 thực hiện thì vào pending_execute, khi phiếu下游 xong (hoặc bị hủy) mới thành closed.',
            'Both approved and closed count as handled. The difference: if every disposition executes immediately (special admit, scrap) it becomes approved; if it includes returns or rework needing downstream documents, it first becomes pending_execute and only becomes closed once those finish or are cancelled.',
          ),
        ],
      },
      {
        id: 'mrb-views',
        title: T('两个视图：待处理 / 已处理', 'Hai chế độ xem: Chờ xử lý / Đã xử lý', 'Two Views: Pending / Done'),
        blocks: [
          h3('待处理视图', 'Chế độ Chờ xử lý', 'Pending View'),
          p(
            '待处理视图由两部分组成，理解这两部分是高效处理 MRB 的关键。',
            'Chế độ Chờ xử lý gồm hai phần; hiểu hai phần này là chìa khóa xử lý MRB hiệu quả.',
            'The Pending view has two parts; understanding them is the key to efficient MRB handling.',
          ),
          ul(
            ['上半部分「待发起评审的 IQC 批次」：已判定不合格，但还没有 MRB 单，需要有人去发起。', 'Phần trên "Lô IQC chờ khởi tạo đánh giá": đã kết luận không đạt nhưng chưa có phiếu MRB, cần ai đó khởi tạo.', 'Top part "IQC lots awaiting review initiation": failed but no MRB yet — someone must initiate.'],
            ['下半部分「进行中的 MRB」：已经有 MRB 单，正在等待评审、批准或执行。', 'Phần dưới "MRB đang xử lý": đã có phiếu MRB, đang chờ đánh giá, phê duyệt hoặc thực hiện.', 'Bottom part "MRB in progress": an MRB exists and awaits review, approval or execution.'],
          ),
          h3('一个批次什么时候出现在「待发起」列表', 'Khi nào một lô xuất hiện trong danh sách "chờ khởi tạo"', 'When a Lot Appears in "Awaiting Initiation"'),
          note(
            'info',
            '同时满足两个条件才出现：\n① 该批次没有进行中的 MRB（进行中 = 状态不属于已结案/已批准/已驳回/已取消）\n② 不良品仓有未处理库存，或者（良品仓有锁定库存 且 该批次历史上从未评审过）',
            'Chỉ xuất hiện khi thỏa mãn đồng thời hai điều:\n① Lô chưa có MRB đang xử lý (đang xử lý = trạng thái không thuộc đã kết thúc/đã duyệt/bị bác/bị hủy)\n② Kho hàng lỗi còn tồn chưa xử lý, hoặc (kho hàng tốt có tồn bị khóa VÀ lô chưa từng được đánh giá)',
            'It appears only when both hold:\n① No in-progress MRB for the lot (in-progress = status not closed/approved/rejected/cancelled)\n② The defective warehouse still has unhandled stock, or the good warehouse has locked stock and the lot has never been reviewed',
          ),
          note(
            'tip',
            '第 ② 条的第二个分支（良品仓锁定库存 + 从未评审）用于应对"入库时已在良品仓但被质检锁定"的情形，避免这类批次数值上无不良品却没人处理。',
            'Nhánh thứ hai của điều ② (tồn kho tốt bị khóa + chưa từng đánh giá) dùng cho trường hợp "đã vào kho tốt nhưng bị khóa do kiểm", tránh việc lô này không có hàng lỗi mà cũng không ai xử lý.',
            'The second branch (locked good stock + never reviewed) covers lots already in the good warehouse but locked by QC, so they are not orphaned.',
          ),
          h3('已处理视图（按批次折叠）', 'Chế độ Đã xử lý (gộp theo lô)', 'Done View (Grouped by Lot)'),
          ul(
            ['已处理视图按 IQC 批次折叠：同一批次评审过多次，列表里只显示一行。', 'Chế độ Đã xử lý gộp theo lô IQC: cùng một lô đánh giá nhiều lần chỉ hiển thị một dòng.', 'The Done view groups by IQC lot: a lot reviewed many times shows as one row.'],
            ['行上显示「评审次数」与「最近评审时间」。', 'Dòng hiển thị "số lần đánh giá" và "thời gian đánh giá gần nhất".', 'The row shows review count and latest review time.'],
            ['点击行首箭头展开该批次的历史评审单据。', 'Bấm mũi tên đầu dòng để mở các phiếu đánh giá lịch sử của lô.', 'Click the arrow to expand the lot\'s review history.'],
            ['分页也按批次计数，而不是按单据计数。', 'Phân trang cũng đếm theo lô chứ không theo phiếu.', 'Pagination counts lots, not documents.'],
          ),
        ],
      },
      {
        id: 'mrb-reopen',
        title: T('同一批次可以多次评审', 'Cùng một lô có thể được đánh giá nhiều lần', 'A Lot Can Be Reviewed Multiple Times'),
        blocks: [
          p(
            '这是本系统的重要特性，也容易被误解为"重复建单"。实际上同一 IQC 批次允许多次评审，因为一次评审可能只处理了部分数量。',
            'Đây là đặc điểm quan trọng của hệ thống, dễ bị hiểu nhầm là "tạo phiếu trùng". Thực tế cùng một lô IQC cho phép đánh giá nhiều lần vì một lần có thể chỉ xử lý một phần số lượng.',
            'This is an important feature, often mistaken for duplicate creation. In fact a lot may be reviewed repeatedly because one review may handle only part of the quantity.',
          ),
          ul(
            ['场景一：第一次评审判定"部分退货"，剩余的不良品仍在不良品仓，需要再评审。', 'Tình huống 1: lần đầu kết luận "trả một phần", hàng lỗi còn lại vẫn ở kho lỗi nên cần đánh giá tiếp.', 'Case 1: the first review returns part of the stock; the rest remains defective and needs another review.'],
            ['场景二：首次只做了特采放行，后来又发现问题，需要重新评审剩余部分。', 'Tình huống 2: lần đầu chỉ chấp nhận đặc biệt, sau đó phát hiện vấn đề nên cần đánh giá lại phần còn lại.', 'Case 2: the first review only special-admitted; later issues require reviewing the remainder.'],
            ['场景三：处置结论被质量经理驳回，需要重新走评审。', 'Tình huống 3: kết luận bị trưởng chất lượng bác, cần đánh giá lại.', 'Case 3: the manager rejects the conclusion and a new review is needed.'],
          ),
          note(
            'info',
            '「评审次数」字段记录该批次被评审过几次。已处理列表中的「重新评审」标记表示该行对应的批次是再次发起的评审。',
            'Trường "số lần đánh giá" ghi lại lô đã được đánh giá bao nhiêu lần. Dấu "đánh giá lại" trong danh sách Đã xử lý nghĩa là dòng đó là lần đánh giá khởi tạo lại.',
            'The review count records how many times the lot was reviewed. The "reopened" badge in the Done list marks a repeat review.',
          ),
        ],
      },
      {
        id: 'mrb-disposition',
        title: T('处置方式与拆量', 'Phương thức xử lý và chia số lượng', 'Dispositions & Split Quantities'),
        blocks: [
          table(
            [['处置方式', 'Phương thức xử lý', 'Disposition'], ['库存变化', 'Thay đổi tồn kho', 'Inventory change'], ['是否需要下游单据', 'Cần phiếu hạ nguồn?', 'Downstream document?']],
            [
              [
                ['特采', 'Chấp nhận đặc biệt', 'Special admit'],
                ['转入良品仓，成为可用库存', 'Chuyển vào kho hàng tốt, thành tồn khả dụng', 'Moves to good warehouse as usable stock'],
                ['否，即时生效', 'Không, hiệu lực ngay', 'No, effective immediately'],
              ],
              [
                ['退货', 'Trả hàng', 'Return'],
                ['转为退货冻结，等待退货出库', 'Chuyển sang phong tỏa trả hàng, chờ xuất trả', 'Held for return, awaiting outbound'],
                ['是，生成供应商退货单', 'Có, sinh phiếu trả hàng nhà cung cấp', 'Yes, creates a supplier return order'],
              ],
              [
                ['供应商返工', 'Làm lại tại nhà cung cấp', 'Supplier rework'],
                ['转为返工占用', 'Chuyển sang trạng thái đang làm lại', 'Moves to rework-in-progress'],
                ['是，生成返工单', 'Có, sinh phiếu làm lại', 'Yes, creates a rework order'],
              ],
              [
                ['报废', 'Tiêu hủy', 'Scrap'],
                ['数量核销为 0', 'Ghi giảm số lượng về 0', 'Quantity written down to 0'],
                ['否，即时生效', 'Không, hiệu lực ngay', 'No, effective immediately'],
              ],
              [
                ['其他', 'Khác', 'Other'],
                ['按备注说明处理', 'Xử lý theo ghi chú', 'Handled per the remark'],
                ['视情况', 'Tùy trường hợp', 'Depends'],
              ],
            ],
          ),
          h3('拆量处置（混合处置）', 'Chia số lượng (xử lý hỗn hợp)', 'Split Disposition (Mixed)'),
          p(
            '一批不合格品可以分批处理。例如 100 个不良品中，60 个特采、30 个退货、10 个报废。',
            'Một lô không đạt có thể xử lý theo phần. Ví dụ 100 hàng lỗi: 60 chấp nhận đặc biệt, 30 trả hàng, 10 tiêu hủy.',
            'A nonconforming batch can be split. For example 100 defective units: 60 special admit, 30 return, 10 scrap.',
          ),
          ol(
            [
              '在「发起 MRB」或「制定方案」弹窗，按收货二维码（一箱一码）分配特采 / 返工 / 退货 / 报废的数量。',
              'Trong cửa sổ "Khởi tạo MRB" hoặc "Lập phương án", phân bổ số lượng chấp nhận / làm lại / trả hàng / hủy theo mã QR nhận hàng (mỗi thùng một mã).',
              'In the Initiate MRB or Plan dialog, allocate concession / rework / return / scrap quantities by receipt QR (one QR per box).',
            ],
            [
              '可勾选多行后选「整箱设为某处置」批量填满，也可逐格手填（同一箱可拆到多种处置）。',
              'Có thể chọn nhiều dòng rồi dùng "Đặt cả thùng là..." để điền nhanh, hoặc nhập từng ô (một thùng có thể chia cho nhiều cách xử lý).',
              'Select rows and use "Set whole box as…" to fill in bulk, or type per cell (one box can be split across methods).',
            ],
            [
              '所有格子合计必须等于本次评审数量，单箱分配不得超过箱内数量，否则无法提交。',
              'Tổng tất cả các ô phải bằng số lượng đánh giá; mỗi thùng không được vượt số lượng trong thùng, nếu không không gửi được.',
              'The sum must equal the review quantity and no box may be over-allocated, otherwise submission is blocked.',
            ],
            [
              '提交后进入评审；评审员全部给出意见后依次到 IQC 主管审核、质量经理审批（两级都可驳回退回修改）。',
              'Sau khi gửi sẽ vào đánh giá; khi mọi người đánh giá xong thì lần lượt Trưởng IQC duyệt và Quản lý chất lượng phê duyệt (cả hai đều có thể trả về để sửa).',
              'After submission it enters review; once all reviewers respond it goes to IQC manager review and then quality manager approval (both can return it for revision).',
            ],
            [
              '审批通过后系统按行分别执行：即时类（特采/退货/报废）按调拨与出库流程推进，单据类（返工）生成下游单据等待执行。',
              'Sau khi duyệt, hệ thống thực hiện theo từng dòng: loại tức thời (chấp nhận/trả hàng/tiêu hủy) theo quy trình điều chuyển và xuất kho; loại có phiếu (làm lại) sinh phiếu downstream chờ thực hiện.',
              'After approval the system executes per line: immediate types follow transfer/outbound flows; document types (rework) create downstream documents.',
            ],
          ),
          note(
            'warn',
            '「所有格子合计必须等于本次评审数量」是硬校验。填不满或填超都无法提交，这是为了保证不良品不凭空消失。',
            '"Tổng tất cả các ô phải bằng số lượng đánh giá" là kiểm tra bắt buộc. Thiếu hoặc vượt đều không gửi được, nhằm đảm bảo hàng lỗi không biến mất vô cớ.',
            'The sum must equal the review quantity — a hard rule. Under- or over-filling blocks submission so nonconforming stock cannot vanish.',
          ),
        ],
      },
      {
        id: 'mrb-special',
        title: T('特采放行的后续影响（重点）', 'Ảnh hưởng sau khi chấp nhận đặc biệt (trọng điểm)', 'Downstream Impact of Special Admit (Key)'),
        blocks: [
          p(
            '特采放行后，物料以「良品 + 未锁定 + 特采标记」的形式回到良品仓。',
            'Sau khi chấp nhận đặc biệt, vật tư trở về kho hàng tốt ở dạng "hàng tốt + chưa khóa + dấu chấp nhận đặc biệt".',
            'After a special admit, material returns to the good warehouse as good + unlocked + special-admit flagged.',
          ),
          note(
            'warn',
            '关键事实：发料环节只判断"良品仓且未锁定"，全系统没有任何地方会按特采标记做过滤。也就是说，特采物料在系统里就是普通可用库存，发料时不会弹出"这是特采件"的提示。\n若生产端需要区分（例如特采件必须用在同一批产品上），必须在实物标签或随工单上另行标识，不能依赖系统提醒。',
            'Thực tế quan trọng: khi xuất kho, hệ thống chỉ kiểm tra "kho hàng tốt và chưa khóa"; không có chỗ nào lọc theo dấu chấp nhận đặc biệt. Nghĩa là hàng chấp nhận đặc biệt là tồn khả dụng bình thường, khi xuất kho không hiện cảnh báo "đây là hàng chấp nhận đặc biệt".\nNếu sản xuất cần phân biệt (ví dụ hàng chấp nhận đặc biệt phải dùng cho cùng một lô sản phẩm), phải đánh dấu riêng trên nhãn thực tế hoặc phiếu công đoạn, không thể dựa vào hệ thống.',
            'Key fact: issuing only checks good + unlocked; nothing anywhere filters on the special-admit flag. So special-admit material is ordinary usable stock and issuing shows no reminder.\nIf production must distinguish it (e.g. it must be consumed on the same product batch), mark it physically on the label or traveler — do not rely on the system.',
          ),
          ul(
            ['库存查询中该行会带特采标记与关联的 MRB 单号（special_admit_ref），可用于事后追溯。', 'Dòng tồn kho sẽ mang dấu chấp nhận đặc biệt và số MRB liên quan (special_admit_ref) để truy vết sau.', 'The inventory row carries the special-admit flag and the linked MRB number (special_admit_ref) for traceability.'],
            ['若之后再次发现问题，可重新发起评审（见"同一批次可以多次评审"）。', 'Nếu sau đó lại phát hiện vấn đề, có thể khởi tạo đánh giá lại (xem "một lô có thể đánh giá nhiều lần").', 'If issues resurface, another review can be initiated.'],
            ['特采单据的评审历史完整保留，审计时可查。', 'Lịch sử đánh giá của phiếu chấp nhận đặc biệt được lưu đầy đủ để kiểm toán.', 'The review history of a special admit is fully retained for audit.'],
          ),
        ],
      },
      {
        id: 'mrb-downstream',
        title: T('下游单据：供应商退货、返工与调拨', 'Phiếu sau đánh giá: Trả hàng, làm lại và điều chuyển', 'Downstream: Supplier Return, Rework & Defective Move'),
        blocks: [
          h3('供应商退货单', 'Phiếu trả hàng nhà cung cấp', 'Supplier Return Order'),
          ul(
            ['菜单路径：MRB → 供应商退货。', 'Đường dẫn: MRB → Trả hàng nhà cung cấp.', 'Menu: MRB → Supplier Return.'],
            ['MRB 判定退货后自动生成，库存状态变为 returned（退货冻结）。', 'Sau khi MRB kết luận trả hàng, phiếu tự sinh và tồn kho chuyển thành returned (phong tỏa trả hàng).', 'Created automatically when MRB decides to return; stock becomes returned.'],
            ['仓管员确认出库后，该批物料的库存才真正扣减。', 'Sau khi nhân viên kho xác nhận xuất, tồn kho của lô mới thực sự bị trừ.', 'Only after the keeper confirms outbound is the stock actually decremented.'],
            ['取消退货单时，库存会从 returned 回到 defective，可重新评审。', 'Khi hủy phiếu trả hàng, tồn kho từ returned quay về defective và có thể đánh giá lại.', 'Cancelling the return moves stock from returned back to defective for re-review.'],
          ),
          h3('返工单', 'Phiếu làm lại', 'Rework Order'),
          ul(
            ['菜单路径：MRB → 返工。', 'Đường dẫn: MRB → Làm lại.', 'Menu: MRB → Rework.'],
            ['MRB 判定返工后生成，库存状态变为 rework（返工占用）。', 'Sinh sau khi MRB kết luận làm lại; tồn kho chuyển thành rework.', 'Created when MRB decides rework; stock becomes rework.'],
            [
              '第一步：仓库「开始返工」；第二步：由 SQE「确认返工完成」（签认供应商已做完），系统自动通知本批 IQC 检验员与 IQC 主管复检。',
              'Bước 1: kho "Bắt đầu sửa chữa"; Bước 2: SQE "Xác nhận hoàn tất", hệ thống tự thông báo cho IQC của lô và trưởng IQC.',
              'Step 1: warehouse starts rework; Step 2: SQE confirms completion, and the batch IQC inspector and IQC manager are notified automatically.',
            ],
            [
              '第三步：IQC 在返工单上做「复检确认」。确认合格 → 库存转良品并解锁，立即可发料；确认不合格 → 退回不良并锁定，由 SQE 重新发起 MRB。',
              'Bước 3: IQC xác nhận kiểm tra lại. Đạt → hàng tốt, mở khóa, xuất được ngay; Không đạt → hàng lỗi, khóa lại, SQE tạo lại MRB.',
              'Step 3: IQC confirms re-inspection. Pass → stock becomes good and unlocked for immediate issuing; Fail → back to defective and locked, SQE starts a new MRB.',
            ],
            ['确认返工完成前、复检确认合格前，该批物料都不可发料。', 'Trước khi SQE xác nhận và IQC kiểm lại đạt, lô đó không xuất được.', 'The batch cannot be issued until the SQE confirmation and a passed re-inspection.'],
          ),
          h3('不良品调拨', 'Điều chuyển hàng lỗi', 'Defective Move'),
          ul(
            [
              '菜单路径：库存 → 不良品调拨（作业台：制单、主管确认、扫码执行）；库存 → 不良品调拨单（台账查询）。',
              'Đường dẫn: Kho → Điều chuyển hàng lỗi (bàn làm việc: tạo phiếu, quản lý duyệt, quét mã thực hiện); Kho → Phiếu điều chuyển hàng lỗi (tra cứu sổ phiếu).',
              'Menu: Inventory → Defective Move (workbench: create, approve, scan-execute); Inventory → Defective Move Orders (ledger).',
            ],
            [
              'MRB 判退货、报废或终审否决时自动生成调拨单，同时给仓管员、仓库主管推送站内消息，点消息直接进入作业台。',
              'Phiếu tự sinh khi MRB kết luận trả hàng, hủy hàng hoặc bác bỏ, đồng thời gửi thông báo cho nhân viên kho và trưởng kho; bấm thông báo để vào bàn làm việc.',
              'An order is created automatically when MRB decides return, scrap or final reject, with an in-app notice to keepers and warehouse managers linking straight to the workbench.',
            ],
            [
              '良品仓库存若在生产过程中发现不良，由仓管员「制单」选来源库存与数量，仓库主管「确认生效」后锁库存，再由仓管员扫码执行；主管也可驳回。',
              'Nếu phát hiện hàng lỗi trong kho thành phẩm, thủ kho tạo phiếu (chọn tồn nguồn và số lượng), quản lý kho duyệt (khóa tồn), sau đó thủ kho quét mã thực hiện; quản lý có thể từ chối.',
              'If good stock is found defective in production, the keeper creates an order (source stock + quantity); the warehouse manager approves it (locking the stock), then the keeper scans to execute. The manager may also reject.',
            ],
            [
              '执行必须扫码，不能直接选库位：先扫货物六段码（系统校验物料 + 批次是否属于本单），再扫不良品仓库位码；扫错立即拒绝，避免搬错货。',
              'Khi thực hiện bắt buộc quét mã, không được chọn vị trí trực tiếp: quét mã 6 đoạn của hàng (hệ thống kiểm tra vật tư + lô thuộc phiếu), rồi quét mã vị trí kho hàng lỗi; sai sẽ bị từ chối ngay.',
              'Execution requires scanning, never picking a location: scan the 6-segment goods label (material + batch validated against the order), then scan the defective location code. A mismatch is rejected immediately.',
            ],
            [
              '目标库位必须属于不良品仓；调拨完成后才能做退货出库或报废销毁。已完成/已取消的单据保留扫码凭据，可按单号、物料、批次查询。',
              'Vị trí đích phải thuộc kho hàng lỗi; chỉ sau khi điều chuyển xong mới xuất trả hoặc tiêu hủy được. Phiếu đã xong/đã hủy lưu chứng từ quét mã, tìm theo số phiếu, vật tư, lô.',
              'The target must be a defective-warehouse location. Return outbound or scrap destruction only works after the move. Completed/cancelled orders keep scan evidence and are searchable by order No., material and batch.',
            ],
            [
              '单号即追溯链：MRB 单号为「检验单号-MRB」（重开加 -02），调拨单为「检验单号-NGDB」（同一 MRB 第二张加 -02），良品仓手工制单为 NGDB+日期-流水。列表可直接输入检验单号（JY…）检索。',
              'Số phiếu chính là chuỗi truy xuất: MRB = "số kiểm tra-MRB" (mở lại thêm -02), điều chuyển = "số kiểm tra-NGDB" (phiếu thứ hai thêm -02), phiếu tạo tay từ kho thành phẩm = NGDB+ngày-số thứ tự. Có thể tìm trực tiếp bằng số kiểm tra (JY…).',
              'The number is the traceability chain: MRB = "inspection No.-MRB" (re-opened adds -02), defective move = "inspection No.-NGDB" (second order adds -02), manual order from good stock = NGDB+date-serial. Lists can be searched directly by inspection No. (JY…).',
            ],
          ),
          note(
            'info',
            'MRB 终审后若含退货、返工或报废，单据状态会是 pending_execute（待执行）。退货需先调拨再出库、报废需先调拨再销毁、返工需完成并复检合格，全部执行完成后 MRB 才自动变为 closed（已结案）。',
            'Sau khi duyệt cuối, nếu có trả hàng, làm lại hoặc hủy hàng, phiếu ở trạng thái pending_execute. Trả hàng phải điều chuyển rồi xuất; hủy hàng phải điều chuyển rồi tiêu hủy; làm lại phải hoàn tất và kiểm lại đạt. Khi tất cả xong, MRB tự chuyển thành closed.',
            'If the final approval includes return, rework or scrap, the MRB becomes pending_execute. Return must be moved then shipped out; scrap must be moved then destroyed; rework must finish with a passed re-inspection. Only when all are done does the MRB become closed.',
          ),
        ],
      },
    ],
  },

  // ================================================================ 14 系统设置
  {
    id: 'system',
    icon: 'settings',
    title: T('系统设置', 'Cài đặt hệ thống', 'System Settings'),
    summary: T(
      '参数、角色、账号三个模块，仅系统管理员可进入。',
      'Ba mô-đun: Tham số, Vai trò, Tài khoản — chỉ quản trị viên vào được.',
      'Parameters, roles and accounts — administrator only.',
    ),
    sections: [
      {
        id: 'system-param',
        title: T('系统参数', 'Tham số hệ thống', 'System Parameters'),
        blocks: [
          ul(
            ['菜单路径：系统设置 → 参数。', 'Đường dẫn: Cài đặt hệ thống → Tham số.', 'Menu: System Settings → Parameters.'],
            ['用于配置系统级开关与阈值，例如是否启用某些校验、默认值等。', 'Dùng để cấu hình công tắc và ngưỡng cấp hệ thống, ví dụ bật/tắt một số kiểm tra, giá trị mặc định.', 'Configure system-level switches and thresholds, e.g. enabling validations or setting defaults.'],
            ['修改参数会影响全系统行为，变更前请确认影响范围并记录变更原因。', 'Thay đổi tham số ảnh hưởng toàn hệ thống; trước khi đổi hãy xác nhận phạm vi ảnh hưởng và ghi lý do.', 'Parameter changes affect the whole system; confirm the impact and record the reason before changing.'],
          ),
          note(
            'warn',
            '参数页面不对普通角色开放。若业务确实需要调整，请通过系统管理员执行，不要共用管理员账号自行修改。',
            'Trang tham số không mở cho vai trò thường. Nếu nghiệp vụ cần điều chỉnh, hãy để quản trị viên thực hiện, đừng dùng chung tài khoản quản trị để tự sửa.',
            'The parameter page is not open to normal roles. Ask the administrator rather than sharing an admin account.',
          ),
        ],
      },
      {
        id: 'system-role',
        title: T('角色管理', 'Quản lý vai trò', 'Role Management'),
        blocks: [
          ul(
            ['菜单路径：系统设置 → 角色。', 'Đường dẫn: Cài đặt hệ thống → Vai trò.', 'Menu: System Settings → Roles.'],
            ['每个角色配置一组可访问的菜单路径（menu_permissions）。', 'Mỗi vai trò cấu hình một tập đường dẫn menu được truy cập (menu_permissions).', 'Each role is configured with a set of allowed menu paths (menu_permissions).'],
            ['调整角色权限后，持有该角色的账号重新登录即可生效。', 'Sau khi điều chỉnh quyền của vai trò, tài khoản giữ vai trò đó đăng nhập lại là có hiệu lực.', 'After changing a role, accounts holding it take effect on their next login.'],
            ['新增菜单路径时需同步给相关角色授权，否则该菜单不会出现。', 'Khi thêm đường dẫn menu mới, phải cấp cho các vai trò liên quan, nếu không menu sẽ không xuất hiện.', 'When adding a new menu path, grant it to the relevant roles or the menu will not appear.'],
          ),
        ],
      },
      {
        id: 'system-account',
        title: T('账号管理', 'Quản lý tài khoản', 'Account Management'),
        blocks: [
          ul(
            ['菜单路径：系统设置 → 账号。', 'Đường dẫn: Cài đặt hệ thống → Tài khoản.', 'Menu: System Settings → Accounts.'],
            ['创建账号时需要指定账号名、姓名与所属角色。', 'Khi tạo tài khoản cần chỉ định tên đăng nhập, họ tên và vai trò.', 'Creating an account requires an account name, display name and role.'],
            ['角色决定该账号可见的菜单范围。', 'Vai trò quyết định phạm vi menu mà tài khoản thấy được.', 'The role determines which menus the account can see.'],
            ['员工离职或转岗时，应及时停用或调整账号，避免权限滞留。', 'Khi nhân viên nghỉ việc hoặc chuyển vị trí, cần vô hiệu hóa hoặc điều chỉnh tài khoản kịp thời để tránh tồn quyền.', 'When staff leave or transfer, disable or adjust accounts promptly to avoid stale permissions.'],
            ['首次登录可能被要求修改初始密码，请按提示完成。', 'Lần đăng nhập đầu có thể yêu cầu đổi mật khẩu ban đầu; hãy làm theo hướng dẫn.', 'The first login may require changing the initial password; follow the prompt.'],
          ),
        ],
      },
    ],
  },

  // ================================================================ 15 PDA
  {
    id: 'pda',
    icon: 'smartphone',
    title: T('PDA 移动端', 'PDA Thiết bị di động', 'PDA Mobile Client'),
    summary: T(
      '现场扫码作业终端：功能清单、扫码技巧、HTTPS 要求与音频提示。',
      'Thiết bị quét mã tại chỗ: danh sách chức năng, mẹo quét mã, yêu cầu HTTPS và âm thanh thông báo.',
      'The on-site scanning terminal: feature list, scanning tips, HTTPS requirement and audio feedback.',
    ),
    sections: [
      {
        id: 'pda-entry',
        title: T('进入与界面', 'Truy cập và giao diện', 'Access & Interface'),
        blocks: [
          ul(
            ['在移动设备浏览器访问同一个系统地址，系统会自动跳转到 PDA 端登录页。', 'Truy cập cùng địa chỉ hệ thống bằng trình duyệt di động; hệ thống tự chuyển đến trang đăng nhập PDA.', 'Open the same system URL on a mobile browser; it redirects to the PDA login automatically.'],
            ['PDA 首页是任务卡片网格，只显示当前角色有权限的功能。', 'Trang chủ PDA là lưới thẻ nhiệm vụ, chỉ hiển thị chức năng mà vai trò hiện tại có quyền.', 'The PDA home is a grid of task cards showing only what your role allows.'],
            ['卡片右上角的红色数字是待办数量，例如待收料箱数、待领料单数。', 'Số đỏ ở góc phải thẻ là số việc chờ, ví dụ số thùng chờ nhận, số phiếu chờ lĩnh.', 'The red badge shows pending counts, e.g. boxes to receive or orders to pick.'],
            ['顶部有返回按钮、页面标题与语言切换按钮；底部有「切换到电脑版」。', 'Phía trên có nút quay lại, tiêu đề trang và nút đổi ngôn ngữ; phía dưới có "Chuyển sang bản máy tính".', 'The top has back, title and language buttons; the bottom has Switch to Desktop.'],
          ),
        ],
      },
      {
        id: 'pda-features',
        title: T('PDA 功能清单', 'Danh sách chức năng PDA', 'PDA Feature List'),
        blocks: [
          table(
            [['功能', 'Chức năng', 'Function'], ['用途', 'Mục đích', 'Purpose'], ['可用角色', 'Vai trò được dùng', 'Available roles']],
            [
              [
                ['扫码收货', 'Quét mã nhận hàng', 'Scan Receipt'],
                ['现场扫描来料标签入库', 'Quét nhãn hàng đến tại chỗ để nhập kho', 'Scan incoming labels on site'],
                ['仓管员、仓库主管', 'Nhân viên kho, Trưởng kho', 'Warehouse Keeper, Manager'],
              ],
              [
                ['收货单', 'Phiếu nhận hàng', 'Receipt Orders'],
                ['查看已收货单据', 'Xem phiếu đã nhận', 'View received orders'],
                ['仓管员、仓库主管', 'Nhân viên kho, Trưởng kho', 'Warehouse Keeper, Manager'],
              ],
              [
                ['内部调拨', 'Điều chuyển nội bộ', 'Intra Transfer'],
                ['同仓库内换库位', 'Đổi vị trí trong cùng kho', 'Move within a warehouse'],
                ['仓管员、仓库主管', 'Nhân viên kho, Trưởng kho', 'Warehouse Keeper, Manager'],
              ],
              [
                ['库存调拨', 'Điều chuyển kho', 'Stock Transfer'],
                ['跨仓库调拨', 'Điều chuyển giữa các kho', 'Move across warehouses'],
                ['仓管员、仓库主管', 'Nhân viên kho, Trưởng kho', 'Warehouse Keeper, Manager'],
              ],
              [
                ['不良品转移', 'Chuyển hàng lỗi', 'Defective Move'],
                ['良品仓与不良品仓之间移动', 'Di chuyển giữa kho tốt và kho lỗi', 'Move between good and defective'],
                ['仓管员、仓库主管', 'Nhân viên kho, Trưởng kho', 'Warehouse Keeper, Manager'],
              ],
              [
                ['库存查询', 'Tra cứu tồn kho', 'Inventory Query'],
                ['现场查询物料在哪个库位', 'Tra cứu tại chỗ vật tư ở vị trí nào', 'Look up where material is'],
                ['仓管员、仓库主管', 'Nhân viên kho, Trưởng kho', 'Warehouse Keeper, Manager'],
              ],
              [
                ['领料', 'Lĩnh vật tư', 'Picking'],
                ['按领料单扫码发料', 'Quét mã xuất theo phiếu lĩnh', 'Scan-issue against a picking order'],
                ['生产物料员、生产主管', 'Nhân viên vật tư, Trưởng sản xuất', 'Material Handler, Production Manager'],
              ],
              [
                ['补料', 'Bổ sung vật tư', 'Supplement'],
                ['现场申请/执行补料', 'Yêu cầu/thực hiện bổ sung tại chỗ', 'Request or execute supplementation'],
                ['生产物料员、生产主管', 'Nhân viên vật tư, Trưởng sản xuất', 'Material Handler, Production Manager'],
              ],
              [
                ['MRB', 'MRB', 'MRB'],
                ['查看与处理评审任务', 'Xem và xử lý nhiệm vụ đánh giá', 'View and handle review tasks'],
                ['MRB 评审员、质量经理、SQE', 'Người đánh giá MRB, Trưởng chất lượng, SQE', 'MRB Reviewer, Quality Manager, SQE'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'pda-https',
        title: T('HTTPS 与摄像头扫码', 'HTTPS và quét mã bằng camera', 'HTTPS & Camera Scanning'),
        blocks: [
          note(
            'warn',
            '浏览器出于安全限制，只有 HTTPS 页面才能调用摄像头。用 HTTP 访问时，摄像头扫码不可用，只能用扫码枪或手工输入。',
            'Do giới hạn bảo mật của trình duyệt, chỉ trang HTTPS mới gọi được camera. Khi truy cập HTTP, quét bằng camera không dùng được, chỉ dùng súng quét hoặc nhập tay.',
            'Browsers only allow camera access on HTTPS pages. Over HTTP, camera scanning is unavailable — use a scanner gun or manual entry.',
          ),
          ul(
            ['若顶部出现黄色警告条「当前为 HTTP 访问」，点右侧「切换 HTTPS」按钮跳转到安全地址。', 'Nếu đầu trang có dải cảnh báo vàng "Đang truy cập HTTP", bấm nút "Chuyển HTTPS" bên phải để sang địa chỉ an toàn.', 'If a yellow banner says you are on HTTP, click Switch HTTPS on the right.'],
            ['若提示「证书未被信任」，说明 HTTPS 已启用但证书未安装到设备，需要先安装证书。', 'Nếu báo "chứng chỉ không được tin cậy", nghĩa là HTTPS đã bật nhưng chứng chỉ chưa cài trên thiết bị; cần cài chứng chỉ trước.', 'If it says the certificate is untrusted, HTTPS is on but the certificate is not installed on the device.'],
            ['扫码枪不需要 HTTPS，通过蓝牙或 USB 连接后直接以键盘方式输入。', 'Súng quét mã không cần HTTPS; kết nối Bluetooth hoặc USB rồi nhập như bàn phím.', 'Scanner guns do not need HTTPS; pair via Bluetooth or USB and they type like a keyboard.'],
          ),
        ],
      },
      {
        id: 'pda-audio',
        title: T('音频提示与音频测试', 'Âm thanh thông báo và kiểm tra âm thanh', 'Audio Feedback & Test'),
        blocks: [
          ul(
            ['扫码成功会有提示音并播报结果，方便在嘈杂车间不看屏幕也能确认。', 'Quét thành công có âm báo và đọc kết quả, giúp xác nhận ngay cả trong xưởng ồn mà không cần nhìn màn hình.', 'A successful scan beeps and speaks the result so you can confirm in a noisy shop floor without looking.'],
            ['浏览器要求先有一次用户交互才允许播放声音，因此打开页面后请先点任意按钮激活音频。', 'Trình duyệt yêu cầu có một lần tương tác người dùng mới cho phát âm thanh; sau khi mở trang hãy bấm một nút bất kỳ để kích hoạt.', 'Browsers require a user interaction before playing audio; tap any button after opening the page to activate sound.'],
            ['PDA 首页有「音频测试」按钮，会播放提示音并播报语音，用于排查音量或静音问题。', 'Trang chủ PDA có nút "Kiểm tra âm thanh", phát âm báo kèm giọng nói để kiểm tra âm lượng hoặc chế độ im lặng.', 'The PDA home has an Audio Test button that plays a beep and speech to diagnose volume or mute issues.'],
            ['听不到声音时依次检查：设备是否静音、媒体音量是否为 0、是否已完成一次页面点击。', 'Khi không nghe thấy, kiểm tra lần lượt: thiết bị có im lặng không, âm lượng media có bằng 0 không, đã bấm vào trang một lần chưa.', 'If silent, check in order: device mute, media volume at zero, and whether you tapped the page once.'],
          ),
        ],
      },
      {
        id: 'pda-tips',
        title: T('现场使用建议', 'Gợi ý sử dụng tại chỗ', 'Field Usage Tips'),
        blocks: [
          ul(
            ['用完必须退出登录，扫描终端是共用设备，不退出等于把权限借给别人。', 'Phải đăng xuất sau khi dùng; thiết bị quét là dùng chung, không thoát nghĩa là cho người khác mượn quyền.', 'Always log out — the terminal is shared, and staying logged in lends your permissions to others.'],
            ['车间光线不足时优先用扫码枪，摄像头识别率会下降。', 'Khi xưởng thiếu sáng, ưu tiên dùng súng quét; tỷ lệ nhận diện của camera sẽ giảm.', 'In low light prefer the scanner gun; camera recognition degrades.'],
            ['标签褶皱、污损、反光都会导致扫不出，可换个角度或改手工输入。', 'Nhãn nhăn, bẩn, phản sáng đều gây không quét được; đổi góc hoặc nhập tay.', 'Wrinkled, dirty or reflective labels fail to scan; change the angle or enter manually.'],
            ['PDA 需要切换回电脑版时，点页面底部的「切换到电脑版」。', 'Khi cần quay lại bản máy tính, bấm "Chuyển sang bản máy tính" ở cuối trang PDA.', 'To return to the desktop version, click Switch to Desktop at the bottom of the PDA page.'],
          ),
        ],
      },
    ],
  },

  // ================================================================ 16 速查与FAQ
  {
    id: 'reference',
    icon: 'book',
    title: T('速查表与常见问题', 'Bảng tra nhanh và câu hỏi thường gặp', 'Quick Reference & FAQ'),
    summary: T(
      '状态字典、术语三语对照、常见报错处理方式。遇到问题先查这里。',
      'Từ điển trạng thái, thuật ngữ ba ngôn ngữ, cách xử lý lỗi thường gặp. Gặp vấn đề hãy tra ở đây trước.',
      'Status dictionary, trilingual glossary and common error handling. Check here first.',
    ),
    sections: [
      {
        id: 'ref-status',
        title: T('全局状态速查', 'Tra nhanh trạng thái toàn hệ thống', 'Global Status Quick Reference'),
        blocks: [
          table(
            [['所属模块', 'Mô-đun', 'Module'], ['状态', 'Trạng thái', 'Status'], ['含义', 'Ý nghĩa', 'Meaning']],
            [
              [['收货单', 'Phiếu nhận hàng', 'Receipt'], ['received', 'received', 'received'], ['已扫码，未提交质检', 'Đã quét, chưa gửi kiểm', 'Scanned, not submitted']],
              [['收货单', 'Phiếu nhận hàng', 'Receipt'], ['pending_iqc', 'pending_iqc', 'pending_iqc'], ['已提交，等待检验', 'Đã gửi, chờ kiểm', 'Submitted, awaiting inspection']],
              [['IQC', 'IQC', 'IQC'], ['pending', 'pending', 'pending'], ['等待检验员录入结果', 'Chờ nhân viên nhập kết quả', 'Awaiting results']],
              [['IQC 严格度', 'Mức nghiêm IQC', 'IQC Strictness'], ['tightened', 'tightened', 'tightened'], ['提高抽检比例', 'Tăng tỷ lệ lấy mẫu', 'Higher sampling']],
              [['IQC 严格度', 'Mức nghiêm IQC', 'IQC Strictness'], ['normal', 'normal', 'normal'], ['标准力度', 'Mức tiêu chuẩn', 'Standard level']],
              [['IQC 严格度', 'Mức nghiêm IQC', 'IQC Strictness'], ['reduced', 'reduced', 'reduced'], ['降低抽检比例', 'Giảm tỷ lệ lấy mẫu', 'Lower sampling']],
              [['IQC 严格度', 'Mức nghiêm IQC', 'IQC Strictness'], ['exempt', 'exempt', 'exempt'], ['外观与尺寸均免检', 'Miễn kiểm ngoại quan và kích thước', 'Appearance and dimension waived']],
              [['IQC 严格度', 'Mức nghiêm IQC', 'IQC Strictness'], ['suspended', 'suspended', 'suspended'], ['停止收货或强制全检', 'Dừng nhận hoặc kiểm toàn bộ', 'Stop receiving or 100% inspect']],
              [['库存', 'Tồn kho', 'Inventory'], ['good', 'good', 'good'], ['可用库存', 'Tồn khả dụng', 'Usable stock']],
              [['库存', 'Tồn kho', 'Inventory'], ['defective', 'defective', 'defective'], ['待 MRB 处置', 'Chờ xử lý MRB', 'Awaiting MRB']],
              [['库存', 'Tồn kho', 'Inventory'], ['returned', 'returned', 'returned'], ['已生成退货单', 'Đã sinh phiếu trả hàng', 'Return order created']],
              [['库存', 'Tồn kho', 'Inventory'], ['rework', 'rework', 'rework'], ['返工中', 'Đang làm lại', 'In rework']],
              [['库存', 'Tồn kho', 'Inventory'], ['scrapped', 'scrapped', 'scrapped'], ['已判报废，待销毁（销毁后为 0）', 'Đã quyết tiêu hủy, chờ tiêu hủy (về 0 sau đó)', 'Marked scrap, pending destruction (0 once destroyed)']],
              [['MRB', 'MRB', 'MRB'], ['reviewing', 'reviewing', 'reviewing'], ['评审员正在给意见', 'Người đánh giá đang cho ý kiến', 'Reviewers giving opinions']],
              [['MRB', 'MRB', 'MRB'], ['pending_final', 'pending_final', 'pending_final'], ['等待质量经理', 'Chờ trưởng chất lượng', 'Awaiting quality manager']],
              [['MRB', 'MRB', 'MRB'], ['pending_execute', 'pending_execute', 'pending_execute'], ['下游单据未完成', 'Phiếu下游 chưa xong', 'Downstream not finished']],
              [['MRB', 'MRB', 'MRB'], ['closed', 'closed', 'closed'], ['全部处置执行完毕', 'Mọi xử lý đã xong', 'All dispositions done']],
              [['盘点单', 'Phiếu kiểm kê', 'Stock-Take'], ['draft', 'draft', 'draft'], ['盘点进行中', 'Đang kiểm kê', 'Counting in progress']],
              [['盘点单', 'Phiếu kiểm kê', 'Stock-Take'], ['pending_approval', 'pending_approval', 'pending_approval'], ['等待主管批准', 'Chờ trưởng duyệt', 'Awaiting manager approval']],
              [['盘点单', 'Phiếu kiểm kê', 'Stock-Take'], ['approved', 'approved', 'approved'], ['库存已调整', 'Tồn kho đã điều chỉnh', 'Inventory adjusted']],
              [['领料单', 'Phiếu lĩnh', 'Picking'], ['pending_approval', 'pending_approval', 'pending_approval'], ['等待生产主管', 'Chờ trưởng sản xuất', 'Awaiting production manager']],
              [['领料单', 'Phiếu lĩnh', 'Picking'], ['approved', 'approved', 'approved'], ['可发料', 'Có thể phát hàng', 'Ready to issue']],
              [['领料单', 'Phiếu lĩnh', 'Picking'], ['issued', 'issued', 'issued'], ['库存已扣减', 'Đã trừ tồn kho', 'Stock decremented']],
            ],
          ),
        ],
      },
      {
        id: 'ref-glossary',
        title: T('术语三语对照', 'Thuật ngữ ba ngôn ngữ', 'Trilingual Glossary'),
        blocks: [
          table(
            [['中文', 'Tiếng Trung', 'Chinese'], ['Tiếng Việt', 'Tiếng Việt', 'Vietnamese'], ['English', 'Tiếng Anh', 'English']],
            [
              [['收料 / 收货', 'Nhận hàng', 'Receiving'], ['Nhận hàng', 'Nhận hàng', 'Receiving'], ['Receiving', 'Receiving', 'Receiving']],
              [['发料 / 出库', 'Xuất kho', 'Issuing'], ['Xuất kho', 'Xuất kho', 'Issuing'], ['Issuing', 'Issuing', 'Issuing']],
              [['库存', 'Tồn kho', 'Inventory'], ['Tồn kho', 'Tồn kho', 'Inventory'], ['Inventory', 'Inventory', 'Inventory']],
              [['库位', 'Vị trí', 'Location'], ['Vị trí', 'Vị trí', 'Location'], ['Location', 'Location', 'Location']],
              [['批次 / 批号', 'Số lô', 'Batch No.'], ['Số lô', 'Số lô', 'Batch No.'], ['Batch No.', 'Batch No.', 'Batch No.']],
              [['盘点', 'Kiểm kê', 'Stock-take'], ['Kiểm kê', 'Kiểm kê', 'Stock-take'], ['Stock-take', 'Stock-take', 'Stock-take']],
              [['调拨', 'Điều chuyển', 'Transfer'], ['Điều chuyển', 'Điều chuyển', 'Transfer'], ['Transfer', 'Transfer', 'Transfer']],
              [['领料单', 'Phiếu lĩnh vật tư', 'Picking Order'], ['Phiếu lĩnh vật tư', 'Phiếu lĩnh vật tư', 'Picking Order'], ['Picking Order', 'Picking Order', 'Picking Order']],
              [['工单', 'Lệnh sản xuất', 'Work Order'], ['Lệnh sản xuất', 'Lệnh sản xuất', 'Work Order'], ['Work Order', 'Work Order', 'Work Order']],
              [['物料需求', 'Nhu cầu vật tư', 'Material Requirement'], ['Nhu cầu vật tư', 'Nhu cầu vật tư', 'Material Requirement'], ['Material Requirement', 'Material Requirement', 'Material Requirement']],
              [['补料 / 超领', 'Bổ sung / Lĩnh vượt', 'Supplement / Over-pick'], ['Bổ sung / Lĩnh vượt', 'Bổ sung / Lĩnh vượt', 'Supplement / Over-pick'], ['Supplement / Over-pick', 'Supplement / Over-pick', 'Supplement / Over-pick']],
              [['退料', 'Hoàn trả vật tư', 'Material Return'], ['Hoàn trả vật tư', 'Hoàn trả vật tư', 'Material Return'], ['Material Return', 'Material Return', 'Material Return']],
              [['不良品', 'Hàng lỗi', 'Defective'], ['Hàng lỗi', 'Hàng lỗi', 'Defective'], ['Defective', 'Defective', 'Defective']],
              [['报废', 'Tiêu hủy', 'Scrap'], ['Tiêu hủy', 'Tiêu hủy', 'Scrap'], ['Scrap', 'Scrap', 'Scrap']],
              [['返工', 'Làm lại', 'Rework'], ['Làm lại', 'Làm lại', 'Rework'], ['Rework', 'Rework', 'Rework']],
              [['特采', 'Chấp nhận đặc biệt', 'Special Admit'], ['Chấp nhận đặc biệt', 'Chấp nhận đặc biệt', 'Special Admit'], ['Special Admit', 'Special Admit', 'Special Admit']],
              [['退货', 'Trả hàng', 'Return Goods'], ['Trả hàng', 'Trả hàng', 'Return Goods'], ['Return Goods', 'Return Goods', 'Return Goods']],
              [['欠料 / 债务', 'Nợ vật tư', 'Debt'], ['Nợ vật tư', 'Nợ vật tư', 'Debt'], ['Debt', 'Debt', 'Debt']],
              [['锁定', 'Khóa', 'Lock'], ['Khóa', 'Khóa', 'Lock'], ['Lock', 'Lock', 'Lock']],
              [['免检', 'Miễn kiểm', 'Exempt'], ['Miễn kiểm', 'Miễn kiểm', 'Exempt'], ['Exempt', 'Exempt', 'Exempt']],
              [['加严', 'Siết chặt', 'Tightened'], ['Siết chặt', 'Siết chặt', 'Tightened'], ['Tightened', 'Tightened', 'Tightened']],
              [['放宽', 'Nới lỏng', 'Reduced'], ['Nới lỏng', 'Nới lỏng', 'Reduced'], ['Reduced', 'Reduced', 'Reduced']],
              [['先进先出', 'Nhập trước xuất trước', 'FIFO'], ['Nhập trước xuất trước', 'Nhập trước xuất trước', 'FIFO'], ['FIFO', 'FIFO', 'FIFO']],
            ],
          ),
        ],
      },
      {
        id: 'ref-faq',
        title: T('常见问题', 'Câu hỏi thường gặp', 'Frequently Asked Questions'),
        blocks: [
          h3('扫码收货相关', 'Liên quan quét mã nhận hàng', 'About Scanning Receipts'),
          ul(
            ['提示「非认可物料」→ 二维码里的料号在物料表中不存在。检查是否拼错、大小写不符，或该物料尚未建档。', '"Vật tư không được công nhận" → mã vật tư trong QR không có trong bảng vật tư. Kiểm tra sai chính tả, chữ hoa/thường, hoặc vật tư chưa được tạo.', '"Unregistered material" → the part number is not in the material table. Check for typos, case, or that the material exists.'],
            ['提示「非合格供应商」→ 料号存在，但二维码里的供应商与该物料的默认供应商不一致。', '"Nhà cung cấp không đạt" → mã vật tư có, nhưng nhà cung cấp trong QR khác nhà cung cấp mặc định của vật tư.', '"Unqualified supplier" → the part exists but the QR supplier differs from the material default supplier.'],
            ['提示「该标签已被扫码收货」→ 这箱已经收过了。整串六段码完全相同才会判重，别把不同箱子当成重复。', '"Nhãn này đã được quét nhận" → thùng này đã nhận rồi. Chỉ coi là trùng khi toàn bộ chuỗi sáu đoạn giống hệt; đừng nhầm các thùng khác nhau là trùng.', '"This label was already received" → the box was already scanned. Only an identical full six-segment string counts as duplicate.'],
            ['提示「二维码格式错误」→ 六段码不完整或数量非数字。检查标签是否有缺段、分隔符是否为星号。', '"Lỗi định dạng mã QR" → mã sáu đoạn thiếu hoặc số lượng không phải số. Kiểm tra nhãn thiếu đoạn hay dấu phân tách không phải dấu sao.', '"Invalid QR format" → the six-segment code is incomplete or the quantity is not numeric.'],
          ),
          h3('库存相关', 'Liên quan tồn kho', 'About Inventory'),
          ul(
            ['收完货在库存里查不到 → 收货后库存处于「待检 + 锁定」，需要 IQC 检验合格后才成为可用库存。', 'Nhận xong mà không thấy trong tồn kho → sau khi nhận, tồn kho ở trạng thái "chờ kiểm + khóa"; phải IQC đạt mới thành tồn khả dụng.', 'Received but not visible → stock is pending inspection and locked until IQC passes.'],
            ['有库存但发不出去 → 检查该行是否被锁定，或是否在不良品仓。发料只认可用且未锁定的良品库存。', 'Có tồn nhưng không xuất được → kiểm tra dòng đó có bị khóa không, hoặc có ở kho hàng lỗi không. Xuất kho chỉ nhận hàng tốt chưa khóa.', 'Stock exists but cannot issue → check whether the row is locked or in the defective warehouse.'],
            ['盘点调整被拒 → 锁定状态下的库存不允许通过盘点调整改数量，需管理员强制调整。', 'Điều chỉnh kiểm kê bị từ chối → tồn kho đang khóa không cho đổi số lượng qua kiểm kê; cần quản trị viên cưỡng bức điều chỉnh.', 'Adjustment rejected → locked stock cannot be adjusted via stock-take; an administrator must force it.'],
          ),
          h3('MRB 相关', 'Liên quan MRB', 'About MRB'),
          ul(
            ['批次明明有不良品，却不在「待发起」列表 → 该批次可能已有进行中的 MRB 单。切到「进行中的 MRB」查看。', 'Lô rõ ràng có hàng lỗi mà không ở danh sách "chờ khởi tạo" → lô đó có thể đã có MRB đang xử lý. Chuyển sang "MRB đang xử lý" để xem.', 'Defective stock exists but the lot is not listed → an MRB may already be in progress; check the in-progress list.'],
            ['MRB 终审提交失败，提示数量不符 → 各处置行数量之和必须等于 MRB 总数。', 'Gửi duyệt cuối MRB thất bại, báo số lượng không khớp → tổng số lượng các dòng xử lý phải bằng tổng số MRB.', 'Final approval fails with a quantity mismatch → disposition quantities must sum to the MRB total.'],
            ['MRB 已批准但状态不是「已结案」→ 若含退货或返工，需等下游单据执行完成后才自动结案。', 'MRB đã duyệt nhưng chưa "kết thúc" → nếu có trả hàng hoặc làm lại, phải chờ phiếu下游 thực hiện xong mới tự kết thúc.', 'Approved but not closed → with returns or rework, it closes only after downstream documents complete.'],
            ['同一批次出现多张 MRB 单 → 属正常，系统允许同一批次多次评审（例如部分退货后剩余再评审）。', 'Cùng lô xuất hiện nhiều phiếu MRB → bình thường; hệ thống cho đánh giá nhiều lần (ví dụ trả một phần rồi đánh giá phần còn lại).', 'Multiple MRBs for one lot → normal; repeated reviews are allowed.'],
          ),
          h3('发料与盘点', 'Liên quan xuất kho và kiểm kê', 'About Issuing & Stock-Take'),
          ul(
            ['发料提示「该领料单未审批」→ 领料单必须先经生产主管批准才能发料。', 'Xuất kho báo "phiếu lĩnh chưa được duyệt" → phiếu phải được trưởng sản xuất duyệt mới phát hàng được.', '"Picking order not approved" → it must be approved by the production manager first.'],
            ['发料提示「以下物料不在该领料单中」→ 扫的物料与该单明细不匹配，核对是否扫错箱或单据选错。', '"Vật tư không thuộc phiếu lĩnh" → vật tư quét không khớp chi tiết phiếu; kiểm tra quét nhầm thùng hoặc nhầm phiếu.', '"Materials not on this order" → the scanned material does not match; check for the wrong box or order.'],
            ['建盘点单提示「该期间已存在」→ 同期间同仓库只能一张盘点单，请到列表中找到已有单据继续使用。', 'Tạo phiếu kiểm kê báo "kỳ này đã tồn tại" → mỗi kỳ mỗi kho chỉ một phiếu; hãy tìm phiếu đã có để dùng tiếp.', '"Period already exists" → only one order per period per warehouse; find and continue the existing one.'],
            ['提交盘点单提示「已提交或状态已变更」→ 别人已经先提交了，刷新页面查看最新状态即可，不要重复提交。', 'Gửi phiếu kiểm kê báo "đã gửi hoặc trạng thái đã đổi" → người khác đã gửi trước; tải lại trang để xem trạng thái mới, đừng gửi lại.', '"Already submitted or status changed" → someone submitted first; refresh and do not resubmit.'],
          ),
          h3('权限与其他', 'Quyền hạn và khác', 'Permissions & Others'),
          ul(
            ['看不到某个菜单 → 你的角色未分配该菜单权限，找系统管理员调整角色。', 'Không thấy một menu → vai trò của bạn chưa được cấp quyền menu đó; nhờ quản trị viên điều chỉnh.', 'A menu is missing → your role lacks that permission; ask the administrator.'],
            ['界面语言变了 → 点顶部右上角的语言按钮切回；系统会记住上次选择。', 'Ngôn ngữ giao diện đổi → bấm nút ngôn ngữ góc trên phải để chuyển lại; hệ thống nhớ lựa chọn trước đó.', 'Interface language changed → use the language button at the top right; the choice is remembered.'],
            ['PDA 摄像头扫不了码 → 检查是否为 HTTPS 访问，HTTP 下浏览器禁止调用摄像头。', 'Camera PDA không quét được → kiểm tra có đang truy cập HTTPS không; HTTP thì trình duyệt cấm dùng camera.', 'PDA camera not scanning → check you are on HTTPS; HTTP blocks camera access.'],
            ['听不到提示音 → 先点一下页面激活音频，再检查设备静音与媒体音量。', 'Không nghe âm báo → bấm vào trang một lần để kích hoạt âm thanh, rồi kiểm tra chế độ im lặng và âm lượng media.', 'No sound → tap the page once to unlock audio, then check mute and media volume.'],
          ),
        ],
      },
    ],
  },
];
