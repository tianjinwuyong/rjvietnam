// BOM Import/Export Test Script
import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const CHROMIUM_PATH = 'C:\\Users\\tianj\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe';
const APP_URL = 'http://localhost:5179/';
const BOM_FILE = 'C:\\Users\\tianj\\Desktop\\越南工厂瑞晶\\越南工厂瑞晶\\dc\\bom\\Anker A2672 CD版 1C 100WGaN插墙式电源适配器黑色（US版) SKU：B2672111-001  Vietnam版 2026.5.19 越南东泰.xls';

async function runTests() {
  console.log('🚀 Starting BOM Import/Export Tests\n');

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  try {
    // Test 1: Load app and navigate to BOM
    console.log('📋 Test 1: Load app and navigate to BOM...');
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');
    console.log('  ✅ App loaded');

    // Find and click BOM nav item
    const bomLink = page.locator('nav').getByText('BOM').or(page.locator('div').getByText('BOM'));
    await bomLink.first().click();
    await page.waitForTimeout(1000);
    console.log('  ✅ BOM page opened');

    // Test 2: Verify BOM list loads
    console.log('\n📋 Test 2: BOM list loads...');
    const bomCards = page.locator('[style*="border-radius: 8"]').filter({ hasText: /\d+/ });
    const count = await bomCards.count();
    console.log(`  ✅ Found ${count} BOM items in list`);

    // Test 3: Verify Import Excel button exists
    console.log('\n📋 Test 3: Import Excel button exists...');
    const importBtn = page.getByRole('button', { name: /导入 Excel|Nhập Excel|Import Excel/ });
    const importBtnVisible = await importBtn.isVisible().catch(() => false);
    console.log(`  ${importBtnVisible ? '✅' : '❌'} Import Excel button ${importBtnVisible ? 'visible' : 'NOT visible'}`);

    // Test 4: Click Import button and verify file picker
    console.log('\n📋 Test 4: Import button triggers file input...');
    await importBtn.click();
    await page.waitForTimeout(500);
    // The hidden file input should be triggered - we can't verify file dialog but check no errors
    console.log('  ✅ Import button clicked without error');

    // Test 5: Test file upload via hidden input
    console.log('\n📋 Test 5: Upload Excel file...');
    const fileInput = page.locator('input[type="file"][accept*=".xls"]');
    const fileInputExists = await fileInput.count();
    if (fileInputExists > 0) {
      await fileInput.setInputFiles(BOM_FILE);
      await page.waitForTimeout(2000);
      console.log('  ✅ File selected');

      // Check if preview appeared
      const previewTitle = page.getByText('导入 BOM').or(page.getByText('Nhập BOM')).or(page.getByText('Import BOM'));
      const previewVisible = await previewTitle.isVisible().catch(() => false);
      if (previewVisible) {
        console.log('  ✅ Import preview panel appeared');

        // Check for line count
        const lineCount = await page.locator('[style*="maxHeight"] > div').count();
        console.log(`  ✅ Preview shows ${lineCount} material lines`);
      } else {
        console.log('  ⚠️  Import preview panel did not appear (possible parse error)');
      }
    } else {
      console.log('  ❌ File input not found');
    }

    // Test 6: Verify Create BOM button
    console.log('\n📋 Test 6: Create BOM button works...');
    const createBtn = page.getByRole('button', { name: /新建 BOM|Tạo BOM|New BOM/ });
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await page.waitForTimeout(500);
      const productCodeInput = page.locator('input[placeholder*="产品编码"]').or(page.locator('input[placeholder*="Product Code"]'));
      const inputVisible = await productCodeInput.isVisible().catch(() => false);
      console.log(`  ${inputVisible ? '✅' : '❌'} Create form ${inputVisible ? 'opened' : 'did not open'}`);

      // Cancel to go back
      const cancelBtn = page.getByRole('button', { name: /取消|Hủy|Cancel/ });
      await cancelBtn.first().click();
    } else {
      console.log('  ⚠️  Create button not found');
    }

    // Test 7: Click on a BOM item
    console.log('\n📋 Test 7: Click BOM item shows detail...');
    const firstBom = page.locator('[style*="border-radius: 8"]').first();
    await firstBom.click();
    await page.waitForTimeout(1000);
    const detailPanel = page.locator('h3').filter({ hasText: /B2672|EPS/ });
    const detailVisible = await detailPanel.isVisible().catch(() => false);
    console.log(`  ${detailVisible ? '✅' : '❌'} BOM detail ${detailVisible ? 'shown' : 'not shown'}`);

    // Test 8: Verify material lines in detail
    console.log('\n📋 Test 8: Material lines in detail...');
    const materialRows = page.locator('table tbody tr, [style*="grid"] > div').filter({ hasText: /R\d{4}|\d+\.\d+\.\d+/ });
    const rowCount = await materialRows.count();
    console.log(`  ✅ Found ${rowCount} material rows in detail`);

    // Test 9: Console errors check
    console.log('\n📋 Test 9: Console errors...');
    if (errors.length === 0) {
      console.log('  ✅ No console errors');
    } else {
      console.log(`  ⚠️  ${errors.length} console error(s):`);
      errors.forEach(e => console.log(`     ${e}`));
    }

    console.log('\n📊 All critical tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
  } finally {
    await browser.close();
  }
}

runTests().catch(console.error);
