/**
 * html-to-cards-gemini.ts
 * 用 OpenAI 兼容 API (OhMyGPT) 将 HTML 课件转换为 cards.raw.json
 */

import OpenAI from "openai";
import * as cheerio from "cheerio";
import fg from "fast-glob";
import * as fs from "fs/promises";
import * as path from "path";

// ============ API 配置 ============
const API_KEY = process.env.API_KEY || "sk-qYeChZLu2b3639514fC1T3BlbKFJ34863991ec3A4861BcC7";
const BASE_URL = process.env.BASE_URL || "https://apic1.ohmycdn.com/v1";
const MODEL = process.env.MODEL || "gemini-3-pro-preview";

// ============ 文件配置 ============
const INPUT_DIR = process.env.INPUT_DIR || "input_html";
const OUT_DIR = process.env.OUT_DIR || "out";
const OUT_FILE = process.env.OUT_FILE || path.join(OUT_DIR, "cards.raw.json");
const MAX_FILES_LIMIT = parseInt(process.env.MAX_FILES_LIMIT || "1", 10);
const MAX_CHARS = parseInt(process.env.MAX_CHARS || "30000", 10);
const TEST_FILE = process.env.TEST_FILE || "";

// ============ System Prompt ============
const SYSTEM_PROMPT = `你是一位高中数学知识卡片提取专家。从 HTML 课件中提取知识点，生成学习卡片。

## 核心规则

### 1. 卡片字段
- **term**: 格式【课程名·知识点】具体内容
- **definitionHtml**: 纯文本解释（30-50字，口袋小抄风格）
- **latex**: 核心公式（LaTeX 语法），用于渲染成图片
- **imageFileName**: HTML 中的图像文件名

### 2. 图像规则（重要！每张卡片最多一张图！）

**latex 和 imageFileName 只能二选一，不能同时有值！**

选择标准：
- **函数图像类**（曲线图、坐标系图）→ 用 imageFileName（从可用图像列表选）
- **公式/性质类**（定义、公式、条件）→ 用 latex（渲染成图片）
- **纯概念类**（方法、步骤、易错点）→ 两个都为空

latex 适用场景（积极使用！）：
- 定义公式：y=aˣ, y=logₐx, y=sinx
- 求解公式：求根公式、辅助角公式
- 性质公式：a⁰=1, logₐ1=0
- 条件表达式：a>1 递增, 0<a<1 递减

imageFileName 适用场景：
- 函数曲线图（只能从可用图像列表选择！）
- 几何示意图
- **不要编造文件名！**

### 3. definitionHtml 要求
- 纯文本，不要 HTML 标签
- 使用 Unicode 数学符号：√ ² ³ π θ ω α β ∈ ≤ ≥ ≠
- 不要用 LaTeX 语法（\\sqrt 等）
- 30-50 字，一句话结论 + 提醒

### 4. latex 字段要求
- 使用标准 LaTeX 语法
- 根号用 \\sqrt{}，分数用 \\frac{}{}
- **重要：公式中必须使用中文或常用符号，禁止用英文术语！**
  - ❌ 错误：e_{second-outer} ≤ 18（英文）
  - ✅ 正确：e_{次外层} \\leq 18（中文）
  - ❌ 错误：E_{activation}（英文）
  - ✅ 正确：E_a 或 E_{活化}（符号或中文）
- 化学/物理常用符号：
  - 电子数：n、e⁻
  - 能量：E、ΔH
  - 浓度：c、[H⁺]
  - 速率：v、k
- 示例：y=a^x, \\sqrt{a^2+b^2}, \\frac{2\\pi}{\\omega}

### 5. 输出格式
- 纯 JSON：{ "cards": [...] }
- 每个 Card 包含 term/definitionHtml/latex/imageFileName

### 6. 示例
{
  "cards": [
    {
      "term": "【指数函数·定义】基本形式",
      "definitionHtml": "底数 a>0 且 a≠1，自变量 x 在指数位置",
      "latex": "y=a^x \\quad (a>0, a\\neq 1)",
      "imageFileName": ""
    },
    {
      "term": "【指数函数·图像】增长型",
      "definitionHtml": "底数 a>1 时，过 (0,1)，单调递增，越往右越陡",
      "latex": "",
      "imageFileName": "4.2_00.png"
    },
    {
      "term": "【指数函数·性质】恒过定点",
      "definitionHtml": "无论底数 a 为何值，图像必过点 (0,1)",
      "latex": "a^0 = 1",
      "imageFileName": ""
    },
    {
      "term": "【指数函数·性质】单调性条件",
      "definitionHtml": "底数决定增减：大于1递增，小于1递减",
      "latex": "a>1 \\Rightarrow \\uparrow, \\quad 0<a<1 \\Rightarrow \\downarrow",
      "imageFileName": ""
    },
    {
      "term": "【复合函数·方法】同增异减",
      "definitionHtml": "内外层单调性相同则整体增，相反则整体减",
      "latex": "",
      "imageFileName": ""
    }
  ]
}`;

