/**
 * bulk-term-image-upload.ts
 * 批量导入卡片到 Quenti（词卡星球）+ 自动上传图片
 *
 * 完整流程:
 *   Step 1: terms.add 创建卡片 → 获取 termId
 *   Step 2: terms.uploadImage 获取 JWT → PUT CDN Worker → terms.uploadImageComplete
 *
 * 使用方法:
 *   $env:APP_URL="http://cika.dzexam.cn"
 *   $env:CDN_ENDPOINT="https://你的cdn-worker地址"
 *   $env:SESSION_COOKIE="next-auth.session-token=xxx"
 *   $env:STUDY_SET_ID="cmisp1rfq00k13oo2djrv5q4c"
 *   npm run step3:upload
 */

import * as fs from "fs/promises";

// ============ 配置 ============
const APP_URL = process.env.APP_URL || "";
const CDN_ENDPOINT = process.env.CDN_ENDPOINT || "";
const SESSION_COOKIE = process.env.SESSION_COOKIE || "";
const STUDY_SET_ID = process.env.STUDY_SET_ID || "";
const CARDS_PATH = process.env.CARDS_PATH || "out/cards.json";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "2", 10);
const RETRY_TIMES = parseInt(process.env.RETRY_TIMES || "3", 10);

// ============ 类型定义 ============
interface Card {
  term: string;
  definitionHtml: string;
  latex: string;
  pngPath?: string;
}

interface CreatedTerm {
  card: Card;
  termId: string;
  index: number;
}

// ============ 工具函数 ============

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试的 fetch
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number = RETRY_TIMES
): Promise<Response> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error as Error;
    }

    if (i < retries - 1) {
      const delay = Math.pow(2, i) * 1000;
      console.log(`  ⏳ 重试 ${i + 1}/${retries}，等待 ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError;
}

// ============ Step 1: 添加术语 ============

/**
 * 添加单个术语，返回 termId
 */
async function addTerm(
  card: Card,
  rank: number
): Promise<{ success: boolean; termId?: string; error?: string }> {
  const url = `${APP_URL}/api/trpc/terms.add?batch=1`;

  const payload = {
    "0": {
      json: {
        studySetId: STUDY_SET_ID,
        term: {
          word: card.term,
          definition: card.definitionHtml,
          wordRichText: null,
          definitionRichText: null,
          rank: rank,
        },
      },
      meta: {
        values: {
          "term.wordRichText": ["undefined"],
          "term.definitionRichText": ["undefined"],
        },
      },
    },
  };

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: SESSION_COOKIE,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    const data = await response.json();

    // 调试输出
    // console.log("API Response:", JSON.stringify(data).slice(0, 500));

    // 解析返回的 term ID - 尝试多种格式
    let termId: string | undefined;

    // 格式1: [{ "result": { "data": { "json": { "created": { "id": "xxx" } } } } }]
    if (Array.isArray(data) && data[0]?.result?.data?.json?.created?.id) {
      termId = data[0].result.data.json.created.id;
    }
    // 格式1b: [{ "result": { "data": { "json": { "id": "xxx" } } } }]
    else if (Array.isArray(data) && data[0]?.result?.data?.json?.id) {
      termId = data[0].result.data.json.id;
    }
    // 格式2: [{ "result": { "data": { "id": "xxx" } } }]
    else if (Array.isArray(data) && data[0]?.result?.data?.id) {
      termId = data[0].result.data.id;
    }
    // 格式3: { "result": { "data": { "json": { "id": "xxx" } } } }
    else if (data?.result?.data?.json?.id) {
      termId = data.result.data.json.id;
    }
    // 格式4: { "result": { "data": { "id": "xxx" } } }
    else if (data?.result?.data?.id) {
      termId = data.result.data.id;
    }
    // 格式5: 直接就是 term 对象
    else if (data?.id) {
      termId = data.id;
    }
    // 格式6: [{ "result": { "data": "termId" } }] (有些 tRPC 直接返回 ID)
    else if (Array.isArray(data) && typeof data[0]?.result?.data === 'string') {
      termId = data[0].result.data;
    }

    if (termId) {
      return { success: true, termId };
    }

    // 如果获取不到 termId 但请求成功，也算成功（只是无法上传图片）
    console.log("  ⚠️ API 返回格式:", JSON.stringify(data).slice(0, 200));
    return { success: true, termId: undefined };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============ Step 2: 图片上传 ============

/**
 * 获取上传 JWT
 */
async function getUploadJwt(termId: string): Promise<string | null> {
  const url = `${APP_URL}/api/trpc/terms.uploadImage?batch=1`;

  const payload = {
    "0": {
      json: {
        studySetId: STUDY_SET_ID,
        termId: termId,
      },
    },
  };

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: SESSION_COOKIE,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`  ❌ 获取 JWT 失败: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();

    // 解析 JWT - 尝试多种格式
    let jwt: string | undefined;

    // 格式1: [{ "result": { "data": { "json": "jwt_string" } } }] (JWT 直接是字符串)
    if (Array.isArray(data) && typeof data[0]?.result?.data?.json === 'string') {
      jwt = data[0].result.data.json;
    }
    // 格式2: [{ "result": { "data": { "json": { "jwt": "xxx" } } } }]
    else if (Array.isArray(data) && data[0]?.result?.data?.json?.jwt) {
      jwt = data[0].result.data.json.jwt;
    }
    // 格式3: [{ "result": { "data": "jwt_string" } }]
    else if (Array.isArray(data) && typeof data[0]?.result?.data === 'string') {
      jwt = data[0].result.data;
    }

    if (jwt) {
      return jwt;
    }

    console.error(`  ❌ JWT 解析失败:`, JSON.stringify(data).slice(0, 200));
    return null;
  } catch (error) {
    console.error(`  ❌ 获取 JWT 错误:`, error);
    return null;
  }
}

