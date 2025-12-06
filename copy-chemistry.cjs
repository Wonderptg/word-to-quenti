const fs = require('fs');
const path = require('path');

// 找到化学目录
const items = fs.readdirSync('.');
const srcDir = items.find(d => {
  if (!fs.statSync(d).isDirectory()) return false;
  return d.includes('化学') || d === 'chemistry';
});

console.log('源目录:', srcDir);

if (!srcDir) {
  console.log('未找到化学目录');
  process.exit(1);
}

// 创建两个目标目录
const dest1 = 'chem_1_37';
const dest2 = 'chem_38_64';

// 清空并重建目录
if (fs.existsSync(dest1)) fs.rmSync(dest1, { recursive: true });
if (fs.existsSync(dest2)) fs.rmSync(dest2, { recursive: true });
fs.mkdirSync(dest1);
fs.mkdirSync(dest2);

// 读取所有文件
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.html'));
console.log(`共 ${files.length} 个 HTML 文件`);

// 分类文件
let count1 = 0, count2 = 0;

files.forEach(f => {
  // 提取文件名开头的数字
  const match = f.match(/^(\d+)\./);
  if (!match) {
    console.log(`  跳过: ${f} (无法识别编号)`);
    return;
  }
  
  const num = parseInt(match[1], 10);
  const src = path.join(srcDir, f);
  
  if (num >= 1 && num <= 37) {
    fs.copyFileSync(src, path.join(dest1, f));
    count1++;
  } else if (num >= 38 && num <= 64) {
    fs.copyFileSync(src, path.join(dest2, f));
    count2++;
  } else {
    console.log(`  跳过: ${f} (编号 ${num} 不在范围内)`);
  }
});

console.log(`\n完成！`);
console.log(`  ${dest1}: ${count1} 个文件 → cmiu6aug001tg3oodswzgrzr0`);
console.log(`  ${dest2}: ${count2} 个文件 → cmiu4pakg01bf3oodqe8jyizg`);
