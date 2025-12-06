const fs = require('fs');
const path = require('path');

// 找到包含中文的目录
const dirs = fs.readdirSync('.').filter(f => fs.statSync(f).isDirectory());
const srcDir = dirs.find(d => d.includes('html-2') || d.includes('html2'));

if (!srcDir) {
  console.log('目录列表:', dirs);
  // 尝试直接用 Buffer
  const items = fs.readdirSync('.', { encoding: 'buffer' });
  items.forEach(item => {
    const name = item.toString('utf8');
    console.log('  -', name);
  });
  process.exit(1);
}

const destDir = 'input_html2';
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir);
}

const files = fs.readdirSync(srcDir);
console.log(`从 ${srcDir} 复制 ${files.length} 个文件到 ${destDir}`);

files.forEach(f => {
  fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
});

console.log('完成！');
console.log('文件列表:', fs.readdirSync(destDir));



