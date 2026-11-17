import { chromium, type Browser } from 'playwright-core';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { browserExecutable } from './browser';

interface Card { title: string; body?: string; width: number; height: number; output: string; overlay?: boolean; compact?: boolean }
export async function renderCards(cards: Card[], executable: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (!Array.isArray(cards) || cards.length > 10) throw new Error('Invalid card count');
  for (const card of cards) {
    if (card.compact !== undefined && typeof card.compact !== 'boolean') throw new Error('Invalid compact card option');
    if (![card.width, card.height].every(value => Number.isInteger(value) && value >= 16 && value <= 3840)) throw new Error('Invalid card dimensions');
    if (typeof card.title !== 'string' || !card.title.trim() || card.title.length > 2000 || (card.body?.length ?? 0) > 8000) throw new Error('Card text too long or empty');
  }
  if (!cards.length) return;
  let browser: Browser | undefined;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const stop = (): void => { rejectAbort(signal.reason); void browser?.close(); };
  signal.addEventListener('abort', stop, { once: true });
  const launch = chromium.launch({ executablePath: browserExecutable(executable), headless: true, chromiumSandbox: true, timeout: 30000 });
  try {
    browser = await Promise.race([launch, aborted]);
    for (const card of cards) {
      signal.throwIfAborted(); await mkdir(dirname(card.output), { recursive: true });
      const page = await browser.newPage({ viewport: { width: card.width, height: card.height }, deviceScaleFactor: 1 });
      const temporary = `${card.output}.part`;
      try {
        await page.route('**/*', route => route.abort());
        await page.setContent(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Arial,sans-serif;color:white}body{background:${card.overlay ? 'transparent' : 'linear-gradient(135deg,#111628,#342d71)'};display:flex;align-items:${card.overlay ? 'flex-end' : 'center'};justify-content:center;padding:${card.compact ? '2%' : '5%'}}.frame{max-height:${card.overlay ? card.compact ? '14%' : '44%' : '90%'};width:100%;padding:${card.overlay ? card.compact ? '1%' : '3%' : '2%'};${card.overlay ? 'background:rgba(12,15,29,.90);border-left:6px solid #a5a1ff;border-radius:8px;' : 'text-align:center;'}overflow:hidden}h1{margin:0;line-height:1.15;overflow-wrap:anywhere}p{margin:${card.compact ? '.3em' : '.6em'} 0 0;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere;color:#dfe4ff}</style><div class="frame"><h1></h1><p></p></div>`);
        await page.locator('h1').evaluate((element, value) => { element.textContent = value; }, card.title);
        await page.locator('p').evaluate((element, value) => { element.textContent = value; }, card.body ?? '');
        let fits = false;
        const minimumFontSize = card.compact ? Math.min(10, Math.max(4, Math.floor(card.height / 45))) : 10;
        for (let size = Math.max(14, Math.round(card.width / 15)); size >= minimumFontSize; size--) {
          fits = await page.evaluate(({ size, minimumFontSize }) => {
            const title = document.querySelector('h1')!; const body = document.querySelector('p')!; const frame = document.querySelector('.frame')!;
            (title as HTMLElement).style.fontSize = `${size}px`; (body as HTMLElement).style.fontSize = `${Math.max(minimumFontSize, size * 0.58)}px`;
            return frame.scrollHeight <= frame.clientHeight + 1 && frame.scrollWidth <= frame.clientWidth + 1;
          }, { size, minimumFontSize });
          if (fits) break;
        }
        if (!fits) throw new Error('Card text does not fit; shorten the title/body or increase dimensions');
        await page.screenshot({ path: temporary, type: 'png', omitBackground: card.overlay === true }); signal.throwIfAborted(); await rename(temporary, card.output);
      } finally { await rm(temporary, { force: true }); await page.close().catch(() => {}); }
    }
  } finally {
    signal.removeEventListener('abort', stop);
    if (browser) await browser.close(); else void launch.then(value => value.close()).catch(() => {});
  }
}
