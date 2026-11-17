import { test } from '@playwright/test';

test('Debug: capture all console output from 3D scene', async ({ page }) => {
  const allConsole: string[] = [];
  page.on('console', msg => {
    allConsole.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.fill('input[placeholder="用户名"], input[name="username"]', 'ADMIN_VN_01');
  await page.fill('input[type="password"]', 'Factory@123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  const mesButton = page.getByRole('button', { name: /MES\s*执行/i });
  await mesButton.click();
  await page.waitForTimeout(8000);

  // Dump all captured console messages
  console.log('=== ALL CONSOLE OUTPUT ===');
  const relevant = allConsole.filter(m =>
    !m.includes('favicon') && !m.includes('WebSocket')
  );
  if (relevant.length === 0) {
    console.log('(no non-WS/favicon messages)');
  } else {
    relevant.forEach(m => console.log(m));
  }
  console.log(`Total messages: ${allConsole.length}, Relevant: ${relevant.length}`);

  // Specifically search for NgBlock messages
  const ngMsgs = allConsole.filter(m => m.includes('NgBlock'));
  console.log(`NgBlock messages: ${ngMsgs.length}`);
  ngMsgs.forEach(m => console.log(' -', m));
});
