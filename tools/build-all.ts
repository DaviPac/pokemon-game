/**
 * Roda o pipeline de assets inteiro, na ordem certa.
 * Os sprites de overworld dependem dos mapas ja convertidos.
 */
import { spawnSync } from 'node:child_process';

const steps = ['tools/build-world.ts', 'tools/build-dex.ts', 'tools/build-overworld.ts'];

for (const step of steps) {
  console.log(`\n=== ${step} ===`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', step], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`falhou: ${step}`);
    process.exit(result.status ?? 1);
  }
}
console.log('\nassets prontos em public/assets');
