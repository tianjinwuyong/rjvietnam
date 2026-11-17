
const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const pages = browser.contexts().flatMap(c => c.pages());
    for (const p of pages) {
      console.log('TAB:', p.url().slice(0, 120));
    }
    await browser.close();
  } catch (e) { console.log('CDP unavailable:', e.message); }
})();
