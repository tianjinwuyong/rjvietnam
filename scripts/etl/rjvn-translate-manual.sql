-- Manual translations for 8 long packaging descriptions the local LLM could not
-- format reliably. Complements rjvn-translate-names.mjs. Idempotent (guard on
-- name_en = name_zh). Run after the automated translator.
BEGIN;

UPDATE public.materials SET
  name_en = 'Pallet L1220*W1020*120mm plywood, dynamic load 800kg, static 1000kg, RoHS REACH, 60pcs/pallet, Wanshengxing',
  name_vi = 'Pallet go L1220*W1020*120mm, tai dong 800kg, tinh 1000kg, RoHS REACH, 60cai/pallet'
WHERE id = 234 AND name_en = name_zh;

UPDATE public.materials SET
  name_en = 'Divider card 51003003970 V1, L400*W288mm T3.0mm A3A (B flute), 1/1PCS, RoHS REACH, brand Hexie',
  name_vi = 'The ngan 51003003970 V1, L400*W288mm T3.0mm A3A (song B), 1/1PCS, RoHS REACH'
WHERE id = 235 AND name_en = name_zh;

UPDATE public.materials SET
  name_en = 'Corner protector L50*50*800mm hard paper, RoHS REACH, Hexing',
  name_vi = 'Bao ve goc L50*50*800mm giay cung, RoHS REACH'
WHERE id = 237 AND name_en = name_zh;

UPDATE public.materials SET
  name_en = 'Corner protector L50*50*920mm hard paper, RoHS, 960pcs/1 protector, Hexing',
  name_vi = 'Bao ve goc L50*50*920mm giay cung, RoHS, 960cai/1 bao ve goc'
WHERE id = 239 AND name_en = name_zh;

UPDATE public.materials SET
  name_en = 'AC wire label V1, Logo change, 8.9*38.1mm, green/black, Pantone 368C, 4# pearlescent paper, matte, 0.1mm, alcohol resistant, RoHS REACH',
  name_vi = 'Nhan day AC V1, doi Logo, 8.9*38.1mm, xanh/den, Pantone 368C, giay ngoc trai 4#, mo, 0.1mm, chong alcohol, RoHS REACH'
WHERE id = 240 AND name_en = name_zh;

UPDATE public.materials SET
  name_en = 'Protective film 0.35mm*100mm*1000m, ultrasonic dedicated',
  name_vi = 'Mang bao ve 0.35mm*100mm*1000m, chuyen dung sieu am'
WHERE id = 243 AND name_en = name_zh;

UPDATE public.materials SET
  name_en = 'Bottom sealing sticker 51004002207 V4 A2033H21, 50# oil glue transparent PET, partial glue, strong adhesion, dia 30mm, peel force 6.3N, 30*30mm',
  name_vi = 'Nhan dan kin day 51004002207 V4 A2033H21, PET trong keo dau 50#, keo mot phan, dinh chac, duong kin 30mm, luc boc 6.3N, 30*30mm'
WHERE id = 246 AND name_en = name_zh;

UPDATE public.materials SET
  name_en = 'EPE foam 400*288mm T5.0mm, white, 1/1PCS',
  name_vi = 'Mut xop EPE 400*288mm T5.0mm, mau trang, 1/1PCS'
WHERE id = 248 AND name_en = name_zh;

COMMIT;
