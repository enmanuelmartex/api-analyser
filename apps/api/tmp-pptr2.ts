import puppeteer from 'puppeteer-core';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';

const candidates = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean) as string[];

console.log('Existing browsers:');
for (const c of candidates) console.log(`  ${existsSync(c) ? 'YES' : 'no '} ${c}`);
const exe = candidates.find((c) => existsSync(c))!;

async function tryLaunch(label: string, opts: any) {
  const dir = mkdtempSync(join(tmpdir(), 'iasa-pdf-'));
  const start = Date.now();
  try {
    const browser = await puppeteer.launch({ userDataDir: dir, ...opts });
    const page = await browser.newPage();
    await page.setContent('<h1>hi</h1>', { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({ format: 'A4' });
    await browser.close();
    console.log(`[OK ] ${label}: ${pdf.length} bytes / ${Date.now() - start}ms`);
    return true;
  } catch (e: any) {
    console.log(`[ERR] ${label}: ${String(e.message).split('\n')[0]}`);
    return false;
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
  }
}

(async () => {
  const base = { executablePath: exe, headless: true };
  await tryLaunch('pipe:true', { ...base, pipe: true, args: ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage'] });
  await tryLaunch('headless=new', { ...base, args: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage'] });
  await tryLaunch('pipe+nosandbox', { ...base, pipe: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--no-first-run', '--disable-dev-shm-usage'] });
})().catch((e) => console.error('FATAL', e.message));