// ============ 类型定义 ============
interface Card {
  term: string;
  definitionHtml: string;
  latex: string;
  imageFileName?: string;
  pngPath?: string;
}

interface ImageInfo {
  fileName: string;
  htmlFile: string;
  index: number;
  context?: string;
}

const IMAGES_INDEX_FILE = path.join(OUT_DIR, "html_images", "index.json");

interface GeminiResponse {
  cards: Card[];
}

// ============ 工具函数 ============

function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, canvas, svg, head, meta, link").remove();
  const body = $("body").length ? $("body") : $.root();
  let text = "";
  body.find("h1, h2, h3, h4, h5, h6").each((_, el) => {
    text += `\n## ${$(el).text().trim()}\n`;
  });
  body.find("p, li, td, th, div.section").each((_, el) => {
    const content = $(el).text().trim();
    if (content && content.length > 5) {
      text += content + "\n";
    }
  });
  if (text.length < 500) {
    text = body.text();
  }
  return text.replace(/\s+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n+/);
  let current = "";
  for (const para of paragraphs) {
    if (current.length + para.length + 1 > maxChars) {
      if (current) chunks.push(current);
      current = para;
    } else {
      current += (current ? "\n" : "") + para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

async function loadAvailableImages(htmlFileName: string): Promise<ImageInfo[]> {
  try {
    const content = await fs.readFile(IMAGES_INDEX_FILE, "utf-8");
    const allImages: ImageInfo[] = JSON.parse(content);
    return allImages.filter(img => img.htmlFile === htmlFileName);
  } catch {
    return [];
  }
}

async function extractCardsFromText(
  client: OpenAI,
  text: string,
  fileName: string,
  availableImages: ImageInfo[]
): Promise<Card[]> {
  let imageListText = "";
  if (availableImages.length > 0) {
    imageListText = `\n\n### 可用图像列表（函数图像类卡片从这里选！）\n`;
    for (const img of availableImages) {
      imageListText += `- **${img.fileName}**: ${img.context || "无描述"}\n`;
    }
    imageListText += `\n⚠️ imageFileName 只能从上面列表选，不要编造！`;
  } else {
    imageListText = `\n\n### 可用图像\n本课件没有可用图像，imageFileName 都填空字符串 ""，公式类用 latex。`;
  }

  const userPrompt = `从以下课件提取知识卡片。

文件名: ${fileName}
${imageListText}

--- 内容 ---
${text}
--- 结束 ---

要求：
1. 提取 10~30 张卡片
2. latex 和 imageFileName 只能二选一！
3. 公式/性质类 → 用 latex
4. 函数图像类 → 用 imageFileName（从列表选）
5. 纯概念类 → 两个都为空
6. definitionHtml 用 Unicode（√²π 等），不要 LaTeX`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 8192,
      response_format: { type: "json_object" },
    });

    const responseText = response.choices[0]?.message?.content;
    if (!responseText) return [];
    const cleanedJson = cleanJsonResponse(responseText);
    const parsed: GeminiResponse = JSON.parse(cleanedJson);
    return parsed.cards || [];
  } catch (error) {
    console.error(`[${fileName}] API 错误:`, error);
    return [];
  }
}

