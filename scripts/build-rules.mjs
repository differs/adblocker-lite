#!/usr/bin/env node

/**
 * AdBlocker Lite - 规则构建工具
 *
 * 基于 uBlock Origin Lite 的构建流水线，自动拉取并转换过滤规则。
 *
 * 使用方式:
 *   node scripts/build-rules.mjs
 *
 * 选项:
 *   --ublock-dir=<path>  指定 uBlock 源码目录（省略则自动 clone）
 *   --ruleset=<id>       只构建指定规则集（如 easylist）
 *   --skip-fetch         跳过网络拉取，使用缓存
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// 配置
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const UBLOCK_REPO = 'https://github.com/gorhill/uBlock.git';
const UBLOCK_DIR = path.join(PROJECT_ROOT, '.ublock-src');
const OUTPUT_DIR = PROJECT_ROOT;

// 默认启用的 6 个核心规则集
const ENABLED_RULESETS = [
  'ublock-filters',
  'easylist',
  'easyprivacy',
  'pgl',
  'ublock-badware',
  'urlhaus-full',
];

const REGEX_RULESETS = [
  'easylist',
  'easyprivacy',
  'ublock-filters',
  'ublock-badware',
];

const URLSKIP_RULESETS = [
  'ublock-filters',
];

// ============================================================
// 工具函数
// ============================================================

function log(msg) {
  console.log(`[build-rules] ${msg}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: opts.cwd || PROJECT_ROOT,
    stdio: opts.silent ? 'pipe' : 'inherit',
    encoding: 'utf-8',
    ...opts,
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

// ============================================================
// 步骤 1: 准备 uBlock 源码
// ============================================================

async function prepareUblockSource(skipFetch) {
  if (fs.existsSync(UBLOCK_DIR) && fs.existsSync(path.join(UBLOCK_DIR, 'platform', 'mv3', 'make-rulesets.js'))) {
    log('uBlock 源码已存在，拉取最新更新...');
    if (!skipFetch) {
      try {
        run('git pull --rebase', { cwd: UBLOCK_DIR, timeout: 60000 });
      } catch (e) {
        log('警告: git pull 失败，使用现有版本');
      }
    }
  } else {
    log('正在克隆 uBlock Origin 源码...');
    ensureDir(UBLOCK_DIR);
    run(`git clone --depth 1 ${UBLOCK_REPO} ${UBLOCK_DIR}`, { timeout: 120000 });
  }
  log(`uBlock 源码位置: ${UBLOCK_DIR}`);
}

// ============================================================
// 步骤 2: 运行 make-rulesets.js
// ============================================================

async function buildRulesets(targetRuleset, skipFetch) {
  const makeScript = path.join(UBLOCK_DIR, 'platform', 'mv3', 'make-rulesets.js');

  if (!fs.existsSync(makeScript)) {
    throw new Error(`找不到 make-rulesets.js: ${makeScript}`);
  }

  // 安装依赖
  const mv3Dir = path.join(UBLOCK_DIR, 'platform', 'mv3');
  if (!fs.existsSync(path.join(mv3Dir, 'node_modules'))) {
    log('安装构建依赖...');
    run('npm install', { cwd: mv3Dir, timeout: 120000 });
  }

  // 构建参数
  const args = [
    `--output=${OUTPUT_DIR}`,
    '--platform=chromium',
  ];
  if (targetRuleset) {
    args.push(`--ruleset=${targetRuleset}`);
  }
  if (skipFetch) {
    args.push('--skip-fetch');
  }

  log('运行 make-rulesets.js 转换规则...');
  log(`  参数: ${args.join(' ')}`);

  try {
    run(`node "${makeScript}" ${args.join(' ')}`, {
      cwd: mv3Dir,
      timeout: 300000, // 5 分钟
    });
  } catch (e) {
    log(`错误: 规则转换失败: ${e.message}`);
    log('将使用已缓存的规则文件');
    return false;
  }

  return true;
}

// ============================================================
// 步骤 3: 复制生成的文件到项目目录
// ============================================================

async function copyGeneratedFiles() {
  const ubolRulesetsDir = path.join(OUTPUT_DIR, 'rulesets');

  log('复制生成的规则文件...');

  // 3a: 复制 DNR 规则（默认启用的规则集）
  for (const rs of ENABLED_RULESETS) {
    const src = path.join(ubolRulesetsDir, 'main', `${rs}.json`);
    const dest = path.join(PROJECT_ROOT, 'rulesets', 'main', `${rs}.json`);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
      log(`  ✓ rulesets/main/${rs}.json`);
    } else {
      log(`  ⚠ rulesets/main/${rs}.json 不存在（可能已被移除）`);
    }
  }

  // 3b: 复制正则规则
  for (const rs of REGEX_RULESETS) {
    const src = path.join(ubolRulesetsDir, 'regex', `${rs}.json`);
    const dest = path.join(PROJECT_ROOT, 'rulesets', 'regex', `${rs}.json`);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
      log(`  ✓ rulesets/regex/${rs}.json`);
    }
  }

  // 3c: 复制 URL 参数清理规则
  for (const rs of URLSKIP_RULESETS) {
    const src = path.join(ubolRulesetsDir, 'urlskip', `${rs}.json`);
    const dest = path.join(PROJECT_ROOT, 'rulesets', 'urlskip', `${rs}.json`);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
      log(`  ✓ rulesets/urlskip/${rs}.json`);
    }
  }

  // 3d: 复制 CSS 脚本文件（generic + specific）
  const scriptingDirs = ['generic', 'specific', 'popup'];
  for (const subdir of scriptingDirs) {
    const srcDir = path.join(ubolRulesetsDir, 'scripting', subdir);
    if (!fs.existsSync(srcDir)) continue;
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      const src = path.join(srcDir, file);
      const dest = path.join(PROJECT_ROOT, 'rulesets', 'scripting', subdir, file);
      copyFile(src, dest);
    }
    log(`  ✓ scripting/${subdir}/ (${files.length} 个文件)`);
  }

  // 3e: 复制 scriptlet 文件
  for (const subdir of ['main', 'isolated']) {
    const srcDir = path.join(ubolRulesetsDir, 'scripting', 'scriptlet', subdir);
    if (!fs.existsSync(srcDir)) continue;
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      const src = path.join(srcDir, file);
      const dest = path.join(PROJECT_ROOT, 'rulesets', 'scripting', 'scriptlet', subdir, file);
      copyFile(src, dest);
    }
    log(`  ✓ scripting/scriptlet/${subdir}/ (${files.length} 个文件)`);
  }

  // 3f: 复制元数据文件
  for (const meta of ['generic-details.json', 'ruleset-details.json', 'scriptlet-details.json']) {
    const src = path.join(ubolRulesetsDir, meta);
    const dest = path.join(PROJECT_ROOT, 'rulesets', meta);
    if (fs.existsSync(src)) {
      copyFile(src, dest);
      log(`  ✓ ${meta}`);
    }
  }

  // 3g: 复制 web_accessible_resources
  const warDir = path.join(OUTPUT_DIR, 'web_accessible_resources');
  if (fs.existsSync(warDir)) {
    const files = fs.readdirSync(warDir);
    for (const file of files) {
      const src = path.join(warDir, file);
      const dest = path.join(PROJECT_ROOT, 'web_accessible_resources', file);
      copyFile(src, dest);
    }
    log(`  ✓ web_accessible_resources/ (${files.length} 个文件)`);
  }
}

// ============================================================
// 步骤 4: 清理临时文件
// ============================================================

async function cleanup() {
  // 删除 uBlock 构建产出的临时规则文件（不在我们项目内的）
  const ubolRulesetsDir = path.join(OUTPUT_DIR, 'rulesets');
  for (const rs of ENABLED_RULESETS) {
    // 只保留我们需要的规则集
  }
  log('清理完成');
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  log('========================================');
  log('AdBlocker Lite 规则构建工具 v1.0');
  log('========================================\n');

  // 解析参数
  const args = process.argv.slice(2);
  const targetRuleset = args.find(a => a.startsWith('--ruleset='))?.split('=')[1];
  const skipFetch = args.includes('--skip-fetch');

  try {
    await prepareUblockSource(skipFetch);
    const success = await buildRulesets(targetRuleset, skipFetch);
    if (success) {
      await copyGeneratedFiles();
    }
    await cleanup();

    log('\n========================================');
    log('构建完成！');
    log('========================================\n');

    // 显示统计
    const rulesetDir = path.join(PROJECT_ROOT, 'rulesets', 'main');
    let totalRules = 0;
    for (const rs of ENABLED_RULESETS) {
      const file = path.join(rulesetDir, `${rs}.json`);
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf-8');
        const count = JSON.parse(content).length;
        totalRules += count;
        log(`  ${rs}: ${count} 条 DNR 规则`);
      }
    }
    log(`\n  总计: ${totalRules} 条 DNR 规则（6 个规则集）`);
    log(`  配额使用: ${((totalRules / 30000) * 100).toFixed(1)}%（保证配额 30,000 条）\n`);

  } catch (e) {
    console.error(`\n[build-rules] 构建失败: ${e.message}`);
    process.exit(1);
  }
}

main();
