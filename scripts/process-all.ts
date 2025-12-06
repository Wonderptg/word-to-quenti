/**
 * process-all.ts
 * 逐个处理所有 HTML 文件，每个文件完成全流程后再处理下一个
 */

import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

// 可配置的输入目录
const INPUT_DIR = process.env.INPUT_DIR || "input_html";
const STUDY_SET_ID = process.env.STUDY_SET_ID || "cmisp1rfq00k13oo2djrv5q4c";
const APP_URL = process.env.APP_URL || "http://cika.dzexam.cn";
const CDN_ENDPOINT = process.env.CDN_ENDPOINT || "https://quenti-cdn.18724508792.workers.dev";
const SESSION_COOKIE = process.env.SESSION_COOKIE || "next-auth.session-token=cd60bf80-1110-4bf1-ada8-a8a3794631a8";

// 从命令行参数获取起始位置
const START_INDEX = parseInt(process.env.START_INDEX || "0", 10);

// 日志文件
const LOG_FILE = `out/batch-log-${new Date().toISOString().slice(0,10)}.txt`;

async function log(message: string) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  await fs.appendFile(LOG_FILE, line + "\n", "utf-8").catch(() => {});
}

async function runCommand(cmd: string, env: Record<string, string> = {}): Promise<boolean> {
  try {
    execSync(cmd, {
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: "powershell.exe",
    });
    return true;
  } catch (error) {
    console.error(`❌ 命令执行失败`);
    return false;
  }
}

interface FileResult {
  fileName: string;
  success: boolean;
  cardsCount: number;
  imagesCount: number;
  error?: string;
}

async function processFile(fileName: string, index: number, total: number): Promise<FileResult> {
  const result: FileResult = { fileName, success: false, cardsCount: 0, imagesCount: 0 };
  
  await log("=".repeat(60));
  await log(`📄 [${index + 1}/${total}] 处理: ${fileName}`);
  await log("=".repeat(60));

  // Step 0: 提取图像
  await log("🖼️ Step 0: 提取 HTML 图像...");
  const step0 = await runCommand(`npx tsx scripts/extract-html-images.ts`, {
    TEST_FILE: fileName,
    INPUT_HTML_DIR: INPUT_DIR,
  });
  if (!step0) {
    await log("⚠️ 图像提取失败，继续处理（可能没有图像）");
  }

  // Step 1: AI 提取卡片
  await log("🤖 Step 1: AI 提取卡片...");
  const step1 = await runCommand(`npx tsx scripts/html-to-cards-gemini.ts`, {
    TEST_FILE: fileName,
    INPUT_DIR: INPUT_DIR,
  });
  if (!step1) {
    result.error = "AI 提取失败";
    await log(`❌ ${result.error}，跳过此文件`);
    return result;
  }

  // 读取卡片数量
  try {
    const cardsContent = await fs.readFile("out/cards.raw.json", "utf-8");
    const cards = JSON.parse(cardsContent);
    result.cardsCount = cards.length;
    await log(`   📊 提取了 ${result.cardsCount} 张卡片`);
  } catch {}

  // Step 2: 渲染图像
  await log("🎨 Step 2: 渲染图像...");
  const step2 = await runCommand(`npx tsx scripts/render-latex-to-png.ts`);
  if (!step2) {
    result.error = "图像渲染失败";
    await log(`❌ ${result.error}，跳过此文件`);
    return result;
  }

  // Step 3: 上传到 Quenti
  await log("📤 Step 3: 上传到 Quenti...");
  const step3 = await runCommand(`npx tsx scripts/bulk-term-image-upload.ts`, {
    APP_URL,
    CDN_ENDPOINT,
    SESSION_COOKIE,
    STUDY_SET_ID,
  });
  if (!step3) {
    result.error = "上传失败";
    await log(`❌ ${result.error}`);
    return result;
  }

  result.success = true;
  await log(`✅ ${fileName} 处理完成！卡片: ${result.cardsCount} 张`);
  return result;
}

async function main() {
  // 确保 out 目录存在
  await fs.mkdir("out", { recursive: true });
  
  await log("🚀 批量处理工具（逐文件处理）");
  await log(`📂 输入目录: ${INPUT_DIR}`);
  await log(`🔗 目标学习集: ${APP_URL}/${STUDY_SET_ID}`);

  // 获取所有 HTML 文件
  const files = await fs.readdir(INPUT_DIR);
  const htmlFiles = files
    .filter(f => f.endsWith(".html"))
    .sort((a, b) => {
      // 按数字排序
      const numA = parseFloat(a.replace(".html", ""));
      const numB = parseFloat(b.replace(".html", ""));
      return numA - numB;
    });

  await log(`📁 找到 ${htmlFiles.length} 个 HTML 文件`);
  
  if (START_INDEX > 0) {
    await log(`⏭️ 从第 ${START_INDEX + 1} 个文件开始`);
  }

  const results: FileResult[] = [];
  let totalCards = 0;

  for (let i = START_INDEX; i < htmlFiles.length; i++) {
    const fileName = htmlFiles[i];
    const result = await processFile(fileName, i, htmlFiles.length);
    results.push(result);
    totalCards += result.cardsCount;

    // 每个文件之间等待 2 秒，避免 API 限流
    if (i < htmlFiles.length - 1) {
      await log("⏳ 等待 2 秒后处理下一个文件...");
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  const failedFiles = results.filter(r => !r.success);

  await log("");
  await log("=".repeat(60));
  await log("📊 批量处理完成！");
  await log("=".repeat(60));
  await log(`✅ 成功: ${successCount} 个文件`);
  await log(`❌ 失败: ${failCount} 个文件`);
  await log(`📝 总卡片数: ${totalCards} 张`);
  
  if (failedFiles.length > 0) {
    await log("\n失败的文件:");
    for (const f of failedFiles) {
      await log(`  - ${f.fileName}: ${f.error}`);
    }
  }

  await log(`\n🔗 学习集地址: ${APP_URL}/${STUDY_SET_ID}`);

  // 保存详细统计信息
  const stats = {
    timestamp: new Date().toISOString(),
    inputDir: INPUT_DIR,
    studySetId: STUDY_SET_ID,
    studySetUrl: `${APP_URL}/${STUDY_SET_ID}`,
    totalFiles: htmlFiles.length,
    successCount,
    failCount,
    totalCards,
    results: results.map(r => ({
      file: r.fileName,
      success: r.success,
      cards: r.cardsCount,
      error: r.error || null,
    })),
  };
  
  const statsFile = `out/batch-stats-${STUDY_SET_ID}.json`;
  await fs.writeFile(statsFile, JSON.stringify(stats, null, 2), "utf-8");
  await log(`📋 统计已保存到: ${statsFile}`);
  await log(`📋 日志已保存到: ${LOG_FILE}`);
}

main().catch(err => {
  console.error("💥 错误:", err);
  process.exit(1);
});

