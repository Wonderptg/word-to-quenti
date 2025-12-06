/**
 * render-latex-to-png.ts
 * 处理卡片的图像：LaTeX 公式渲染 + HTML 图像复制
 *
 * 使用方法:
 *   npm run step2:render
 */

import { chromium, Browser, Page } from "playwright";
import * as fs from "fs/promises";
import * as path from "path";

// ============ 配置 ============
const INPUT_FILE = process.env.INPUT_FILE || "out/cards.raw.json";
const OUTPUT_FILE = process.env.OUTPUT_FILE || "out/cards.json";
const FORMULAS_DIR = process.env.FORMULAS_DIR || "out/formulas";
const HTML_IMAGES_DIR = process.env.HTML_IMAGES_DIR || "out/html_images";
const SCALE = parseInt(process.env.SCALE || "2", 10);

// ============ 类型定义 ============
interface Card {
  term: string;
  definitionHtml: string;
  latex: string;
  imageFileName?: string; // HTML 中的图像文件名
  pngPath?: string;
}

// ============ KaTeX HTML 模板 ============
const KATEX_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: white;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 20px 24px;
      font-size: 28px;
    }
    #formula { color: #1a1a1a; line-height: 1.5; }
    .katex { font-size: 1.2em; }
  </style>
</head>
<body>
  <div id="formula"></div>
  <script>
    function renderFormula(latex) {
      try {
        katex.render(latex, document.getElementById('formula'), {
          throwOnError: false,
          displayMode: true,
          output: 'html'
        });
        return true;
      } catch (e) {
        document.getElementById('formula').textContent = 'Error: ' + e.message;
        return false;
      }
    }
  </script>
</body>
</html>`;

// ============ 工具函数 ============

async function initBrowser(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    deviceScaleFactor: SCALE,
    viewport: { width: 1200, height: 800 },
  });
  await page.setContent(KATEX_HTML_TEMPLATE);
  await page.waitForFunction(() => typeof (window as any).katex !== "undefined");
  return { browser, page };
}

async function renderLatexToPng(page: Page, latex: string, outputPath: string): Promise<boolean> {
  try {
    // 清理 LaTeX（处理转义）
    const cleanedLatex = latex.replace(/\\\\/g, "\\");

    const success = await page.evaluate((tex: string) => {
      return (window as any).renderFormula(tex);
    }, cleanedLatex);

    if (!success) {
      console.error(`  ⚠️ LaTeX 渲染失败`);
      return false;
    }

    await page.waitForTimeout(100);

    const formulaElement = await page.$("#formula");
    if (!formulaElement) return false;

    await formulaElement.screenshot({
      path: outputPath,
      type: "png",
      omitBackground: false,
    });

    return true;
  } catch (error) {
    console.error(`  ⚠️ 截图错误:`, error);
    return false;
  }
}

function generateFileName(index: number): string {
  return `${String(index).padStart(4, "0")}.png`;
}

// ============ 主函数 ============
async function main() {
  console.log("🎨 图像处理工具（LaTeX 渲染 + HTML 图像）\n");

  // 读取输入文件
  let cards: Card[];
  try {
    const content = await fs.readFile(INPUT_FILE, "utf-8");
    cards = JSON.parse(content);
    console.log(`📖 读取到 ${cards.length} 张卡片`);
  } catch (error) {
    console.error(`❌ 无法读取 ${INPUT_FILE}:`, error);
    process.exit(1);
  }

  // 确保输出目录存在
  await fs.mkdir(FORMULAS_DIR, { recursive: true });

  // 分类卡片
  const cardsWithLatex = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => card.latex && card.latex.trim() !== "");

  const cardsWithHtmlImage = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => card.imageFileName && card.imageFileName.trim() !== "");

  console.log(`🔢 需要渲染 LaTeX 公式: ${cardsWithLatex.length} 张`);
  console.log(`🖼️ 需要 HTML 图像: ${cardsWithHtmlImage.length} 张\n`);

  let successCount = 0;
  let failCount = 0;

  // 处理 HTML 图像
  if (cardsWithHtmlImage.length > 0) {
    console.log("==================================================");
    console.log(`🖼️ 处理 HTML 图像 (${cardsWithHtmlImage.length} 张)`);
    console.log("==================================================\n");

    for (const { card, index } of cardsWithHtmlImage) {
      const sourcePath = path.join(HTML_IMAGES_DIR, card.imageFileName!);
      const destFileName = `${String(index).padStart(4, "0")}_html.png`;
      const destPath = path.join(FORMULAS_DIR, destFileName);

      console.log(`[${index + 1}] ${card.term}`);
      console.log(`   图像: ${card.imageFileName}`);

      try {
        await fs.copyFile(sourcePath, destPath);
        card.pngPath = destPath;
        successCount++;
        console.log(`   ✅ 已复制: ${destFileName}`);
      } catch (err) {
        failCount++;
        console.log(`   ❌ 复制失败: ${err}`);
      }
    }
    console.log();
  }

  // 处理 LaTeX 公式
  if (cardsWithLatex.length > 0) {
    console.log("==================================================");
    console.log(`📐 渲染 LaTeX 公式 (${cardsWithLatex.length} 张)`);
    console.log("==================================================\n");

    console.log("🚀 启动浏览器...");
    const { browser, page } = await initBrowser();
    console.log("✅ 浏览器就绪\n");

    for (const { card, index } of cardsWithLatex) {
      const fileName = `${String(index).padStart(4, "0")}_latex.png`;
      const outputPath = path.join(FORMULAS_DIR, fileName);

      console.log(`[${index + 1}] ${card.term}`);
      console.log(`   LaTeX: ${card.latex.substring(0, 50)}...`);

      const success = await renderLatexToPng(page, card.latex, outputPath);

      if (success) {
        card.pngPath = outputPath;
        successCount++;
        console.log(`   ✅ 已保存: ${fileName}`);
      } else {
        failCount++;
        console.log(`   ❌ 渲染失败`);
      }
    }

    await browser.close();
  }

  console.log(`\n📊 处理统计:`);
  console.log(`   ✅ 成功: ${successCount}`);
  console.log(`   ❌ 失败: ${failCount}`);

  await fs.writeFile(OUTPUT_FILE, JSON.stringify(cards, null, 2), "utf-8");
  console.log(`\n✅ 已保存到: ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("💥 发生错误:", err);
  process.exit(1);
});

