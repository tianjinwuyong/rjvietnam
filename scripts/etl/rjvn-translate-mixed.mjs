/**
 * Deterministic cleanup of partially translated names.
 *
 * The LLM translator left Chinese fragments in ~244 long technical names
 * (e.g. "Dongguan Lingen五金电子有限公司", "đèn capacitor电解"). It refuses to
 * translate those long mixed strings. This script replaces every remaining
 * Chinese fragment with a fixed EN / VI term from the dictionary below.
 *
 * Idempotent: only rows still containing Han characters are touched.
 * Output is still machine-generated — business proofreading remains required.
 */
import pg from "pg";

const HAN = /[一-鿿]/;
// Chinese fragment -> [English, Vietnamese]
const TERMS = {
  "电解": ["electrolytic", "điện giải"],
  "电阻": ["resistor", "điện trở"],
  "品牌": ["brand", "nhãn hiệu"],
  "无卤": ["halogen-free", "không halogen"],
  "厚声": ["Housheng", "Housheng"],
  "电子产品": ["electronic product", "sản phẩm điện tử"],
  "东莞市": ["Dongguan", "Đông Quản"],
  "五金": ["hardware", "kim loại"],
  "国巨": ["Yageo", "Yageo"],
  "专用": ["dedicated", "chuyên dụng"],
  "哑面": ["matte", "mờ"],
  "号": ["No.", "số"],
  "剥皮扭线浸锡": ["strip/twist/tin-dip", "bóc vỏ/xoắn/nhúng thiếc"],
  "封装": ["package", "đóng gói"],
  "集成电路": ["IC", "IC"],
  "散热": ["heat dissipation", "tản nhiệt"],
  "梅花": ["plum-blossom", "hoa mai"],
  "隔热": ["heat insulation", "cách nhiệt"],
  "镀锡处": ["tinned area", "vùng mạ thiếc"],
  "热敏电阻": ["thermistor", "điện trở nhiệt"],
  "五金电子有限公司": ["Hardware Electronics Co., Ltd.", "Công ty TNHH Điện tử Kim loại"],
  "变压器": ["transformer", "biến áp"],
  "支架": ["bracket", "giá đỡ"],
  "长刀卡": ["long knife clip", "kẹp dao dài"],
  "伸缩刀卡": ["telescopic knife clip", "kẹp dao co giãn"],
  "短刀卡": ["short knife clip", "kẹp dao ngắn"],
  "缩短刀卡": ["shortened knife clip", "kẹp dao rút gọn"],
  "护角尺寸为": ["corner protector size", "kích thước bảo vệ góc"],
  "硬纸材质": ["hard paper material", "chất liệu giấy cứng"],
  "符合": ["compliant", "tuân thủ"],
  "和": ["and", "và"],
  "标准": ["standard", "tiêu chuẩn"],
  "环保无害": ["eco-friendly", "thân thiện môi trường"],
  "封口贴": ["sealing sticker", "nhãn dán niêm phong"],
  "油胶透明": ["transparent oil glue", "keo dầu trong suốt"],
  "全胶": ["full adhesive", "keo toàn bộ"],
  "油胶强粘": ["strong oil glue", "keo dầu dính chắc"],
  "剥离力": ["peel force", "lực bóc"],
  "母座": ["female socket", "ổ cắm cái"],
  "梅花尾": ["plum tail", "đuôi hoa mai"],
  "合金": ["alloy", "hợp kim"],
  "三层绝缘": ["triple insulated", "cách điện ba lớp"],
  "铭牌": ["nameplate", "biển tên"],
  "捆扎带": ["binding strap", "dây buộc"],
  "绝缘": ["insulation", "cách điện"],
  "套管": ["sleeve", "ống gen"],
  "灰色": ["grey", "màu xám"],
  "仙桥": ["Xianqiao", "Xianqiao"],
  "晶导": ["Jingdao", "Jingdao"],
  "编带": ["tape", "băng đóng gói"],
  "晶导微": ["Jingdaowei", "Jingdaowei"],
  "编带盘装": ["tape and reel", "băng và cuộn"],
  "电感": ["inductor", "cuộn cảm"],
  "一体式骨架": ["integrated bobbin", "lõi tích hợp"],
  "低压": ["low voltage", "điện áp thấp"],
  "塑封": ["molded", "ép nhựa"],
  "覆": ["coated", "phủ"],
  "五金电子": ["hardware electronics", "điện tử kim loại"],
  "五金塑胶": ["hardware plastic", "nhựa kim loại"],
  "智造": ["smart manufacturing", "sản xuất thông minh"],
  "半导体股份有限公司": ["Semiconductor Co., Ltd.", "Công ty CP Bán dẫn"],
  "封": ["seal", "niêm phong"],
  "隔板": ["divider", "vách ngăn"],
  "木板隔板": ["wooden divider", "vách ngăn gỗ"],
  "外箱标签是白色铜版纸": ["outer box label is white coated paper", "nhãn thùng ngoài giấy couche trắng"],
  "尺寸为": ["size", "kích thước"],
  "袋": ["bag", "túi"],
  "材质": ["material", "chất liệu"],
  "厚度": ["thickness", "độ dày"],
  "符合环保要求": ["meets environmental requirements", "đáp ứng yêu cầu môi trường"],
  "丝印增加意大利回收标": ["silkscreen adds Italy recycling mark", "thêm ký hiệu tái chế Ý"],
  "实心三角形版本": ["solid triangle version", "phiên bản tam giác đặc"],
  "快": ["quick", "nhanh"],
  "主板": ["main board", "bo mạch chính"],
  "封口": ["sealing", "niêm phong"],
  "保险": ["fuse", "cầu chì"],
  "簧": ["spring", "lò xo"],
  "瓷": ["ceramic", "gốm"],
  "涤纶": ["polyester", "polyester"],
  "陶瓷": ["ceramic", "gốm sứ"],
  "开口": ["opening", "khe hở"],
  "塑料": ["plastic", "nhựa"],
  "梅花插头": ["plum plug", "phích cắm hoa mai"],
  "蜂窝": ["honeycomb", "tổ ong"],
  "垫": ["pad", "miếng đệm"],
  "入库": ["warehousing", "nhập kho"],
  "零件进料铆压好弹片": ["incoming part with pre-riveted spring", "linh kiện có lò xo đã rivet"],
  "十字": ["cross", "chữ thập"],
  "镀锡处打端子": ["terminal at tinned area", "đầu nối tại vùng mạ thiếc"],
  "内弯脚": ["inner bent pin", "chân cong trong"],
  "绿色": ["green", "màu xanh"],
  "至敏": ["sensitive", "nhạy"],
  "电容": ["capacitor", "tụ điện"],
  "玖鑫": ["Jiuxin", "Jiuxin"],
  "成型尺寸": ["formed size", "kích thước tạo hình"],
  "展开尺寸": ["unfolded size", "kích thước mở rộng"],
  "五金塑胶有限公司": ["Hardware & Plastic Co., Ltd.", "Công ty TNHH Kim loại & Nhựa"],
  "东莞市迈智包装材料有限公司": ["Dongguan Maizhi Packaging Materials Co., Ltd.", "Công ty Vật liệu Đóng gói Maizhi Đông Quản"],
  "盛上泰": ["Shengshangtai", "Shengshangtai"],
  "五金制品": ["hardware products", "sản phẩm kim loại"],
  "五金电子制品": ["electronic hardware products", "sản phẩm điện tử kim loại"],
  "五金有限公司": ["Hardware Co., Ltd.", "Công ty TNHH Kim loại"],
  "东莞市翔通塑胶制品有限公司": ["Dongguan Xiangtong Plastic Products Co., Ltd.", "Công ty SP Nhựa Xiangtong Đông Quản"],
  "環保": ["environmental", "môi trường"],
  "电线": ["wire", "dây điện"],
  "盛": ["Sheng", "Sheng"],
  "无锡": ["Wuxi", "Vô Tích"],
  "惠州": ["Huizhou", "Huệ Châu"],
  "郴州": ["Chenzhou", "Sâm Châu"],
  "厦门": ["Xiamen", "Hạ Môn"],
  "半导体": ["semiconductor", "bán dẫn"],
  "扬州": ["Yangzhou", "Dương Châu"],
};

