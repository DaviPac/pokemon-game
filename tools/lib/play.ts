/**
 * Passos comuns dos testes de tela: comecar um jogo novo, teleportar e andar
 * na grama ate aparecer um Pokemon.
 */
import type { Page } from 'playwright';
import './hooks.js';

export async function teleport(
  page: Page,
  map: string,
  x: number,
  y: number,
  dir: 'up' | 'down' | 'left' | 'right' = 'down',
): Promise<void> {
  await page.evaluate(
    ({ map, x, y, dir }) => window.__overworld?.swapTo(map, x, y, dir),
    { map, x, y, dir },
  );
}

export async function walkUntilBattle(page: Page, attempts: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    for (const key of ['ArrowUp', 'ArrowDown']) {
      await page.keyboard.down(key);
      await page.waitForTimeout(900);
      await page.keyboard.up(key);
      await page.waitForTimeout(120);
      if (await page.locator('.battle').count()) return true;
    }
  }
  return false;
}

export async function startNewGame(page: Page): Promise<void> {
  await page.locator('.title-action').first().click();
  await page.waitForTimeout(900);
  for (let i = 0; i < 6; i++) {
    await page.locator('.intro-scene').click().catch(() => undefined);
    await page.waitForTimeout(340);
  }
  await page.fill('#trainer-name', 'Davi');
  await page.locator('.primary-button').click();
  await page.waitForTimeout(600);
  await page.locator('.starter-card').nth(1).click();
  await page.locator('.primary-button').click();
  await page.waitForTimeout(700);
  for (let i = 0; i < 4; i++) {
    await page.locator('.intro-scene').click().catch(() => undefined);
    await page.waitForTimeout(520);
  }
}
