# Word to Quenti 知识点卡片转换工具

将 Word 文档（通过 HTML 导出）批量转换为 Quenti 学习卡片，支持数学公式渲染和图片上传。

## 功能特性

- 🔄 **批量转换**: 自动处理文件夹中的所有 HTML 文件
- 🧠 **AI 智能提取**: 使用 Gemini AI 从 HTML 中提取知识点
- 📐 **公式渲染**: 自动将 LaTeX 公式渲染为图片
- 🖼️ **图片处理**: 提取 HTML 中的 Base64 图片并上传到 CDN
- 📊 **进度追踪**: 记录处理日志和统计信息
- ⏸️ **断点续传**: 支持从指定位置继续处理

## 目录结构

```
word-to-quenti/
├── scripts/                    # 核心脚本
│   ├── process-all.ts          # 主处理脚本（批量）
│   ├── html-to-cards-gemini.ts # Gemini AI 提取知识点
│   ├── extract-html-images.ts  # 提取 HTML 中的图片
│   ├── render-latex-to-png.ts  # LaTeX 公式渲染
│   └── bulk-term-image-upload.ts # 批量上传图片
├── input_html/                 # 数学 HTML 输入（第1部分）
├── input_html2/                # 数学 HTML 输入（第2部分）
├── 化学/                       # 化学 HTML 源文件
├── chem_1_37/                  # 化学 1-37 章节
├── chem_38_64/                 # 化学 38-64 章节
├── out/                        # 输出目录
│   ├── batch-log-*.txt         # 处理日志
│   ├── batch-stats-*.json      # 各学习集统计
│   ├── cards.json              # 最后一批卡片数据
│   └── html_images/            # 提取的图片（已忽略）
├── package.json
└── README.md
```

## 环境要求

- Node.js 18+
- npm 或 pnpm

## 安装

```bash
npm install
```

## 配置

创建环境变量或在运行时设置：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `INPUT_DIR` | HTML 文件目录 | `input_html` |
| `INPUT_HTML_DIR` | 同上（别名） | `input_html` |
| `APP_URL` | Quenti 服务地址 | `http://cika.dzexam.cn` |
| `CDN_ENDPOINT` | CDN 上传地址 | `https://quenti-cdn.xxx.workers.dev` |
| `SESSION_COOKIE` | 登录 Cookie | `next-auth.session-token=xxx` |
| `STUDY_SET_ID` | 学习集 ID | `cmiu6aug001tg3oodswzgrzr0` |
| `START_INDEX` | 起始索引（可选） | `0` |
| `GEMINI_API_KEY` | Gemini API 密钥 | `AIza...` |

## 使用方法

### 批量处理

```powershell
# Windows PowerShell
$env:INPUT_DIR="化学"
$env:APP_URL="http://cika.dzexam.cn"
$env:CDN_ENDPOINT="https://quenti-cdn.xxx.workers.dev"
$env:SESSION_COOKIE="next-auth.session-token=xxx"
$env:STUDY_SET_ID="cmiu6aug001tg3oodswzgrzr0"
npm run batch
```

```bash
# Linux/Mac
INPUT_DIR="化学" \
APP_URL="http://cika.dzexam.cn" \
CDN_ENDPOINT="https://quenti-cdn.xxx.workers.dev" \
SESSION_COOKIE="next-auth.session-token=xxx" \
STUDY_SET_ID="cmiu6aug001tg3oodswzgrzr0" \
npm run batch
```

### 从指定位置继续

```powershell
$env:START_INDEX="10"  # 从第11个文件开始
npm run batch
```

## 输出文件

### 处理日志 (`out/batch-log-*.txt`)

```
[2025-12-06 10:30:15] 开始处理: 1.物质的组成和性质分类.html
[2025-12-06 10:30:20] 成功: 1.物质的组成和性质分类.html (12 张卡片)
```

### 统计文件 (`out/batch-stats-*.json`)

```json
{
  "studySetId": "cmiu6aug001tg3oodswzgrzr0",
  "totalFiles": 37,
  "processedFiles": 37,
  "totalCards": 395,
  "successCount": 37,
  "failCount": 0,
  "startTime": "2025-12-06T08:00:00.000Z",
  "endTime": "2025-12-06T09:30:00.000Z"
}
```

## 已处理的学习集

| 学习集 | ID | 内容 | 卡片数 |
|--------|-----|------|--------|
| 数学知识点1 | `cmisp1rfq00k13oo2djrv5q4c` | 1.1-6.6 章节 | 338 |
| 数学知识点2 | `cmituupqv000w3oodckfg5att` | 7.1-13.9 章节 | 216 |
| 化学知识点1 | `cmiu6aug001tg3oodswzgrzr0` | 1-37 章节 | 395 |
| 化学知识点2 | `cmiu4pakg01bf3oodqe8jyizg` | 38-64 章节 | 326 |

## 常见问题

### Q: 处理中断了怎么办？
A: 设置 `START_INDEX` 从上次位置继续，查看日志确定最后成功的文件编号。

### Q: 图片没有显示？
A: 检查 CDN 上传是否成功，确认 `CDN_ENDPOINT` 配置正确。

### Q: 公式渲染失败？
A: 确保系统安装了中文字体，或检查 LaTeX 语法是否正确。

## License

MIT

