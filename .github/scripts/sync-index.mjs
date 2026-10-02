#!/usr/bin/env node
/**
 * sync-index.mjs —— 同步 index.html 里的「大小 · 日期 · 文件名」
 *
 * 规则：
 *   - 只改每个 <li> 里 .file 的文字，不动链接、不动显示名、不增删条目
 *   - 页面数量（“共 N 个页面”）跟着实际条目数走
 *   - 大小取文件字节数；日期取该文件最后一次 git 提交的日期（比本地修改时间可靠）
 *   - 有变动才写文件并返回非 0，让 workflow 决定要不要提交
 *
 * 用法：node .github/scripts/sync-index.mjs
 * 退出码 0 = 无变化，1 = 有变化（已改好 index.html），2 = 出错
 */
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX = resolve(ROOT, "index.html");

/** 字节数 → "4.5 MB" / "39.9 KB" / "41 KB"（整数不带小数） */
function fmtSize(bytes) {
  const kb = bytes / 1024;
  if (kb >= 1024) {
    const mb = kb / 1024;
    return (Number.isInteger(+mb.toFixed(1)) ? mb.toFixed(0) : mb.toFixed(1)) + " MB";
  }
  return (Number.isInteger(+kb.toFixed(1)) ? kb.toFixed(0) : kb.toFixed(1)) + " KB";
}

/** 该文件最后一次提交的日期（YYYY-MM-DD），没进过 git 就返回 null */
function gitDate(rel) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", rel], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

let html;
try {
  html = readFileSync(INDEX, "utf8");
} catch (e) {
  console.error(`✗ 读不到 index.html：${e.message}`);
  process.exit(2);
}

const missing = [];
let changed = 0;
let count = 0;

// 逐条替换 <li>…<span class="file">…</span>…</li>
const out = html.replace(
  /(<li><a\s+href="([^"]+)"[^>]*>)([\s\S]*?)(<\/a><\/li>)/g,
  (all, head, href, mid, tail) => {
    const fileSpan = /<span class="file">[^<]*<\/span>/.test(mid);
    if (!fileSpan) return all;                       // 结构不符，原样放过
    count++;

    const path = resolve(ROOT, decodeURIComponent(href));
    if (!existsSync(path)) {
      missing.push(href);
      return all;                                     // 链接指向不存在的文件，先不动
    }

    const bytes = statSync(path).size;
    const date = gitDate(decodeURIComponent(href)) || "未知";
    const want = `${fmtSize(bytes)} · ${date} · ${href}`;
    const have = mid.match(/<span class="file">([^<]*)<\/span>/)[1];

    if (have === want) return all;
    changed++;
    console.log(`  ~ ${href}\n      ${have}\n   →  ${want}`);
    return head + mid.replace(/<span class="file">[^<]*<\/span>/, `<span class="file">${want}</span>`) + tail;
  }
);

// 页面总数
const before = out.match(/共\s*(\d+)\s*个页面/);
if (before && Number(before[1]) !== count) {
  console.log(`  ~ 页面数量 ${before[1]} → ${count}`);
  changed++;
}
const finalHtml = out.replace(/共\s*\d+\s*个页面/, `共 ${count} 个页面`);

if (missing.length) {
  console.warn(`\n⚠ 以下链接指向不存在的文件，已跳过：\n  ${missing.join("\n  ")}`);
}

if (!changed) {
  console.log(`✓ index.html 已是最新（${count} 条）`);
  process.exit(0);
}

writeFileSync(INDEX, finalHtml, "utf8");
console.log(`\n✓ 已更新 index.html（${changed} 处，共 ${count} 条）`);
process.exit(1);