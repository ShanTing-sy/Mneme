import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!existsSync('tests')) {
  console.log('tests/ 尚未创建，跳过。');
  process.exit(0);
}

const files = readdirSync('tests')
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => `tests/${name}`);

if (files.length === 0) {
  console.log('没有找到测试文件。');
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
