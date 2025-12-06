const fs = require('fs');
const path = require('path');

// 列出所有目录
const items = fs.readdirSync('.');
console.log('当前目录内容:');
items.forEach(item => {
  const stat = fs.statSync(item);
  console.log(`  ${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${item}`);
});

// 找到包含 html 的目录（排除 input_html 和 node_modules）
const srcDir = items.find(d => {
  if (!fs.statSync(d).isDirectory()) return false;
  if (d === 'input_html' || d === 'input_html2' || d === 'node_modules' || d === 'out' || d === 'scripts') return false;
  return d.endsWith('2') || d.includes('2');
});

console.log('\n找到源目录:', srcDir);

if (!srcDir) {
  process.exit(1);
}

const destDir = 'input_html2';
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir);
}

const files = fs.readdirSync(srcDir);
console.log(`复制 ${files.length} 个文件...`);

files.forEach(f => {
  const src = path.join(srcDir, f);
  const dest = path.join(destDir, f);
  fs.copyFileSync(src, dest);
  console.log(`  ${f}`);
});

console.log('\n完成！目标目录文件数:', fs.readdirSync(destDir).length);