async function processHtmlFile(client: OpenAI, filePath: string): Promise<Card[]> {
  const fileName = path.basename(filePath);
  console.log(`📄 处理: ${fileName}`);

  const availableImages = await loadAvailableImages(fileName);
  if (availableImages.length > 0) {
    console.log(`  🖼️ 可用图像: ${availableImages.length} 张`);
  }

  const html = await fs.readFile(filePath, "utf-8");
  const text = extractTextFromHtml(html);
  console.log(`  📝 提取文本: ${text.length} 字符`);

  if (text.length < 100) {
    console.log(`  ⚠️ 内容过少，跳过`);
    return [];
  }

  const chunks = chunkText(text, MAX_CHARS);
  console.log(`  📦 分成 ${chunks.length} 块处理`);

  const allCards: Card[] = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`  🔄 处理第 ${i + 1}/${chunks.length} 块...`);
    const cards = await extractCardsFromText(client, chunks[i], `${fileName} (part ${i + 1})`, availableImages);
    console.log(`  ✅ 提取到 ${cards.length} 张卡片`);
    allCards.push(...cards);
    if (i < chunks.length - 1) await sleep(1000);
  }
  return allCards;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixLatex(latex: string): string {
  if (!latex || latex.trim() === "") return "";
  let fixed = latex;
  fixed = fixed.replace(/\\text\{([^}]+)\}/g, "$1");
  fixed = fixed.replace(/\\frac\{([^}]+)\}\{1\}/g, "$1");
  fixed = fixed.replace(/√/g, "\\sqrt");
  fixed = fixed.replace(/²/g, "^2");
  fixed = fixed.replace(/³/g, "^3");
  fixed = fixed.replace(/π/g, "\\pi");
  fixed = fixed.replace(/α/g, "\\alpha");
  fixed = fixed.replace(/ω/g, "\\omega");
  fixed = fixed.replace(/θ/g, "\\theta");
  return fixed;
}

function deduplicateCards(cards: Card[]): Card[] {
  const seen = new Map<string, Card>();
  for (const card of cards) {
    const key = card.term.toLowerCase().trim();
    if (!seen.has(key)) {
      if (card.latex) card.latex = fixLatex(card.latex);
      // 确保 latex 和 imageFileName 不同时有值
      if (card.latex && card.imageFileName) {
        card.imageFileName = ""; // 优先保留 latex
      }
      seen.set(key, card);
    }
  }
  return Array.from(seen.values());
}

// ============ 主函数 ============
async function main() {
  console.log("🚀 HTML → cards.raw.json 转换工具\n");
  console.log(`📋 配置: MODEL=${MODEL}, MAX_FILES=${MAX_FILES_LIMIT}\n`);

  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
  console.log(`✅ API 客户端就绪\n`);

  let htmlFiles: string[] = [];
  if (TEST_FILE) {
    const testFilePath = path.join(INPUT_DIR, TEST_FILE);
    try {
      await fs.access(testFilePath);
      htmlFiles = [testFilePath];
      console.log(`🧪 测试模式：${TEST_FILE}\n`);
    } catch {
      console.error(`❌ 找不到: ${testFilePath}`);
      process.exit(1);
    }
  } else {
    htmlFiles = await fg("**/*.html", { cwd: INPUT_DIR, absolute: true });
    if (htmlFiles.length === 0) {
      console.error(`❌ 未找到 HTML 文件`);
      process.exit(1);
    }
    console.log(`📁 找到 ${htmlFiles.length} 个 HTML 文件`);
    if (MAX_FILES_LIMIT > 0 && htmlFiles.length > MAX_FILES_LIMIT) {
      htmlFiles = htmlFiles.slice(0, MAX_FILES_LIMIT);
      console.log(`⚠️ 只处理前 ${MAX_FILES_LIMIT} 个\n`);
    }
  }

  const allCards: Card[] = [];
  for (const file of htmlFiles) {
    const cards = await processHtmlFile(client, file);
    allCards.push(...cards);
    console.log();
  }

  console.log(`📊 总共: ${allCards.length} 张卡片`);
  const uniqueCards = deduplicateCards(allCards);
  console.log(`📊 去重后: ${uniqueCards.length} 张卡片`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(uniqueCards, null, 2), "utf-8");
  console.log(`\n✅ 已保存到: ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("💥 错误:", err);
  process.exit(1);
});
