// Run with Playwright installed: node tests/test_sidebar_navigation.cjs [web-url]
// This regression check only reads the running application's data.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[2] || 'http://127.0.0.1:8025/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('.database-nav-item').first().waitFor();
    const databaseNames = await page.locator('.database-nav-item .table-nav-name').allTextContents();
    assert.ok(databaseNames.length > 0, 'Connect a DuckDB dataset before running this check');

    for (const name of databaseNames) {
      const row = page.locator('.database-nav-item').filter({ has: page.getByText(name, { exact: true }) });
      const expectedCount = Number((await row.locator('.row-badge').innerText()).split(' ')[0]);
      await row.click();
      // The previous missing chevronLeft crashed the React tree at this point.
      await page.waitForFunction(() => Boolean(document.querySelector('.sidebar-back')) || !document.querySelector('.app-shell'));
      assert.deepEqual(errors, [], 'Opening a database must not crash the Icon component');
      const back = page.locator('.sidebar-back');
      assert.equal(await back.isVisible(), true, 'Table list must provide a return button');
      assert.equal(await page.locator('.table-list').getAttribute('aria-label'), '数据表列表');
      assert.equal(await page.locator('.table-list .table-nav-item').count(), expectedCount);
      if (expectedCount === 0) assert.match(await page.locator('.table-list').innerText(), /这个数据库还没有数据表/);
      await back.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.table-list').getAttribute('aria-label'), '数据库列表');
      assert.deepEqual(await page.locator('.database-nav-item .table-nav-name').allTextContents(), databaseNames);
      await row.click();
      await page.locator('.sidebar-back').click();
      assert.deepEqual(errors, [], 'Repeated open/back operations must remain usable');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
    await page.locator('.database-nav-item').first().click();
    await page.locator('.sidebar-back').click();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ databases: databaseNames, checks: ['open table list', 'empty and populated database lists', 'keyboard return', 'repeated open/return', 'mobile drawer', 'no browser errors'] }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
