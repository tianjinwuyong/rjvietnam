-- Manual proofreading fixes (2026-11-18)
-- 59 rows where name_en == name_vi (English copied into the Vietnamese column),
-- including 6 rows where the English itself was mistranslated (LLM item drift).
-- Guard `name_en = name_zh`-equivalent (here name_en=name_vi) keeps it idempotent.
BEGIN;

-- materials
UPDATE public.materials SET name_en='Through-hole MOSFET', name_vi='MOSFET xuyên lỗ' WHERE id IN (3440,3404) AND name_en=name_vi;
UPDATE public.materials SET name_en='Blister tray (vacuum-formed)', name_vi='Khay nhựa hút chân không' WHERE id IN (2790,4403) AND name_en=name_vi;
UPDATE public.materials SET name_en='Mylar sheet', name_vi='Tấm Mylar' WHERE id=3102 AND name_en=name_vi;
UPDATE public.materials SET name_en='Mylar film', name_vi='Màng Mylar' WHERE id=4399 AND name_en=name_vi;
UPDATE public.materials SET name_en='Blank white coated-paper label 100*80mm', name_vi='Nhãn giấy couche trắng 100*80mm' WHERE id=242 AND name_en=name_vi;
UPDATE public.materials SET name_en='PCB board', name_vi='Bo mạch PCB' WHERE id=4088 AND name_en=name_vi;
UPDATE public.materials SET name_en='Pin clamp holder', name_vi='Giá kẹp chân linh kiện' WHERE id=3165 AND name_en=name_vi;
UPDATE public.materials SET name_en='Rotating shaft', name_vi='Trục xoay' WHERE id=4398 AND name_en=name_vi;
UPDATE public.materials SET name_en='LCD display', name_vi='Màn hình LCD' WHERE id=4409 AND name_en=name_vi;
UPDATE public.materials SET name_en='EU connection cable L', name_vi='Cáp kết nối EU L' WHERE id=4414 AND name_en=name_vi;
UPDATE public.materials SET name_en='Bottom shell', name_vi='Vỏ dưới' WHERE id IN (4416,4425,4432,3168,3181) AND name_en=name_vi;
UPDATE public.materials SET name_en='Integrated circuit (IC)', name_vi='Mạch tích hợp IC' WHERE id=4419 AND name_en=name_vi;
UPDATE public.materials SET name_en='Base silicone pad', name_vi='Miếng đệm silicone đế' WHERE id=4420 AND name_en=name_vi;
UPDATE public.materials SET name_en='Flat-head screw', name_vi='Vít đầu dẹt' WHERE id=4421 AND name_en=name_vi;
UPDATE public.materials SET name_en='Temperature switch', name_vi='Công tắc nhiệt độ' WHERE id=4423 AND name_en=name_vi;
UPDATE public.materials SET name_en='Silicone wire', name_vi='Dây silicone' WHERE id=4424 AND name_en=name_vi;
UPDATE public.materials SET name_en='Female socket', name_vi='Ổ cắm cái' WHERE id=4427 AND name_en=name_vi;
UPDATE public.materials SET name_en='Yellow insulating tape', name_vi='Băng keo cách điện màu vàng' WHERE id=4428 AND name_en=name_vi;
UPDATE public.materials SET name_en='Silicone foot pad', name_vi='Miếng đệm chân silicone' WHERE id=4429 AND name_en=name_vi;
UPDATE public.materials SET name_en='Airplane shipping box', name_vi='Hộp carton vận chuyển' WHERE id=4433 AND name_en=name_vi;
UPDATE public.materials SET name_en='LCM buffer dust-proof foam', name_vi='Mút xốp chống bụi đệm LCM' WHERE id=4726 AND name_en=name_vi;
UPDATE public.materials SET name_en='Heat-shrink sleeve', name_vi='Ống gen co nhiệt' WHERE id=4394 AND name_en=name_vi;
UPDATE public.materials SET name_en='SR IC', name_vi='IC SR' WHERE id=4638 AND name_en=name_vi;
UPDATE public.materials SET name_en='MCU IC', name_vi='IC MCU' WHERE id IN (4667,4854) AND name_en=name_vi;
UPDATE public.materials SET name_en='PWM IC', name_vi='IC PWM' WHERE id=4976 AND name_en=name_vi;
UPDATE public.materials SET name_en='Long knife clip', name_vi='Kẹp dao dài' WHERE id=5153 AND name_en=name_vi;
UPDATE public.materials SET name_en='12-knife clip', name_vi='Kẹp dao 12' WHERE id=5830 AND name_en=name_vi;
UPDATE public.materials SET name_en='4-knife clip', name_vi='Kẹp dao 4' WHERE id=5831 AND name_en=name_vi;
UPDATE public.materials SET name_en='Main body shell', name_vi='Vỏ thân chính' WHERE id=3167 AND name_en=name_vi;
UPDATE public.materials SET name_en='Ring inductor', name_vi='Cuộn cảm hình vòng' WHERE id IN (3170,3176) AND name_en=name_vi;
UPDATE public.materials SET name_en='SMD switching diode', name_vi='Diode chuyển mạch dán' WHERE id=3171 AND name_en=name_vi;
UPDATE public.materials SET name_en='SMD Schottky diode', name_vi='Diode Schottky dán' WHERE id=3172 AND name_en=name_vi;
UPDATE public.materials SET name_en='SMD MOSFET', name_vi='MOSFET dán' WHERE id=3173 AND name_en=name_vi;
UPDATE public.materials SET name_en='Electrolytic capacitor', name_vi='Tụ điện giải' WHERE id=3175 AND name_en=name_vi;
UPDATE public.materials SET name_en='SMD connector', name_vi='Đầu nối dán' WHERE id=3182 AND name_en=name_vi;
UPDATE public.materials SET name_en='Two-part thermal gel B', name_vi='Gel dẫn nhiệt hai thành phần B' WHERE id=3184 AND name_en=name_vi;
UPDATE public.materials SET name_en='Solid capacitor', name_vi='Tụ rắn' WHERE id IN (3185,3186) AND name_en=name_vi;
UPDATE public.materials SET name_en='Teflon sleeve', name_vi='Ống Teflon' WHERE id=3187 AND name_en=name_vi;
UPDATE public.materials SET name_en='SMD IC', name_vi='IC dán' WHERE id IN (3188,3191,3192) AND name_en=name_vi;
UPDATE public.materials SET name_en='Heat sink', name_vi='Tản nhiệt' WHERE id=3190 AND name_en=name_vi;
UPDATE public.materials SET name_en='Film capacitor', name_vi='Tụ màng' WHERE id=3193 AND name_en=name_vi;
UPDATE public.materials SET name_en='Y capacitor', name_vi='Tụ Y' WHERE id IN (3194,3197) AND name_en=name_vi;
UPDATE public.materials SET name_en='Lens protective film', name_vi='Màng bảo vệ lens' WHERE id=3195 AND name_en=name_vi;
UPDATE public.materials SET name_en='Transformer-side thermal pad', name_vi='Miếng dẫn nhiệt bên biến áp' WHERE id=3196 AND name_en=name_vi;
UPDATE public.materials SET name_en='C-C wiring harness', name_vi='Bó dây nối C-C' WHERE id=3244 AND name_en=name_vi;

-- suppliers (company names: keep EN, fill VI)
UPDATE public.suppliers SET name_vi='Chi nhánh Đài Loan - GENESIS INNOVATION GROUP LIMITED' WHERE id=650 AND name_en=name_vi;
UPDATE public.suppliers SET name_vi='Công ty TNHH PLAB TECHNOLOGY' WHERE id=697 AND name_en=name_vi;

COMMIT;