/**
 * PUT 上传图片到 CDN Worker
 */
async function uploadToCdn(jwt: string, pngPath: string): Promise<boolean> {
  try {
    const imageBuffer = await fs.readFile(pngPath);

    const url = `${CDN_ENDPOINT}/terms`;

    const response = await fetchWithRetry(url, {
      method: "PUT",
      headers: {
        "Content-Type": "image/png",
        Authorization: `Bearer ${jwt}`,
      },
      body: imageBuffer,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`  ❌ CDN 上传失败: HTTP ${response.status} - ${text}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`  ❌ CDN 上传错误:`, error);
    return false;
  }
}

/**
 * 完成上传，写回 assetUrl
 */
async function completeUpload(termId: string): Promise<string | null> {
  const url = `${APP_URL}/api/trpc/terms.uploadImageComplete?batch=1`;

  const payload = {
    "0": {
      json: {
        studySetId: STUDY_SET_ID,
        termId: termId,
      },
    },
  };

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: SESSION_COOKIE,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`  ❌ 完成上传失败: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();

    // 解析返回的 URL
    if (Array.isArray(data) && data[0]?.result?.data?.json?.url) {
      return data[0].result.data.json.url;
    }
    if (data[0]?.result?.data?.url) {
      return data[0].result.data.url;
    }

    return "已完成";
  } catch (error) {
    console.error(`  ❌ 完成上传错误:`, error);
    return null;
  }
}

/**
 * 上传单个图片的完整流程
 */
async function uploadImage(
  termId: string,
  pngPath: string
): Promise<{ success: boolean; url?: string }> {
  // Step 2.1: 获取 JWT
  const jwt = await getUploadJwt(termId);
  if (!jwt) {
    return { success: false };
  }

  // Step 2.2: PUT 到 CDN
  const uploaded = await uploadToCdn(jwt, pngPath);
  if (!uploaded) {
    return { success: false };
  }

  // Step 2.3: 完成上传
  const url = await completeUpload(termId);
  if (!url) {
    return { success: false };
  }

  return { success: true, url };
}

// ============ 并发控制 ============

async function processSequentially<T>(
  items: T[],
  processor: (item: T, index: number) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await processor(items[i], i);
  }
}

// ============ 主函数 ============
async function main() {
  console.log("🚀 Quenti（词卡星球）批量导入工具\n");

  // 检查环境变量
  const missingEnvs: string[] = [];
  if (!APP_URL) missingEnvs.push("APP_URL");
  if (!SESSION_COOKIE) missingEnvs.push("SESSION_COOKIE");
  if (!STUDY_SET_ID) missingEnvs.push("STUDY_SET_ID");

  if (missingEnvs.length > 0) {
    console.error(`❌ 缺少环境变量: ${missingEnvs.join(", ")}`);
    console.error(`\n请设置以下环境变量:`);
    console.error(`  $env:APP_URL="http://cika.dzexam.cn"`);
    console.error(`  $env:SESSION_COOKIE="next-auth.session-token=..."`);
    console.error(`  $env:STUDY_SET_ID="cmisp1rfq00k13oo2djrv5q4c"`);
    process.exit(1);
  }

  console.log(`📋 配置信息:`);
  console.log(`   APP_URL: ${APP_URL}`);
  console.log(`   CDN_ENDPOINT: ${CDN_ENDPOINT || "(未配置，跳过图片上传)"}`);
  console.log(`   STUDY_SET_ID: ${STUDY_SET_ID}`);
  console.log(`   CARDS_PATH: ${CARDS_PATH}`);

  // 读取卡片数据
  let cards: Card[];
  try {
    const content = await fs.readFile(CARDS_PATH, "utf-8");
    cards = JSON.parse(content);
    console.log(`\n📖 读取到 ${cards.length} 张卡片`);
  } catch (error) {
    console.error(`❌ 无法读取 ${CARDS_PATH}:`, error);
    process.exit(1);
  }

  // ========== Step 1: 创建术语 ==========
  console.log(`\n${"=".repeat(50)}`);
  console.log(`📤 Step 1: 创建术语`);
  console.log(`${"=".repeat(50)}\n`);

  const createdTerms: CreatedTerm[] = [];
  let step1Success = 0;
  let step1Fail = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    console.log(`[${i + 1}/${cards.length}] 添加: ${card.term}`);

    const result = await addTerm(card, i);

    if (result.success && result.termId) {
      step1Success++;
      createdTerms.push({ card, termId: result.termId, index: i });
      console.log(`   ✅ 成功 (termId: ${result.termId})`);
    } else {
      step1Fail++;
      console.log(`   ❌ 失败: ${result.error}`);
    }

    await sleep(300);
  }

  console.log(`\n📊 Step 1 统计: ✅ ${step1Success} / ❌ ${step1Fail}`);

  // ========== Step 2: 上传图片 ==========
  const termsWithImages = createdTerms.filter((t) => t.card.pngPath);

  if (termsWithImages.length === 0) {
    console.log(`\n✅ 没有需要上传的图片，完成！`);
  } else if (!CDN_ENDPOINT) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`⚠️ Step 2: 图片上传（跳过）`);
    console.log(`${"=".repeat(50)}`);
    console.log(`\n有 ${termsWithImages.length} 张卡片包含图片，但未配置 CDN_ENDPOINT`);
    console.log(`请设置 CDN_ENDPOINT 环境变量后重新运行，或手动上传图片`);
    console.log(`图片位置: out/formulas/`);
  } else {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🖼️ Step 2: 上传图片 (${termsWithImages.length} 张)`);
    console.log(`${"=".repeat(50)}\n`);

    let step2Success = 0;
    let step2Fail = 0;

    for (const term of termsWithImages) {
      console.log(`[${term.index + 1}] 上传图片: ${term.card.term}`);

      // 检查文件是否存在
      try {
        await fs.access(term.card.pngPath!);
      } catch {
        console.log(`   ❌ 文件不存在: ${term.card.pngPath}`);
        step2Fail++;
        continue;
      }

      const result = await uploadImage(term.termId, term.card.pngPath!);

      if (result.success) {
        step2Success++;
        console.log(`   ✅ 成功${result.url ? `: ${result.url}` : ""}`);
      } else {
        step2Fail++;
        console.log(`   ❌ 失败`);
      }

      await sleep(500);
    }

    console.log(`\n📊 Step 2 统计: ✅ ${step2Success} / ❌ ${step2Fail}`);
  }

  // ========== 完成 ==========
  console.log(`\n${"=".repeat(50)}`);
  console.log(`🎉 导入完成！`);
  console.log(`${"=".repeat(50)}`);
  console.log(`\n   学习集地址: ${APP_URL}/${STUDY_SET_ID}`);
}

main().catch((err) => {
  console.error("💥 发生错误:", err);
  process.exit(1);
});
