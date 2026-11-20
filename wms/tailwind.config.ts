export default {
  // 只扫描代码文件：把 *.css 也算进来会让 Tailwind 去解析样式文件里的
  // `[class~='bg-[#F2F2F7]']` 这类选择器，构建时间从秒级退化到几分钟。
  content: [
    './client/src/**/*.{ts,tsx}',
    './index.html',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
