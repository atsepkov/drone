const drone = require('../drone');

if (!global.beforeAll) {
  // for mocha
  global.beforeAll = before;
  global.afterAll = after;
}

describe('my test example', () => {
  beforeAll(async () => {
    await drone.setup({
      viewport: {
        width: 1280,
        height: 800,
      },
    });
  });

  drone.test('load yahoo', {
    waitFor: '#mega-banner-close',
    actions: async page => {
      await page.goto('https://yahoo.com');
    },
  });

  drone.test('search for apples', {
    waitFor: '.compPagination',
    actions: async page => {
      await page.focus('#uh-search-box');
      await page.keyboard.type('apples');
      await page.keyboard.press('Enter');
    },
  });

  drone.test('go to next search page', {
    actions: async page => {
      let nextPage = await page.waitForSelector('a.next');
      await Promise.all([
        nextPage.click(),
        page.waitForNavigation({waitUntil: 'networkidle0'}),
      ]);
    },
  });

  drone.test('go to images tab', {
    actions: async page => {
      let imagesTab = await page.elementWithText('Images');
      await Promise.all([
        imagesTab.click(),
        page.waitForNavigation({waitUntil: 'networkidle0'}),
      ]);
    },
  });

  afterAll(async () => {
    await drone.teardown();
  });
});
