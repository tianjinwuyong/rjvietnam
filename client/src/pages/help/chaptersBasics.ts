import { type HelpChapter, p, h3, ul, ol, note, table, flow, T } from './helpTypes';

export const basicsChapters: HelpChapter[] = [
  // ================================================================ 1 概览
  {
    id: 'overview',
    icon: 'home',
    title: T('系统概览与登录', 'Tổng quan hệ thống và đăng nhập', 'System Overview & Login'),
    summary: T(
      '认识 WMS 的作用、界面结构，以及用电脑 / 安卓 / 苹果 / PDA 四种方式如何登录与切换语言。新同事请从本章读起。',
      'Hiểu vai trò của WMS, cấu trúc giao diện, cách đăng nhập bằng bốn loại thiết bị (máy tính / Android / iPhone / PDA) và chuyển ngôn ngữ. Nhân viên mới nên đọc chương này trước.',
      'Understand what the WMS does, how the interface is organized, and how to log in from a PC, Android phone, iPhone or PDA, plus language switching. New staff should start here.',
    ),
    sections: [
      {
        id: 'overview-what',
        title: T('WMS 是做什么的', 'WMS dùng để làm gì', 'What the WMS Does'),
        blocks: [
          p(
            'WMS（仓库管理系统）负责管理从"供应商送货进厂"到"物料被生产线领走"的全部库存动作，并对来料质量检验（IQC）和不合格品处理（MRB）做完整记录。',
            'WMS (Hệ thống quản lý kho) quản lý toàn bộ hoạt động tồn kho từ "nhà cung cấp giao hàng vào nhà máy" đến "vật tư được dây chuyền sản xuất lĩnh đi", đồng thời ghi chép đầy đủ việc kiểm tra chất lượng hàng đến (IQC) và xử lý hàng không đạt (MRB).',
            'The WMS manages all inventory movements from "supplier delivers to the factory" through "material is picked by the production line", and keeps complete records of incoming quality inspection (IQC) and nonconforming-material disposition (MRB).',
          ),
          p(
            '一句话概括：物料从进厂到出厂，每一次移动、每一次检验、每一次冻结或报废，系统里都必须有对应记录，做到"账实相符、有据可查"。',
            'Tóm gọn một câu: vật tư từ khi vào nhà máy đến khi xuất xưởng, mỗi lần di chuyển, kiểm tra, phong tỏa hay tiêu hủy đều phải có bản ghi tương ứng, đảm bảo "sổ sách khớp thực tế, có căn cứ tra cứu".',
            'In one sentence: from arrival to shipment, every movement, inspection, hold or scrap must have a corresponding record, so that "books match reality and everything is traceable".',
          ),
          note(
            'info',
            '系统其实只有一个网页，用同一个账号密码从四类设备都能登：电脑（PC）、安卓手机、苹果手机(iPhone/iPad)、PDA 手持终端。电脑进的是完整管理界面；手机和 PDA 会自动进入移动版（大按钮、扫码优先）。具体地址与步骤见下一节。',
            'Hệ thống thực chất chỉ là một trang web, dùng cùng một tài khoản/mật khẩu để đăng nhập từ bốn loại thiết bị: máy tính (PC), điện thoại Android, iPhone/iPad và PDA. Máy tính vào giao diện quản lý đầy đủ; điện thoại và PDA tự động vào bản di động (nút lớn, ưu tiên quét mã). Địa chỉ và các bước xem mục tiếp theo.',
            'It is really one web app: the same account works from four device types — PC, Android phone, iPhone/iPad and PDA. The PC shows the full management UI; phones and PDAs automatically switch to the mobile UI (large buttons, scanning first). See the next section for addresses and steps.',
          ),
          note(
            'tip',
            '本次更新要点（2026-10）：① 物料主数据新增「包装类型」（普通 / 盘装料 Reel），编辑物料时可直接修改；② 「批量导出」的文件就是导入模板，已含包装类型等全部列；③ 盘装料发料不再要求扫盘号，按包装类型自动记盘台账；④ 新增手机（安卓 / 苹果）与 PDA 登录说明，见「四种登录方式」；⑤ 检验单规格列（Spec）已修复，可直接录入。',
            'Điểm mới (2026-10): ① Dữ liệu vật tư thêm "Loại đóng gói" (Thường / Cuộn Reel), sửa trực tiếp khi chỉnh vật tư; ② Tệp "Xuất hàng loạt" chính là mẫu nhập, đã gồm đầy đủ cột như loại đóng gói; ③ Xuất hàng cuộn không cần quét số cuộn nữa, hệ thống tự ghi sổ cuộn theo loại đóng gói; ④ Bổ sung hướng dẫn đăng nhập điện thoại (Android / iPhone) và PDA — xem "Bốn cách đăng nhập"; ⑤ Cột quy cách (Spec) trên phiếu kiểm đã sửa, nhập trực tiếp được.',
            'What is new (2026-10): ① Material master now has Packaging Type (Normal / Reel), editable per material; ② Bulk Export produces the import template itself, including packaging type and all columns; ③ Reel issuing no longer requires a reel-number scan — the reel ledger is written from packing type automatically; ④ Added phone (Android / iPhone) and PDA login instructions — see Four Ways to Log In; ⑤ The Spec column on inspection sheets is fixed and accepts input.',
          ),
        ],
      },
      {
        id: 'overview-login',
        title: T('登录与退出', 'Đăng nhập và đăng xuất', 'Login & Logout'),
        blocks: [
          ol(
            [
              '在浏览器打开系统地址，进入登录页。',
              'Mở địa chỉ hệ thống bằng trình duyệt để vào trang đăng nhập.',
              'Open the system URL in a browser to reach the login page.',
            ],
            [
              '输入账号与密码，点击「登录」。账号由系统管理员在「系统设置 → 账号管理」中创建。',
            'Nhập tài khoản và mật khẩu, bấm "Đăng nhập". Tài khoản do quản trị viên tạo trong "Cài đặt hệ thống → Quản lý tài khoản".',
            'Enter your account and password and click "Login". Accounts are created by the system administrator under "System Settings → Account Management".',
          ],
          [
            '登录成功进入首页看板；左侧是功能导航，顶部是语言切换与账号操作区。',
            'Đăng nhập thành công sẽ vào bảng điều khiển trang chủ; bên trái là điều hướng chức năng, phía trên là khu chuyển ngôn ngữ và thao tác tài khoản.',
            'On success you land on the dashboard; navigation is on the left, language and account controls are at the top.',
          ],
          [
            '退出登录：点击右上角账号姓名 → 「退出登录」。仓管员共用 PDA 时必须退出，避免他人以你的身份操作。',
            'Đăng xuất: bấm tên tài khoản ở góc trên bên phải → "Đăng xuất". Nhân viên kho dùng chung PDA bắt buộc phải đăng xuất để tránh người khác thao tác dưới danh nghĩa của bạn.',
            'To log out: click your name at the top right → "Logout". Warehouse staff sharing a PDA must log out to prevent others acting under your identity.',
            ],
          ),
        ],
      },
      {
        id: 'overview-devices',
        title: T(
          '四种登录方式（电脑 / 安卓 / 苹果 / PDA）',
          'Bốn cách đăng nhập (Máy tính / Android / iPhone / PDA)',
          'Four Ways to Log In (PC / Android / iPhone / PDA)',
        ),
        blocks: [
          p(
            '四类设备连的是同一个服务器、同一个账号。差别只有两点：电脑走 http 的 3000 端口，手机要用摄像头扫码就必须走 https 的 3443 端口（浏览器规定：非 HTTPS 页面不给调用摄像头）。',
            'Bốn loại thiết bị kết nối cùng một máy chủ, cùng một tài khoản. Chỉ khác hai điểm: máy tính dùng cổng 3000 (http); điện thoại muốn quét bằng camera thì phải dùng cổng 3443 (https) — trình duyệt không cho trang không-HTTPS dùng camera.',
            'All four use the same server and account. Only two differences: PCs use port 3000 over http; phones must use port 3443 over https if they scan with the camera (browsers block camera access on non-HTTPS pages).',
          ),
          table(
            [
              ['设备', 'Thiết bị', 'Device'],
              ['典型场景', 'Tình huống điển hình', 'Typical use'],
              ['登录地址', 'Địa chỉ đăng nhập', 'Login address'],
              ['首次使用要先做什么', 'Lần đầu cần làm gì', 'First-time setup'],
            ],
            [
              [
                ['电脑 PC（Windows / Mac，Chrome / Edge）', 'Máy tính (Windows / Mac, Chrome / Edge)', 'PC (Windows / Mac, Chrome / Edge)'],
                ['建单、审批、报表、打印、维护主数据', 'Tạo phiếu, phê duyệt, báo cáo, in, bảo trì dữ liệu nền', 'Documents, approvals, reports, printing, master data'],
                ['http://服务器IP:3000', 'http://IP-máy-chủ:3000', 'http://SERVER-IP:3000'],
                ['无，直接登录', 'Không, đăng nhập ngay', 'Nothing — log in directly'],
              ],
              [
                ['安卓手机 / 平板', 'Điện thoại / máy tính bảng Android', 'Android phone / tablet'],
                ['现场查库存、手机摄像头扫码、查单据', 'Tra tồn kho, quét bằng camera, tra phiếu', 'Stock lookup, camera scanning, document lookup'],
                ['https://服务器IP:3443', 'https://IP-máy-chủ:3443', 'https://SERVER-IP:3443'],
                ['先打开 http://服务器IP:3000/cert 安装证书（见下节）', 'Mở http://IP-máy-chủ:3000/cert để cài chứng chỉ (xem mục dưới)', 'Open http://SERVER-IP:3000/cert and install the certificate (see below)'],
              ],
              [
                ['苹果 iPhone / iPad', 'iPhone / iPad', 'iPhone / iPad'],
                ['同上：现场查询与摄像头扫码', 'Như trên: tra cứu và quét bằng camera', 'Same: on-site lookup and camera scanning'],
                ['https://服务器IP:3443', 'https://IP-máy-chủ:3443', 'https://SERVER-IP:3443'],
                ['先到 /cert 安装描述文件，并到「设置 → 通用 → 关于本机 → 证书信任设置」开启完全信任', 'Vào /cert cài profile, rồi bật tin cậy tại "Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng chỉ"', 'Install the profile from /cert, then enable full trust under Settings → General → About → Certificate Trust Settings'],
              ],
              [
                ['PDA 手持终端（带扫码枪）', 'Thiết bị PDA (có súng quét)', 'PDA handheld (with scanner gun)'],
                ['收料、发料、盘点、移库、不良品转移', 'Nhận hàng, xuất kho, kiểm kê, chuyển kho, chuyển hàng lỗi', 'Receiving, issuing, stock-take, transfer, defective move'],
                ['http://服务器IP:3000（用硬件扫码枪时）', 'http://IP-máy-chủ:3000 (khi dùng súng quét)', 'http://SERVER-IP:3000 (with the hardware scanner)'],
                ['无。若这个 PDA 改用摄像头扫码，则同手机：装证书 + 用 3443', 'Không. Nếu PDA dùng camera để quét thì như điện thoại: cài chứng chỉ + dùng 3443', 'None. If this PDA scans with its camera instead, follow the phone path: install cert + use 3443'],
              ],
            ],
          ),
          note(
            'warn',
            '一句话记法：电脑用 3000（http），手机用 3443（https），PDA 看用什么扫码。手机直接用 http://IP:3000 也能打开并登录，但摄像头扫码会失败——这不是系统限制，是浏览器的安全策略。',
            'Cách nhớ: **máy tính 3000 (http), điện thoại 3443 (https), PDA tùy cách quét**. Điện thoại mở http://IP:3000 vẫn đăng nhập được nhưng quét bằng camera sẽ lỗi — không phải giới hạn của hệ thống mà là chính sách bảo mật của trình duyệt.',
            'Rule of thumb: PC on 3000 (http), phones on 3443 (https), PDA depends on how it scans. A phone can still open and log in on http://IP:3000, but camera scanning fails — that is a browser security rule, not a system limitation.',
          ),
          h3('手机上第一次用：先装证书', 'Lần đầu dùng trên điện thoại: cài chứng chỉ trước', 'First Time on a Phone: Install the Certificate'),
          p(
            '证书下载页是 http://服务器IP:3000/cert（本厂当前服务器为 192.168.6.160，即 http://192.168.6.160:3000/cert；如地址变更以管理员通知为准）。页面会自动显示当前网络的 IP 与可用的 HTTPS 地址，点「下载并安装证书」按提示走即可。',
            'Trang tải chứng chỉ là http://IP-máy-chủ:3000/cert (máy chủ hiện tại của xưởng là 192.168.6.160, tức http://192.168.6.160:3000/cert; nếu địa chỉ thay đổi thì theo thông báo của quản trị viên). Trang tự hiển thị IP mạng hiện tại và địa chỉ HTTPS khả dụng; bấm "Tải và cài chứng chỉ" rồi làm theo hướng dẫn.',
            'The certificate page is http://SERVER-IP:3000/cert (this site currently uses 192.168.6.160, i.e. http://192.168.6.160:3000/cert; if the address changes, follow the administrator notice). The page shows the current network IP and the usable HTTPS address; click Download and Install Certificate and follow the prompts.',
          ),
          ol(
            [
              '在手机浏览器打开 http://服务器IP:3000/cert（注意是 3000 端口，不是 3443）。',
              'Mở http://IP-máy-chủ:3000/cert trên trình duyệt điện thoại (cổng 3000, không phải 3443).',
              'Open http://SERVER-IP:3000/cert in the phone browser (port 3000, not 3443).',
            ],
            [
              '按页面提示下载并安装证书：安卓在「设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书」中选择刚下载的文件。',
              'Làm theo hướng dẫn trên trang để tải và cài: Android vào "Cài đặt → Bảo mật → Mã hóa và thông tin xác thực → Cài chứng chỉ → Chứng chỉ CA" rồi chọn tệp vừa tải.',
              'Follow the page prompts. On Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate, then pick the downloaded file.',
            ],
            [
              'iPhone / iPad：下载后到「设置 → 已下载描述文件」安装，再进入「设置 → 通用 → 关于本机 → 证书信任设置」，把该证书的开关打开（这一步不做，Safari 仍判定不安全）。',
              'iPhone / iPad: sau khi tải, vào "Cài đặt → Hồ sơ đã tải" để cài, rồi vào "Cài đặt → Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng chỉ" và bật công tắc cho chứng chỉ này (nếu bỏ qua, Safari vẫn coi là không an toàn).',
              'iPhone / iPad: install from Settings → Profile Downloaded, then go to Settings → General → About → Certificate Trust Settings and turn the switch on for this certificate (without this Safari still treats it as insecure).',
            ],
            [
              '装好后改打开 https://服务器IP:3443 登录。地址栏出现锁形图标（或不再报警告）即表示成功。',
              'Sau khi cài, mở https://IP-máy-chủ:3443 để đăng nhập. Thanh địa chỉ hiện ổ khóa (hoặc không còn cảnh báo) là thành công.',
              'Then switch to https://SERVER-IP:3443 to log in. A padlock in the address bar (or no more warning) means success.',
            ],
            [
              '证书有效期有限，过期后会重新提示不安全——重新到 /cert 装一次即可。',
              'Chứng chỉ có hạn; khi hết hạn sẽ nhắc không an toàn lại — chỉ cần vào /cert cài lại.',
              'The certificate expires; when it does you will see the warning again — just reinstall from /cert.',
            ],
          ),
          h3('登录步骤（各端通用）', 'Các bước đăng nhập (chung cho mọi thiết bị)', 'Login Steps (all devices)'),
          ol(
            [
              '先连上厂内网络（Wi-Fi 或网线），设备必须和 WMS 服务器在同一局域网。',
              'Kết nối mạng nội bộ trước (Wi-Fi hoặc dây), thiết bị phải cùng mạng LAN với máy chủ WMS.',
              'Join the factory network first (Wi-Fi or cable); the device must be on the same LAN as the WMS server.',
            ],
            [
              '向系统管理员索取服务器地址，形如 192.168.x.x。不要用 localhost——那只在服务器本机上有效。',
              'Xin quản trị viên địa chỉ máy chủ, dạng 192.168.x.x. Không dùng localhost — chỉ có tác dụng trên chính máy chủ.',
              'Ask the administrator for the server address, e.g. 192.168.x.x. Do not use localhost — that only works on the server itself.',
            ],
            [
              '按设备选端口：电脑 3000；手机 3443；PDA 用扫码枪则 3000。',
              'Chọn cổng theo thiết bị: máy tính 3000; điện thoại 3443; PDA dùng súng quét thì 3000.',
              'Pick the port by device: PC 3000; phone 3443; PDA with scanner gun 3000.',
            ],
            [
              '输入账号与密码，点「登录」。账号由管理员在「系统设置 → 账号管理」创建。',
              'Nhập tài khoản và mật khẩu, bấm "Đăng nhập". Tài khoản do quản trị viên tạo trong "Cài đặt hệ thống → Quản lý tài khoản".',
              'Enter account and password, click Login. Accounts are created by the admin under System Settings → Account Management.',
            ],
            [
              '登录后建议把地址加入书签或主屏幕，下次一键进入。',
              'Sau khi đăng nhập nên thêm vào bookmark hoặc màn hình chính để vào nhanh lần sau.',
              'After logging in, bookmark the address or add it to the home screen for one-tap access.',
            ],
          ),
          h3('移动版与电脑版互相切换', 'Chuyển giữa bản di động và bản máy tính', 'Switching Between Mobile and Desktop'),
          ul(
            [
              '手机/PDA 打开默认是移动版（大按钮、扫码优先），适合现场作业。',
              'Điện thoại/PDA mặc định mở bản di động (nút lớn, ưu tiên quét), phù hợp thao tác tại chỗ.',
              'Phones/PDAs open the mobile UI by default (large buttons, scanning first), suited to floor work.',
            ],
            [
              '手机上需要看完整管理界面时，在移动版登录页点「切换到电脑版」，之后会一直按电脑版显示。',
              'Khi cần giao diện quản lý đầy đủ trên điện thoại, bấm "Chuyển sang bản máy tính" ở trang đăng nhập di động; sau đó sẽ luôn hiển thị bản máy tính.',
              'If you need the full UI on a phone, click "Switch to desktop" on the mobile login page; it then stays in desktop mode.',
            ],
            [
              '想改回移动版：在该手机浏览器里清除本站点数据（缓存/Cookie）即可恢复。',
              'Muốn quay lại bản di động: xóa dữ liệu trang này trong trình duyệt (cache/cookie) là được.',
              'To go back to mobile: clear this site data (cache/cookies) in the phone browser.',
            ],
            [
              '移动版页面顶部若出现「当前为 HTTP 访问 / 摄像头扫码需HTTPS」的黄条，点「切换 HTTPS」即可跳到 3443 登录。',
              'Nếu đầu trang di động hiện dải vàng "Đang truy cập HTTP / quét camera cần HTTPS", bấm "Chuyển HTTPS" để sang cổng 3443.',
              'If a yellow bar says the page is on HTTP and camera scanning needs HTTPS, click Switch to HTTPS to move to port 3443.',
            ],
          ),
          note(
            'warn',
            '共用的 PDA 或手机，交接班前必须点「退出登录」。系统把每一次扫码、每一次发料都记在登录账号名下，别人用你的账号操作就等于你本人操作。',
            'PDA/điện thoại dùng chung phải bấm "Đăng xuất" trước khi giao ca. Hệ thống ghi mọi lần quét, mọi lần xuất kho dưới tài khoản đang đăng nhập; người khác dùng tài khoản của bạn nghĩa là bạn thao tác.',
            'On a shared PDA or phone, log out before handing over. Every scan and issue is recorded under the logged-in account, so someone using your account counts as you.',
          ),
          note(
            'info',
            '打不开或一直转圈时依次检查：① 设备与服务器是否同一网段（IP 前三段相同）；② 服务器 Windows 防火墙是否放行 3000 与 3443（两个都要）；③ 地址是否误写成 localhost；④ 端口是否搞混（手机写成 3000、电脑写成 3443 都会出问题）；⑤ 服务器 WMS 服务是否在运行。',
            'Khi không mở được hoặc quay mãi, kiểm tra lần lượt: ① thiết bị và máy chủ có cùng dải mạng; ② tường lửa Windows đã mở cả 3000 và 3443 chưa (cần cả hai); ③ có ghi nhầm localhost; ④ có lẫn cổng (điện thoại ghi 3000, máy tính ghi 3443 đều lỗi); ⑤ dịch vụ WMS có đang chạy.',
            'If it will not open: ① same subnet; ② Windows firewall allows both 3000 and 3443; ③ address is not localhost; ④ ports not mixed up (phone on 3000 or PC on 3443 both fail); ⑤ the WMS service is running.',
          ),
        ],
      },
      {
        id: 'overview-ui',
        title: T('界面结构说明', 'Mô tả cấu trúc giao diện', 'Interface Layout'),
        blocks: [
          p(
            '电脑端界面分四个区域，理解这四块就能快速定位功能。',
            'Giao diện PC chia thành bốn khu vực; hiểu bốn khu vực này là có thể định vị chức năng nhanh chóng.',
            'The PC interface has four regions; understanding them lets you locate any function quickly.',
          ),
          table(
            [['区域', 'Khu vực', 'Area'], ['位置', 'Vị trí', 'Position'], ['作用', 'Tác dụng', 'Purpose']],
            [
              [
                ['主模块导航', 'Điều hướng mô-đun chính', 'Main module nav'],
                ['最左侧竖排', 'Cột dọc ngoài cùng bên trái', 'Left vertical column'],
                ['按业务大类切换：收料、发料、库存、IQC、工单、BOM、MRB、系统设置等', 'Chuyển theo nhóm nghiệp vụ: nhận hàng, xuất kho, tồn kho, IQC, lệnh sản xuất, BOM, MRB, cài đặt hệ thống…', 'Switch by business group: receiving, issuing, inventory, IQC, work orders, BOM, MRB, system settings, etc.'],
              ],
              [
                ['模块标题栏', 'Thanh tiêu đề mô-đun', 'Module title bar'],
                ['顶部第一行', 'Dòng đầu phía trên', 'Top first row'],
                ['显示当前模块与你的角色；右侧为「配色」「帮助」「语言切换」「账号菜单」', 'Hiển thị mô-đun hiện tại và vai trò của bạn; bên phải là "Giao diện", "Trợ giúp", "Chuyển ngôn ngữ", "Menu tài khoản"', 'Shows the current module and your role; on the right are Theme, Help, Language and Account menus'],
              ],
              [
                ['子模块标签', 'Tab mô-đun con', 'Sub-module tabs'],
                ['顶部第二行', 'Dòng thứ hai phía trên', 'Top second row'],
                ['当前模块下的具体页面，如「收料」下的扫码收货/收货单', 'Các trang cụ thể trong mô-đun, ví dụ "Quét mã nhận hàng" / "Phiếu nhận hàng" trong "Nhận hàng"', 'Pages within the module, e.g. Scan Receipt / Receipt Orders under Receiving'],
              ],
              [
                ['内容区', 'Vùng nội dung', 'Content area'],
                ['右侧主体', 'Phần chính bên phải', 'Main area on the right'],
                ['显示列表、表单、单据详情', 'Hiển thị danh sách, biểu mẫu, chi tiết phiếu', 'Lists, forms and document details'],
              ],
            ],
          ),
          note(
            'tip',
            '左侧导航可以用标题栏最左边的折叠按钮收起，给表格腾出更多宽度；鼠标悬停会自动展开，方便查看表名。',
            'Có thể thu gọn điều hướng bên trái bằng nút ở ngoài cùng thanh tiêu đề để có thêm chiều rộng cho bảng; rê chuột vào sẽ tự mở rộng để xem tên mục.',
            'Collapse the left nav with the button at the far left of the title bar to give tables more width; hovering expands it back so you can still read the labels.',
          ),
        ],
      },
      {
        id: 'overview-lang',
        title: T('切换语言（中文 / 越南语 / 英语）', 'Chuyển ngôn ngữ (Trung / Việt / Anh)', 'Switching Language (Chinese / Vietnamese / English)'),
        blocks: [
          ol(
            [
              '点击顶部栏右端的「中文 / Tiếng Việt / English」按钮，展开语言菜单。',
              'Bấm nút "中文 / Tiếng Việt / English" ở đầu phải thanh trên để mở menu ngôn ngữ.',
              'Click the "中文 / Tiếng Việt / English" button at the top right to open the language menu.',
            ],
            [
              '选择需要的语言，界面立即切换，无需刷新页面。',
              'Chọn ngôn ngữ mong muốn, giao diện chuyển ngay, không cần tải lại trang.',
              'Pick a language; the interface switches immediately with no page reload.',
            ],
            [
              '系统会记住你的选择。下次登录仍是该语言，换一台设备也需重新选择。',
              'Hệ thống ghi nhớ lựa chọn của bạn. Lần sau đăng nhập vẫn giữ ngôn ngữ đó; đổi thiết bị cần chọn lại.',
              'Your choice is remembered. It persists on your next login; switching devices requires choosing again.',
            ],
            [
              'PDA 端在页面右上角有一个圆形语言按钮，点一下按「中 → VI → EN」循环切换。',
              'Trên PDA, góc trên bên phải có nút ngôn ngữ tròn; bấm một lần sẽ chuyển vòng theo "中 → VI → EN".',
              'On the PDA there is a round language button at the top right; each tap cycles 中 → VI → EN.',
            ],
          ),
          note(
            'info',
            '本帮助手册与界面同步支持三语。切换语言后，手册正文也会一起切换。',
            'Sổ tay trợ giúp này hỗ trợ ba ngôn ngữ đồng bộ với giao diện. Sau khi chuyển ngôn ngữ, nội dung trợ giúp cũng đổi theo.',
            'This help manual supports the same three languages. When you switch language, the manual content switches too.',
          ),
        ],
      },
      {
        id: 'overview-theme',
        title: T('切换界面配色（浅色 / 深色）', 'Chuyển bảng màu giao diện (sáng / tối)', 'Switching Color Theme (Light / Dark)'),
        blocks: [
          ol(
            [
              '点击顶部栏右端的「配色」按钮（调色板图标，位于「帮助」左边），展开配色面板。',
              'Bấm nút "Giao diện" (biểu tượng bảng màu, nằm bên trái "Trợ giúp") ở đầu phải thanh trên để mở bảng chọn màu.',
              'Click the "Theme" button (palette icon, left of Help) at the top right to open the theme panel.',
            ],
            [
              '面板分「浅色主题」与「深色主题」两组，共 7 套：晴空蓝、深海蓝、暖砂米、青竹绿、紫藤为浅色；深空灰、曜夜金为深色。',
              'Bảng gồm hai nhóm "Giao diện sáng" và "Giao diện tối", tổng 7 bộ: Xanh trời, Xanh biển sâu, Cát ấm, Trúc xanh, Tử đằng (sáng); Xám vũ trụ, Đêm vàng (tối).',
              'The panel has two groups, Light and Dark, with 7 palettes: Azure, Deep Navy, Warm Sand, Jade and Wisteria are light; Graphite and Midnight Gold are dark.',
            ],
            [
              '点一下缩略图即刻换色，整个界面（表格、弹窗、图表）一起变，不用刷新，也不会丢掉当前页面正在填的内容。',
              'Bấm vào ảnh thu nhỏ là đổi màu ngay, toàn bộ giao diện (bảng, hộp thoại, biểu đồ) đổi theo, không cần tải lại và không mất nội dung đang nhập.',
              'Click a thumbnail to recolor the whole interface (tables, dialogs, charts) instantly — no reload and no loss of what you were typing.',
            ],
            [
              '选择记在本机浏览器里，下次打开还是这套配色；换电脑或换浏览器需要重新选一次。',
              'Lựa chọn được lưu trên trình duyệt máy này; lần sau mở vẫn giữ bảng màu đó. Đổi máy hoặc đổi trình duyệt cần chọn lại.',
              'Your choice is stored in this browser; it persists next time. Another computer or browser needs choosing again.',
            ],
          ),
          note(
            'tip',
            '暗光车间或夜间值班建议用深色主题（深空灰 / 曜夜金），白天办公用浅色主题更清晰。IQC 检验单是打印件，始终白纸黑字，不受配色影响。',
            'Kho thiếu sáng hoặc trực đêm nên dùng giao diện tối (Xám vũ trụ / Đêm vàng); ban ngày dùng giao diện sáng rõ hơn. Phiếu kiểm IQC là bản in, luôn nền trắng chữ đen, không bị ảnh hưởng bởi bảng màu.',
            'In dim workshops or night shifts prefer a dark theme (Graphite / Midnight Gold); light themes read better in daytime offices. IQC inspection sheets are printouts and always stay black on white, unaffected by the theme.',
          ),
        ],
      },
    ],
  },

  // ================================================================ 2 角色与权限
  {
    id: 'roles',
    icon: 'users',
    title: T('角色与权限', 'Vai trò và quyền hạn', 'Roles & Permissions'),
    summary: T(
      '系统共 16 个角色。先找到自己的角色，再按对应章节学习操作。',
      'Hệ thống có 16 vai trò. Hãy tìm vai trò của bạn trước, rồi học thao tác theo chương tương ứng.',
      'The system has 16 roles. Find yours first, then follow the matching chapter.',
    ),
    sections: [
      {
        id: 'roles-list',
        title: T('角色清单与职责', 'Danh sách vai trò và trách nhiệm', 'Role List & Responsibilities'),
        blocks: [
          p(
            '角色决定你能看到哪些菜单、能执行哪些操作。未分配的菜单不会显示，即使手动输入网址也会被拒绝。',
            'Vai trò quyết định bạn thấy menu nào và thực hiện được thao tác nào. Menu không được cấp sẽ không hiển thị; nhập địa chỉ trực tiếp cũng bị từ chối.',
            'Your role determines which menus you see and which actions you can perform. Unassigned menus are hidden, and entering the URL directly is also rejected.',
          ),
          table(
            [['角色', 'Vai trò', 'Role'], ['主要职责', 'Trách nhiệm chính', 'Main duties'], ['核心页面', 'Trang chính', 'Key pages']],
            [
              [
                ['系统管理员', 'Quản trị viên hệ thống', 'System Admin'],
                ['全局配置、账号与角色维护、异常数据处理', 'Cấu hình toàn cục, quản lý tài khoản và vai trò, xử lý dữ liệu bất thường', 'Global configuration, account and role maintenance, exception handling'],
                ['系统设置全部；其余模块均可操作', 'Toàn bộ Cài đặt hệ thống; các mô-đun khác đều thao tác được', 'All of System Settings; all other modules operable'],
              ],
              [
                ['仓库主管', 'Trưởng bộ phận kho', 'Warehouse Manager'],
                ['仓库与库位维护、调拨、供应商资料', 'Bảo trì kho và vị trí, điều chuyển, thông tin nhà cung cấp', 'Warehouse/location maintenance, transfers, supplier data'],
                ['库存查询、库存调拨、内部调拨、仓库、库位、物料、供应商', 'Tra cứu tồn kho, điều chuyển kho, điều chuyển nội bộ, kho, vị trí, vật tư, nhà cung cấp', 'Inventory query, stock transfer, intra transfer, warehouse, location, material, supplier'],
              ],
              [
                ['仓管员', 'Nhân viên kho', 'Warehouse Keeper'],
                ['现场收料、发料、移库、盘点执行', 'Nhận hàng, xuất kho, chuyển kho, thực hiện kiểm kê tại chỗ', 'On-site receiving, issuing, moving and stock-take execution'],
                ['扫码收货、收货单、库存查询、内部调拨、库存调拨、发料', 'Quét mã nhận hàng, phiếu nhận hàng, tra cứu tồn kho, điều chuyển nội bộ, điều chuyển kho, xuất kho', 'Scan receipt, receipt orders, inventory query, intra transfer, stock transfer, issuing'],
              ],
              [
                ['IQC 检验员', 'Nhân viên kiểm tra IQC', 'IQC Inspector'],
                ['来料检验、录入检验记录与报告', 'Kiểm tra hàng đến, nhập hồ sơ và báo cáo kiểm tra', 'Incoming inspection, entering inspection records and reports'],
                ['IQC 待检、检验记录、检验报告、收货单（只读）', 'IQC chờ kiểm, hồ sơ kiểm, báo cáo kiểm, phiếu nhận hàng (chỉ đọc)', 'IQC pending, inspection record, inspection report, receipt orders (read-only)'],
              ],
              [
                ['IQC 主管', 'Trưởng IQC', 'IQC Manager'],
                ['检验标准维护、加严放宽裁定、报告审核', 'Bảo trì tiêu chuẩn kiểm, quyết định siết chặt/nới lỏng, duyệt báo cáo', 'Inspection standard maintenance, tighten/relax decisions, report review'],
                ['IQC 全部页面 + 库存查询 + MRB 列表', 'Toàn bộ trang IQC + tra cứu tồn kho + danh sách MRB', 'All IQC pages + inventory query + MRB list'],
              ],
              [
                ['SQE 工程师', 'Kỹ sư SQE', 'SQE Engineer'],
                ['供应商质量、MRB 评审、供应商退货', 'Chất lượng nhà cung cấp, đánh giá MRB, trả hàng nhà cung cấp', 'Supplier quality, MRB review, supplier returns'],
                ['MRB 列表/任务、物料、供应商、IQC 报告', 'MRB danh sách/nhiệm vụ, vật tư, nhà cung cấp, báo cáo IQC', 'MRB list/tasks, material, supplier, IQC report'],
              ],
              [
                ['质量经理', 'Trưởng bộ phận chất lượng', 'Quality Manager'],
                ['MRB 终审、质量决策', 'Phê duyệt cuối MRB, quyết định chất lượng', 'Final MRB approval, quality decisions'],
                ['MRB 列表/任务、IQC 报告、库存查询', 'MRB danh sách/nhiệm vụ, báo cáo IQC, tra cứu tồn kho', 'MRB list/tasks, IQC report, inventory query'],
              ],
              [
                ['MRB 评审员', 'Người đánh giá MRB', 'MRB Reviewer'],
                ['执行 MRB 评审任务与处置', 'Thực hiện nhiệm vụ đánh giá và xử lý MRB', 'Execute MRB review tasks and dispositions'],
                ['MRB 列表、MRB 任务、IQC 报告', 'MRB danh sách, MRB nhiệm vụ, báo cáo IQC', 'MRB list, MRB tasks, IQC report'],
              ],
              [
                ['计划员 / 计划部主管', 'Nhân viên / Trưởng kế hoạch', 'Planner / Planning Manager'],
                ['工单下达、物料需求计算', 'Phát hành lệnh sản xuất, tính nhu cầu vật tư', 'Work order release, material requirement calculation'],
                ['工单列表、物料需求、BOM、物料、库存查询', 'Lệnh sản xuất, nhu cầu vật tư, BOM, vật tư, tra cứu tồn kho', 'Work orders, material requirements, BOM, material, inventory query'],
              ],
              [
                ['生产物料员（SMT/DIP/组装/包装）', 'Nhân viên vật tư (SMT/DIP/Lắp ráp/Đóng gói)', 'Material Handler (SMT/DIP/Assembly/Packing)'],
                ['现场领料、补料', 'Lĩnh vật tư, bổ sung vật tư tại chỗ', 'On-site picking and supplementing'],
                ['领料单、库存查询', 'Phiếu lĩnh vật tư, tra cứu tồn kho', 'Picking orders, inventory query'],
              ],
              [
                ['生产主管', 'Trưởng sản xuất', 'Production Manager'],
                ['领料单审批、超领管理', 'Phê duyệt phiếu lĩnh, quản lý lĩnh vượt', 'Picking approval, over-picking control'],
                ['领料单、库存查询、发料管理', 'Phiếu lĩnh, tra cứu tồn kho, quản lý xuất kho', 'Picking orders, inventory query, issuing management'],
              ],
              [
                ['工程师', 'Kỹ sư', 'Engineer'],
                ['BOM 与物料资料维护', 'Bảo trì BOM và dữ liệu vật tư', 'BOM and material master maintenance'],
                ['BOM 列表、物料列表、供应商列表', 'Danh sách BOM, vật tư, nhà cung cấp', 'BOM list, material list, supplier list'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'roles-rules',
        title: T('权限的三条铁律', 'Ba nguyên tắc quyền hạn', 'Three Rules of Permission'),
        blocks: [
          ul(
            ['菜单看不到 ≠ 操作被禁止。系统在服务端还会再校验一次，任何绕过界面的请求都会被拒绝。', 'Không thấy menu ≠ bị cấm thao tác. Hệ thống kiểm tra lại ở phía máy chủ; mọi yêu cầu vượt giao diện đều bị từ chối.', 'Not seeing a menu ≠ the action is allowed. The server validates again; any request bypassing the UI is rejected.'],
            ['账号即责任。所有关键操作都会记录操作人与时间，请勿借用他人账号。', 'Tài khoản gắn với trách nhiệm. Mọi thao tác quan trọng đều ghi lại người thực hiện và thời gian; không mượn tài khoản của người khác.', 'Your account is your responsibility. All critical actions log the operator and timestamp; never borrow another person\'s account.'],
            ['需要新权限时，找系统管理员调整角色，不要试图共用主管账号。', 'Khi cần quyền mới, hãy yêu cầu quản trị viên điều chỉnh vai trò, đừng dùng chung tài khoản trưởng bộ phận.', 'If you need new permissions, ask the administrator to adjust your role — do not share a manager\'s account.'],
          ),
          note(
            'warn',
            '「系统设置」下的参数、角色、账号三个页面仅系统管理员可进入，普通角色即使知道网址也会被跳回首页。',
            'Ba trang Tham số, Vai trò, Tài khoản trong "Cài đặt hệ thống" chỉ quản trị viên vào được; vai trò thường dù biết địa chỉ cũng bị chuyển về trang chủ.',
            'The Parameter, Role and Account pages under System Settings are administrator-only; other roles are redirected to the home page even if they know the URL.',
          ),
        ],
      },
    ],
  },

  // ================================================================ 3 全流程
  {
    id: 'flow',
    icon: 'workflow',
    title: T('核心业务全流程', 'Toàn bộ quy trình nghiệp vụ chính', 'End-to-End Business Flow'),
    summary: T(
      '一图看清物料从进厂到被领用的完整路径，以及每一步由谁负责、在哪个页面操作。',
      'Nhìn một sơ đồ để hiểu toàn bộ đường đi của vật tư từ khi vào nhà máy đến khi được lĩnh, cùng người phụ trách và trang thao tác từng bước.',
      'See the full path of material from arrival to being picked, who owns each step, and which page to use.',
    ),
    sections: [
      {
        id: 'flow-main',
        title: T('主流程（收货 → IQC → 入库 → 领料）', 'Quy trình chính (Nhận hàng → IQC → Nhập kho → Lĩnh vật tư)', 'Main Flow (Receiving → IQC → Putaway → Picking)'),
        blocks: [
          flow(
            ['供应商送货', 'Nhà cung cấp giao hàng', 'Supplier delivers'],
            ['扫码收货', 'Quét mã nhận hàng', 'Scan receipt'],
            ['提交 IQC', 'Gửi IQC', 'Submit to IQC'],
            ['来料检验', 'Kiểm tra hàng đến', 'Incoming inspection'],
            ['合格入库', 'Nhập kho đạt', 'Putaway (passed)'],
            ['领料出库', 'Lĩnh vật tư xuất kho', 'Picking / issue'],
          ),
          p(
            '物料箱上贴有二维码标签，标签内容是六段码，格式固定为：',
            'Trên thùng vật tư có nhãn mã QR; nội dung nhãn là mã sáu đoạn, định dạng cố định:',
            'Material boxes carry a QR label whose content is a six-segment code with a fixed format:',
          ),
          note(
            'info',
            '供应商 * 料号 * 生产日期 * 数量 * 批次号 * 流水号\n例：A.967*QAMAT001*2026-10-08*100*B20261001*S0001\n六个字段缺一不可，顺序不能颠倒。日期格式为 YYYY-MM-DD。',
            'Nhà cung cấp * Mã vật tư * Ngày sản xuất * Số lượng * Số lô * Số thứ tự\nVí dụ: A.967*QAMAT001*2026-10-08*100*B20261001*S0001\nSáu trường không được thiếu, thứ tự không được đảo. Ngày theo định dạng YYYY-MM-DD.',
            'Supplier * Part No. * Production Date * Quantity * Batch No. * Serial No.\nExample: A.967*QAMAT001*2026-10-08*100*B20261001*S0001\nAll six fields are mandatory and the order is fixed. Date format is YYYY-MM-DD.',
          ),
          table(
            [['步骤', 'Bước', 'Step'], ['操作页面', 'Trang thao tác', 'Page'], ['负责角色', 'Vai trò phụ trách', 'Owner'], ['产出', 'Kết quả', 'Output']],
            [
              [
                ['① 送货到厂', '① Giao hàng đến nhà máy', '① Delivery'],
                ['—', '—', '—'],
                ['供应商', 'Nhà cung cấp', 'Supplier'],
                ['带二维码标签的物料箱', 'Thùng vật tư có nhãn QR', 'Material boxes with QR labels'],
              ],
              [
                ['② 扫码收货', '② Quét mã nhận hàng', '② Scan receipt'],
                ['收料 → 扫码收货', 'Nhận hàng → Quét mã nhận hàng', 'Receiving → Scan Receipt'],
                ['仓管员', 'Nhân viên kho', 'Warehouse Keeper'],
                ['收货单（已收货）', 'Phiếu nhận hàng (đã nhận)', 'Receipt order (received)'],
              ],
              [
                ['③ 提交 IQC', '③ Gửi IQC', '③ Submit to IQC'],
                ['收料 → 收货单（选中后提交）', 'Nhận hàng → Phiếu nhận hàng (chọn rồi gửi)', 'Receiving → Receipt Orders (select then submit)'],
                ['仓管员', 'Nhân viên kho', 'Warehouse Keeper'],
                ['IQC 批次（待检）', 'Lô IQC (chờ kiểm)', 'IQC lot (pending)'],
              ],
              [
                ['④ 来料检验', '④ Kiểm tra hàng đến', '④ Incoming inspection'],
                ['IQC → 待检 / 检验记录', 'IQC → Chờ kiểm / Hồ sơ kiểm', 'IQC → Pending / Inspection Record'],
                ['IQC 检验员', 'Nhân viên kiểm tra IQC', 'IQC Inspector'],
                ['检验报告（合格/不合格）', 'Báo cáo kiểm (đạt/không đạt)', 'Inspection report (pass/fail)'],
              ],
              [
                ['⑤ 合格入库', '⑤ Nhập kho đạt', '⑤ Putaway on pass'],
                ['自动完成', 'Tự động', 'Automatic'],
                ['系统', 'Hệ thống', 'System'],
                ['库存记录（良品仓，可发料）', 'Bản ghi tồn kho (kho hàng tốt, xuất được)', 'Inventory record (good warehouse, issuable)'],
              ],
              [
                ['⑥ 领料出库', '⑥ Lĩnh vật tư xuất kho', '⑥ Picking / issue'],
                ['工单 → 领料单 / 发料管理', 'Lệnh sản xuất → Phiếu lĩnh / Quản lý xuất kho', 'Work Orders → Picking / Issuing Management'],
                ['生产物料员 / 仓管员', 'Nhân viên vật tư / Nhân viên kho', 'Material Handler / Warehouse Keeper'],
                ['领料记录，库存扣减', 'Bản ghi lĩnh, trừ tồn kho', 'Picking record, inventory decremented'],
              ],
            ],
          ),
        ],
      },
      {
        id: 'flow-exception',
        title: T('异常分支（检验不合格）', 'Nhánh bất thường (kiểm tra không đạt)', 'Exception Branch (Inspection Failure)'),
        blocks: [
          p(
            '来料检验判定不合格时，物料不会进入良品仓，而是进入不良品仓，并触发 MRB 评审流程。',
            'Khi kiểm tra hàng đến không đạt, vật tư không vào kho hàng tốt mà vào kho hàng lỗi, đồng thời kích hoạt quy trình đánh giá MRB.',
            'When incoming inspection fails, material does not enter the good warehouse but goes to the defective warehouse and triggers the MRB review process.',
          ),
          flow(
            ['检验不合格', 'Kiểm tra không đạt', 'Inspection failed'],
            ['不良品仓 defective', 'Kho hàng lỗi', 'Defective warehouse'],
            ['发起 MRB 评审', 'Khởi tạo đánh giá MRB', 'Initiate MRB review'],
            ['MRB 处置决策', 'Quyết định xử lý MRB', 'MRB disposition'],
            ['退货 / 返工 / 报废 / 特采', 'Trả hàng / Làm lại / Tiêu hủy / Chấp nhận đặc biệt', 'Return / Rework / Scrap / Special admit'],
          ),
          table(
            [['MRB 处置方式', 'Phương thức xử lý MRB', 'MRB disposition'], ['库存状态变化', 'Thay đổi trạng thái tồn kho', 'Inventory status change'], ['后续动作', 'Hành động tiếp theo', 'Next action']],
            [
              [
                ['退货', 'Trả hàng', 'Return'],
                ['defective → returned（退货冻结）', 'defective → returned (phong tỏa chờ trả)', 'defective → returned (held for return)'],
                ['生成供应商退货单，需仓管员确认出库', 'Tạo phiếu trả hàng nhà cung cấp, nhân viên kho xác nhận xuất', 'Creates a supplier return order; keeper confirms outbound'],
              ],
              [
                ['返工', 'Làm lại', 'Rework'],
                ['defective → rework（返工占用）', 'defective → rework (đang làm lại)', 'defective → rework'],
                ['生成返工单，返工完成后重新检验', 'Tạo phiếu làm lại; sau khi làm lại xong kiểm tra lại', 'Creates a rework order; re-inspect after rework'],
              ],
              [
                ['报废', 'Tiêu hủy', 'Scrap'],
                [
                  'defective → scrapped（冻结待销毁）',
                  'defective → scrapped (đóng băng chờ tiêu hủy)',
                  'defective → scrapped (frozen, pending destruction)',
                ],
                [
                  '先生成调拨任务：货进不良品仓后由仓管点「报废销毁」，核销后数量归 0',
                  'Tạo nhiệm vụ chuyển kho trước: hàng vào kho lỗi rồi thủ kho bấm "Tiêu hủy hàng thải", ghi giảm về 0',
                  'Creates a transfer task first; after goods reach the defective warehouse, the keeper clicks "Destroy scrap" and the quantity is written down to 0',
                ],
              ],
              [
                ['特采放行', 'Chấp nhận đặc biệt', 'Special admit'],
                ['defective → good（可用库存）', 'defective → good (tồn khả dụng)', 'defective → good (usable stock)'],
                ['可正常发料生产，记录特采单号与依据', 'Xuất kho sản xuất bình thường, ghi số phiếu và căn cứ chấp nhận đặc biệt', 'Can be issued normally; records the special-admit reference'],
              ],
            ],
          ),
          note(
            'warn',
            '特采放行的物料在系统里就是普通可用库存，发料环节不会再提示"这是特采件"。若需在生产端区分，必须在实物或随工单上另行标识。',
            'Vật tư chấp nhận đặc biệt trong hệ thống là tồn kho khả dụng bình thường; khi xuất kho sẽ không còn cảnh báo "đây là hàng chấp nhận đặc biệt". Nếu cần phân biệt ở sản xuất, phải đánh dấu riêng trên thực tế hoặc trên lệnh sản xuất.',
            'Special-admit material is ordinary usable stock in the system; issuing will not warn that it is a special admit. If production needs to distinguish it, mark it physically or on the traveler.',
          ),
        ],
      },
      {
        id: 'flow-roles',
        title: T('谁在什么时候做什么', 'Ai làm gì vào lúc nào', 'Who Does What, When'),
        blocks: [
          ul(
            ['仓管员：物料到达后第一时间扫码收货，并提交 IQC。这是所有后续流程的起点，收到货不扫码，库存里就永远查不到这批料。', 'Nhân viên kho: quét mã nhận hàng ngay khi vật tư đến và gửi IQC. Đây là điểm khởi đầu của mọi quy trình; nhận hàng mà không quét mã thì lô đó sẽ không bao giờ có trong tồn kho.', 'Warehouse Keeper: scan the receipt as soon as material arrives and submit it to IQC. This is the start of everything — if you do not scan, the batch will never appear in inventory.'],
            ['IQC 检验员：在「待检」列表里处理待检批次，录入检验结果。检验单一旦判定，库存状态就随之改变。', 'Nhân viên IQC: xử lý lô chờ kiểm trong danh sách "Chờ kiểm" và nhập kết quả. Ngay khi có kết luận, trạng thái tồn kho thay đổi theo.', 'IQC Inspector: work the Pending list, enter results. The moment a verdict is given, inventory status changes accordingly.'],
            ['仓管员 / 物料员：检验合格后的物料才能被领用。领料时若系统提示库存不足，先查「库存查询」确认是否真的无料，再看是否被锁定。', 'Nhân viên kho / nhân viên vật tư: chỉ vật tư đã kiểm tra đạt mới được lĩnh. Nếu hệ thống báo thiếu tồn, hãy vào "Tra cứu tồn kho" xác nhận có thực sự hết hàng không, rồi xem có bị phong tỏa không.', 'Warehouse Keeper / Material Handler: only material that passed inspection can be picked. If the system reports insufficient stock, check Inventory Query to confirm the shortage and whether stock is locked.'],
            ['MRB 评审员：不合格品不会自己消失，必须在「MRB 评审」中给出处置结论，否则它会一直占用不良品仓。', 'Người đánh giá MRB: hàng không đạt không tự biến mất; phải đưa ra kết luận xử lý trong "Đánh giá MRB", nếu không nó sẽ chiếm kho hàng lỗi mãi.', 'MRB Reviewer: nonconforming stock will not clear itself. A disposition must be given in MRB Review, otherwise it keeps occupying the defective warehouse.'],
          ),
        ],
      },
    ],
  },

  // ================================================================ 4 基础数据
  {
    id: 'basedata',
    icon: 'database',
    title: T('基础数据维护', 'Bảo trì dữ liệu nền', 'Master Data'),
    summary: T(
      '仓库、库位、物料、供应商、替代料。基础数据是所有单据的前提，建议先配置到位再开始收发料。',
      'Kho, vị trí, vật tư, nhà cung cấp, vật tư thay thế. Dữ liệu nền là tiền đề của mọi phiếu; nên cấu hình đầy đủ trước khi bắt đầu nhận/xuất.',
      'Warehouses, locations, materials, suppliers and substitutions. Master data underpins every document — configure it before receiving or issuing.',
    ),
    sections: [
      {
        id: 'basedata-warehouse',
        title: T('仓库与库位', 'Kho và vị trí', 'Warehouse & Location'),
        blocks: [
          p(
            '库存的三级定位是「仓库 → 库位 → 批次」。要查一批料在哪里，必须同时知道这三项。',
            'Vị trí tồn kho có ba cấp: "Kho → Vị trí → Lô". Muốn biết một lô hàng ở đâu, cần biết đồng thời cả ba.',
            'Inventory is located in three levels: Warehouse → Location → Batch. To find where a batch is, you need all three.',
          ),
          h3('仓库（Warehouse）', 'Kho (Warehouse)', 'Warehouse'),
          ul(
            ['菜单路径：基础数据 → 仓库。维护仓库地址码与名称。', 'Đường dẫn: Dữ liệu nền → Kho. Bảo trì mã địa chỉ kho và tên kho.', 'Menu: Master Data → Warehouse. Maintain the warehouse code and name.'],
            ['仓库地址码（如 WL001）是后续单据的必填项，一经使用不建议修改。', 'Mã địa chỉ kho (ví dụ WL001) là trường bắt buộc của phiếu sau này; không nên sửa sau khi đã dùng.', 'The warehouse code (e.g. WL001) is mandatory on later documents; avoid changing it once used.'],
          ),
          h3('库位（Location）', 'Vị trí (Location)', 'Location'),
          ul(
            ['菜单路径：基础数据 → 库位。', 'Đường dẫn: Dữ liệu nền → Vị trí.', 'Menu: Master Data → Location.'],
            ['每个库位隶属于某一仓库，并有「库位类型」：良品仓（good）与不良品仓（defective）。', 'Mỗi vị trí thuộc một kho và có "loại vị trí": kho hàng tốt (good) và kho hàng lỗi (defective).', 'Each location belongs to a warehouse and has a type: good or defective.'],
            ['库位类型决定物料放进去后的库存状态，扫码收货时必须选对。', 'Loại vị trí quyết định trạng thái tồn kho sau khi đặt hàng vào; khi quét mã nhận hàng phải chọn đúng.', 'The location type determines the resulting stock status; choose correctly when scanning receipts.'],
            ['停用的库位不能再扫码收货，但历史库存仍然查得到。', 'Vị trí đã ngừng dùng không thể quét nhận hàng nữa, nhưng tồn kho lịch sử vẫn tra cứu được.', 'Disabled locations cannot receive scans, but historical stock remains queryable.'],
          ),
          note(
            'tip',
            '库位编码建议采用"区-排-列-层"四段式（如 A-01-00-0001），现场找料时可以直接按编码定位货架。',
            'Nên đặt mã vị trí theo bốn đoạn "khu-hàng-cột-tầng" (ví dụ A-01-00-0001) để tìm hàng tại chỗ theo mã là xác định được kệ.',
            'Use a four-segment location code such as A-01-00-0001 so staff can walk straight to the shelf.',
          ),
        ],
      },
      {
        id: 'basedata-material',
        title: T('物料（Material）', 'Vật tư (Material)', 'Material'),
        blocks: [
          p(
            '物料是库存的主体。收货时系统会用二维码里的"料号"去物料表查找，查不到就直接判定"非认可物料"并拒绝收货。',
            'Vật tư là chủ thể của tồn kho. Khi nhận hàng, hệ thống dùng "mã vật tư" trong mã QR để tra bảng vật tư; không tìm thấy sẽ kết luận ngay "vật tư không được công nhận" và từ chối nhận.',
            'Material is the core of inventory. On receipt the system looks up the part number from the QR code; if it is not found, the scan is rejected as "unregistered material".',
          ),
          table(
            [['字段', 'Trường', 'Field'], ['说明', 'Mô tả', 'Description'], ['影响', 'Ảnh hưởng', 'Impact']],
            [
              [
                ['料号', 'Mã vật tư', 'Part No.'],
                ['物料的唯一编码', 'Mã duy nhất của vật tư', 'Unique material code'],
                ['必须与二维码完全一致，区分大小写', 'Phải khớp hoàn toàn với mã QR, phân biệt chữ hoa/thường', 'Must match the QR exactly, case-sensitive'],
              ],
              [
                ['物料名称 / 规格', 'Tên / Quy cách', 'Name / Spec'],
                ['用于人工识别', 'Dùng để nhận biết thủ công', 'For human identification'],
                ['仅展示', 'Chỉ hiển thị', 'Display only'],
              ],
              [
                ['单位', 'Đơn vị', 'Unit'],
                ['PCS / KG / M 等', 'PCS / KG / M…', 'PCS / KG / M, etc.'],
                ['库存与领料的计量单位', 'Đơn vị đo của tồn kho và lĩnh vật tư', 'Unit of measure for stock and picking'],
              ],
              [
                ['包装类型', 'Loại đóng gói', 'Packaging type'],
                ['普通 / 盘装料（Reel）', 'Thường / Cuộn (Reel)', 'Normal / Reel'],
                ['决定收发方式：普通料按数量收发；盘装料按「盘」记台账，发料时自动关联，不需要另扫盘号', 'Quyết định cách nhận/xuất: hàng thường theo số lượng; hàng cuộn ghi sổ theo "cuộn", khi xuất tự động liên kết, không cần quét số cuộn riêng', 'Drives how material is received/issued: normal by quantity; reels are tracked per reel and auto-linked on issue — no separate reel number to scan'],
              ],
              [
                ['默认供应商', 'Nhà cung cấp mặc định', 'Default supplier'],
                ['该物料默认的合格供应商', 'Nhà cung cấp đạt chuẩn mặc định của vật tư', 'The default approved supplier for the material'],
                ['收货时二维码中的供应商必须与此一致，否则判定"非合格供应商"', 'Nhà cung cấp trong mã QR khi nhận hàng phải khớp, nếu không sẽ bị coi là "nhà cung cấp không đạt"', 'The supplier in the QR must match, otherwise it is rejected as an unqualified supplier'],
              ],
              [
                ['保质期', 'Hạn sử dụng', 'Shelf life'],
                ['有效期天数', 'Số ngày hiệu lực', 'Validity in days'],
                ['超期会触发库存超期预警，可走超期复检', 'Quá hạn sẽ kích hoạt cảnh báo tồn kho quá hạn, có thể kiểm tra lại', 'Expiry triggers inventory alerts and a re-inspection route'],
              ],
              [
                ['单价', 'Đơn giá', 'Unit price'],
                ['成本核算用', 'Dùng tính giá thành', 'For costing'],
                ['影响金额类报表', 'Ảnh hưởng báo cáo về tiền', 'Affects monetary reports'],
              ],
              [
                ['超领比例', 'Tỷ lệ lĩnh vượt', 'Over-issue ratio'],
                ['允许超领的百分比', 'Phần trăm cho phép lĩnh vượt', 'Allowed over-issue percentage'],
                ['领料时校验上限，0 表示不允许超领', 'Kiểm tra giới hạn khi lĩnh; 0 nghĩa là không cho lĩnh vượt', 'Validated on picking; 0 means over-issue is not allowed'],
              ],
              [
                ['补料比例', 'Tỷ lệ bổ sung', 'Supplement ratio'],
                ['允许补料的百分比', 'Phần trăm cho phép bổ sung', 'Allowed supplement percentage'],
                ['补料单校验上限', 'Kiểm tra giới hạn trên phiếu bổ sung', 'Validated on supplement orders'],
              ],
            ],
          ),
          note(
            'warn',
            '二维码里的"料号"和"供应商"两项必须同时正确：料号在物料表里不存在 → 提示"非认可物料"；料号存在但供应商与该物料的默认供应商不一致 → 提示"非合格供应商"。两种都会拒收。',
            'Hai trường "mã vật tư" và "nhà cung cấp" trong mã QR phải cùng đúng: mã vật tư không có trong bảng → báo "vật tư không được công nhận"; mã có nhưng nhà cung cấp khác nhà cung cấp mặc định → báo "nhà cung cấp không đạt". Cả hai đều bị từ chối nhận.',
            'Both the part number and supplier in the QR must be correct: an unknown part number gives "unregistered material"; a known part number with a mismatched supplier gives "unqualified supplier". Both are rejected.',
          ),
          h3('批量导入物料主数据', 'Nhập hàng loạt dữ liệu vật tư', 'Bulk Import of Materials'),
          ol(
            [
              '菜单路径：物料管理 → 物料主数据 → 「批量导入」。',
              'Đường dẫn: Quản lý vật tư → Dữ liệu vật tư → "Nhập hàng loạt".',
              'Menu: Material Management → Material Master → Bulk Import.',
            ],
            [
              '先选文件做「预检」：系统只解析比对、不写库，列出将新增、将更新、以及每条字段的前后变化。',
              'Chọn tệp để "Kiểm tra trước": hệ thống chỉ phân tích so sánh, không ghi dữ liệu, liệt kê mục sẽ thêm, sẽ cập nhật và thay đổi từng trường.',
              'Pick the file for a pre-check: it parses and diffs without writing, listing what will be created, updated and each field change.',
            ],
            [
              '确认无误后点「确认导入」，系统先自动快照旧数据，再整体覆盖。',
              'Sau khi xác nhận, bấm "Xác nhận nhập": hệ thống chụp nhanh dữ liệu cũ rồi ghi đè toàn bộ.',
              'On confirm, the system snapshots the old data and then overwrites as a whole.',
            ],
            [
              '需要模板时，直接点「批量导出」——导出的文件就是导入模板，改完原样导回即可。',
              'Cần mẫu thì bấm "Xuất hàng loạt" — tệp xuất ra chính là mẫu nhập, sửa xong nhập lại nguyên dạng.',
              'Need a template? Click Bulk Export — the exported file is the import template; edit and import it back as-is.',
            ],
          ),
          table(
            [['导出/导入列', 'Cột xuất/nhập', 'Export/Import column'], ['说明', 'Mô tả', 'Notes']],
            [
              [['序号', 'STT', 'No.'], ['行号，导入时忽略', 'Số dòng, bỏ qua khi nhập', 'Row number, ignored on import']],
              [['物料编码', 'Mã vật tư', 'Material code'], ['必填，唯一键；已存在则更新，不存在则新增', 'Bắt buộc, khóa duy nhất; có rồi thì cập nhật, chưa có thì thêm', 'Required, unique key; existing rows update, new rows insert']],
              [['物料名称', 'Tên vật tư', 'Material name'], ['必填', 'Bắt buộc', 'Required']],
              [['规格型号', 'Quy cách', 'Specification'], ['必填', 'Bắt buộc', 'Required']],
              [['物料类型', 'Loại vật tư', 'Material type'], ['必填，按标准分类', 'Bắt buộc, theo phân loại chuẩn', 'Required, standard categories']],
              [['包装类型', 'Loại đóng gói', 'Packaging type'], ['填「普通」或「盘装料(Reel)」；留空则保留系统中已有值', 'Điền "Thường" hoặc "Cuộn (Reel)"; để trống thì giữ giá trị hiện có', 'Enter Normal or Reel; leave blank to keep the existing value']],
              [['单位 / MSL等级 / 等级', 'Đơn vị / MSL / Cấp', 'Unit / MSL / Grade'], ['按实际填写', 'Điền theo thực tế', 'Fill as applicable']],
              [['有效期天数 / 强制报废天数', 'Số ngày hiệu lực / bắt buộc tiêu hủy', 'Shelf life / Force-scrap days'], ['整数天数', 'Số ngày nguyên', 'Whole days']],
              [['供应商代码 / 供应商名称', 'Mã / Tên nhà cung cấp', 'Supplier code / name'], ['代码是关联键；名称用于建供应商档案', 'Mã là khóa liên kết; tên dùng tạo hồ sơ nhà cung cấp', 'Code is the link key; name is used to create the supplier record']],
              [['状态', 'Trạng thái', 'Status'], ['填「启用 / 停用」', 'Điền "Đang dùng / Ngừng dùng"', 'Enter Enabled / Disabled']],
            ],
          ),
          note(
            'warn',
            '导入是「全量覆盖」：文件里没有的物料会被置为归档，从列表消失（历史单据仍可查）。所以必须导出全量→在导出文件上改→整份导回，不要只导几行。',
            'Nhập là "ghi đè toàn bộ": vật tư không có trong tệp sẽ bị lưu trữ và biến mất khỏi danh sách (chứng từ cũ vẫn tra được). Vì vậy phải xuất toàn bộ → sửa trên tệp xuất → nhập lại cả tệp, không nhập vài dòng.',
            'Import is a full overwrite: materials absent from the file are archived and disappear from the list (historical documents remain). Always export everything, edit that file, then import the whole file — never import just a few rows.',
          ),
          note(
            'tip',
            '物料列表的「供应商名称」是根据供应商代码自动带出来的，不用在物料上单独维护名称；供应商改名后，物料列表会自动显示新名称。',
            'Cột "Tên nhà cung cấp" trong danh sách được tự lấy theo mã nhà cung cấp, không cần bảo trì tên riêng trên vật tư; khi nhà cung cấp đổi tên, danh sách tự hiển thị tên mới.',
            'The Supplier Name column is derived from the supplier code, so there is no separate name to maintain on the material; renaming a supplier updates the list automatically.',
          ),
        ],
      },
      {
        id: 'basedata-supplier',
        title: T('供应商（Supplier）', 'Nhà cung cấp (Supplier)', 'Supplier'),
        blocks: [
          ul(
            ['菜单路径：基础数据 → 供应商。', 'Đường dẫn: Dữ liệu nền → Nhà cung cấp.', 'Menu: Master Data → Supplier.'],
            ['供应商编码（如 A.967）是二维码第一段，必须与标签上完全一致。', 'Mã nhà cung cấp (ví dụ A.967) là đoạn đầu của mã QR, phải khớp hoàn toàn với nhãn.', 'The supplier code (e.g. A.967) is the first QR segment and must match the label exactly.'],
            ['供应商与物料的对应关系维护在物料上（物料的"默认供应商"字段），而不是在供应商页面。', 'Quan hệ nhà cung cấp – vật tư được bảo trì trên vật tư (trường "nhà cung cấp mặc định"), không phải trên trang nhà cung cấp.', 'The supplier–material relationship lives on the material record (Default Supplier field), not on the supplier page.'],
            ['检验不合格会产生供应商欠料/债务记录，用于后续索赔与索赔核销。', 'Kiểm tra không đạt sẽ sinh bản ghi nợ/nợ vật tư nhà cung cấp, dùng cho bồi thường và ghi giảm sau này.', 'Failed inspection creates supplier debt records used for claims and settlement.'],
          ),
        ],
      },
      {
        id: 'basedata-substitution',
        title: T('替代料（Substitution）', 'Vật tư thay thế (Substitution)', 'Material Substitution'),
        blocks: [
          ul(
            ['菜单路径：基础数据 → 替代料。', 'Đường dẫn: Dữ liệu nền → Vật tư thay thế.', 'Menu: Master Data → Substitution.'],
            ['替代料用于定义"A 物料可以顶替 B 物料使用"的关系，由工程师维护。', 'Vật tư thay thế định nghĩa quan hệ "vật tư A có thể thay thế vật tư B", do kỹ sư bảo trì.', 'Substitution defines "material A may be used in place of material B", maintained by engineers.'],
            ['定义了替代关系后，发料时若主料不足，可按替代关系发替代料。', 'Sau khi định nghĩa, khi xuất kho nếu vật tư chính không đủ có thể xuất vật tư thay thế theo quan hệ này.', 'Once defined, if the primary material is short, the substitute can be issued instead.'],
            ['替代关系不等同于 BOM 变更。BOM 变更应走 BOM 维护流程。', 'Quan hệ thay thế không đồng nghĩa với thay đổi BOM. Thay đổi BOM phải theo quy trình bảo trì BOM.', 'Substitution is not the same as a BOM change. BOM changes follow the BOM maintenance process.'],
          ),
        ],
      },
      {
        id: 'basedata-order',
        title: T('建议的初始化顺序', 'Thứ tự khởi tạo đề xuất', 'Suggested Setup Order'),
        blocks: [
          p(
            '新部署或新建物料时，建议按下面的顺序维护，可以避免很多"字段找不到"的报错。',
            'Khi triển khai mới hoặc tạo vật tư mới, nên bảo trì theo thứ tự dưới đây để tránh nhiều lỗi "không tìm thấy trường".',
            'For a new deployment or new materials, follow this order to avoid many "field not found" errors.',
          ),
          ol(
            ['建供应商', 'Tạo nhà cung cấp', 'Create suppliers'],
            ['建仓库', 'Tạo kho', 'Create warehouses'],
            ['建库位（指定良品仓 / 不良品仓）', 'Tạo vị trí (chỉ định kho hàng tốt / hàng lỗi)', 'Create locations (good / defective)'],
            ['建物料（含默认供应商、单位、保质期、超领比例）', 'Tạo vật tư (gồm nhà cung cấp mặc định, đơn vị, hạn dùng, tỷ lệ lĩnh vượt)', 'Create materials (default supplier, unit, shelf life, over-issue ratio)'],
            ['建 BOM（若该物料要用于生产）', 'Tạo BOM (nếu vật tư dùng cho sản xuất)', 'Create BOMs (if used in production)'],
            ['建替代料关系（可选）', 'Tạo quan hệ vật tư thay thế (tùy chọn)', 'Create substitutions (optional)'],
          ),
          note(
            'info',
            '以上六步完成后，就可以开始扫码收货了。若跳过第 4 步，收货时会直接报"非认可物料"。',
            'Sau khi hoàn thành sáu bước trên là có thể bắt đầu quét mã nhận hàng. Nếu bỏ qua bước 4, khi nhận hàng sẽ báo ngay "vật tư không được công nhận".',
            'Once these six steps are done you can start scanning receipts. Skipping step 4 causes an immediate "unregistered material" error.',
          ),
        ],
      },
    ],
  },
];