// Longest first so "热敏电阻" is not partially replaced by "电阻".
const sorted = Object.keys(TERMS).sort((a, b) => b.length - a.length);
function clean(value, lang) {
  let out = String(value || "");
  for (const frag of sorted) out = out.split(frag).join(TERMS[frag][lang === "vi" ? 1 : 0]);
  return out.trim().slice(0, 160);
}

const pool = new pg.Pool({
  host: process.env.PGHOST || "127.0.0.1", port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "smt_factory",
});
let done = 0, remaining = 0;
for (const table of ["materials", "suppliers", "products"]) {
  const { rows } = await pool.query(
    `select id, name_en, name_vi from public.${table} where name_en ~ '[一-鿿]' or name_vi ~ '[一-鿿]' order by id`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      const en = clean(r.name_en, "en"), vi = clean(r.name_vi, "vi");
      if (!en || !vi) continue;
      await client.query(`update public.${table} set name_en=$1, name_vi=$2 where id=$3`, [en, vi, r.id]);
      done++;
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
  const { rows: left } = await pool.query(
    `select id from public.${table} where name_en ~ '[一-鿿]' or name_vi ~ '[一-鿿]'`);
  remaining += left.length;
  console.log(`[${table}] cleaned=${rows.length} remaining=${left.length}`);
}
await pool.end();
console.log(`DONE cleaned=${done} remaining=${remaining}`);
