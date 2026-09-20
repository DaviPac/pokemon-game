/**
 * Roda o pipeline de assets inteiro, na ordem certa: os sprites de overworld e
 * os eventos dependem dos mapas ja convertidos.
 */
import { spawnSync } from 'node:child_process';

const steps = [
  'tools/build-world.ts',
  'tools/build-dex.ts',
  'tools/build-overworld.ts',
  // Depende dos mapas ja convertidos e do species.json.
  'tools/build-events.ts',
];

for (const step of steps) {
  console.log(`\n=== ${step} ===`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', step], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`falhou: ${step}`);
    process.exit(result.status ?? 1);
  }
}
console.log('\nassets prontos em public/assets');
