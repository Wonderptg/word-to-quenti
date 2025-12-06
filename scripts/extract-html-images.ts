/**
 * extract-html-images.ts
 * 从 HTML 课件中提取所有 Canvas/SVG 图像
 * 
 * 先运行此脚本截取图像，再运行 AI 提取卡片
 *
 * 使用方法:
 *   npm run step0:images
 */

import { chromium, Browser } from "playwright";
import * as fs from "fs/promises";
import * as path from "path";

// ============ 配置 ============
const INPUT_HTML_DIR = process.env.INPUT_HTML_DIR || "input_html";
const IMAGES_DIR = process.env.IMAGES_DIR || "out/html_images";
const TEST_FILE = process.env.TEST_FILE || "";
const SCALE = parseInt(process.env.SCALE || "2", 10);
const WAIT_TIME = parseInt(process.env.WAIT_TIME || "2000", 10); // 等待 JS 执行的时间

// ============ 类型定义 ============
interface ImageInfo {
  fileName: string;
  htmlFile: string;
  index: number;
  width: number;
  height: number;
  type: "canvas" | "svg";
  context?: string; // 周围的文字描述
}

// ============ 工具函数 ============

async function extractImagesFromHtml(
  browser: Browser,
  htmlPath: string,
  outputDir: string
): Promise<ImageInfo[]> {
  const htmlFileName = path.basename(htmlPath, ".html");
  const page = await browser.newPage({
    deviceScaleFactor: SCALE,
    viewport: { width: 1400, height: 900 },
  });

  const images: ImageInfo[] = [];

  try {
    // 使用 file:// 协议加载本地 HTML
    const absolutePath = path.resolve(htmlPath);
    await page.goto(`file://${absolutePath}`, { 
      waitUntil: "networkidle",
      timeout: 30000 
    });

    // 等待 JavaScript 执行完成（Canvas 渲染）
    console.log(`  ⏳ 等待 ${WAIT_TIME}ms 让 JavaScript 渲染...`);
    await page.waitForTimeout(WAIT_TIME);

    // 获取所有 Canvas 和 SVG 元素
    const elements = await page.$$("canvas.graph-canvas, svg");
    console.log(`  📊 找到 ${elements.length} 个图像元素`);

    if (elements.length === 0) {
      await page.close();
      return images;
    }

    // 逐个截取
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      
      try {
        // 检查元素是否可见且有大小
        const box = await element.boundingBox();
        if (!box || box.width < 50 || box.height < 50) {
          console.log(`  ⏭️ 跳过元素 ${i + 1}：太小或不可见`);
          continue;
        }

        // 获取元素类型
        const tagName = await element.evaluate(el => el.tagName.toLowerCase());
        const type = tagName === "canvas" ? "canvas" : "svg";

        // 获取周围的文字描述
        const context = await element.evaluate((el) => {
          const parent = el.closest(".section") || el.parentElement?.parentElement;
          if (!parent) return "";
          
          // 获取标题
          const heading = parent.querySelector("h1, h2, h3");
          const headingText = heading?.textContent?.trim() || "";
          
          // 获取描述文字
          const paragraphs = parent.querySelectorAll("p");
          let description = "";
          paragraphs.forEach(p => {
            const text = p.textContent?.trim() || "";
            if (text.length > 10 && text.length < 200) {
              description += text + " ";
            }
          });
          
          return (headingText + " " + description).trim().substring(0, 200);
        });

        // 生成文件名
        const fileName = `${htmlFileName}_${String(i).padStart(2, "0")}.png`;
        const outputPath = path.join(outputDir, fileName);

        // 截图
        await element.screenshot({
          path: outputPath,
          type: "png",
          omitBackground: false,
        });

        images.push({
          fileName,
          htmlFile: path.basename(htmlPath),
          index: i,
          width: Math.round(box.width),
          height: Math.round(box.height),
          type,
          context,
        });

        console.log(`  ✅ [${i + 1}/${elements.length}] ${fileName} (${type}, ${Math.round(box.width)}x${Math.round(box.height)})`);
      } catch (err) {
        console.log(`  ⚠️ [${i + 1}/${elements.length}] 截取失败:`, err);
      }
    }
  } catch (error) {
    console.error(`  ❌ 加载 HTML 失败:`, error);
  } finally {
    await page.close();
  }

  return images;
}

// ============ 主函数 ============
async function main() {
  console.log("🖼️ HTML 图像提取工具\n");

  // 确保输出目录存在
  await fs.mkdir(IMAGES_DIR, { recursive: true });

  // 获取 HTML 文件列表
  let htmlFiles: string[] = [];
  
  if (TEST_FILE) {
    const testPath = path.join(INPUT_HTML_DIR, TEST_FILE);
    try {
      await fs.access(testPath);
      htmlFiles = [testPath];
      console.log(`🧪 测试模式：只处理 ${TEST_FILE}\n`);
    } catch {
      console.error(`❌ 找不到文件: ${testPath}`);
      process.exit(1);
    }
  } else {
    const files = await fs.readdir(INPUT_HTML_DIR);
    htmlFiles = files
      .filter(f => f.endsWith(".html"))
      .map(f => path.join(INPUT_HTML_DIR, f));
    console.log(`📁 找到 ${htmlFiles.length} 个 HTML 文件\n`);
  }

  // 启动浏览器
  console.log("🚀 启动浏览器...");
  const browser = await chromium.launch({ headless: true });
  console.log("✅ 浏览器就绪\n");

  const allImages: ImageInfo[] = [];

  // 处理每个 HTML 文件
  for (const htmlPath of htmlFiles) {
    console.log(`📄 处理: ${path.basename(htmlPath)}`);
    const images = await extractImagesFromHtml(browser, htmlPath, IMAGES_DIR);
    allImages.push(...images);
    console.log();
  }

  await browser.close();

  // 保存图像索引
  const indexPath = path.join(IMAGES_DIR, "index.json");
  await fs.writeFile(indexPath, JSON.stringify(allImages, null, 2), "utf-8");

  console.log("==================================================");
  console.log(`📊 总共提取: ${allImages.length} 张图像`);
  console.log(`📁 图像目录: ${IMAGES_DIR}`);
  console.log(`📋 索引文件: ${indexPath}`);
  console.log("==================================================");
}

main().catch((err) => {
  console.error("💥 发生错误:", err);
  process.exit(1);
});
