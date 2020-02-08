const Drone = require('../drone').TestDrone;
const drone = new Drone();

drone.addState('main page', async (page) => {
  return await page.$('#mega-banner-close');
});
drone.addState('search results', async (page) => {
  return await page.$('.compPagination');
});

drone.addDefaultStateTransition('main page', async (page) => {
  await page.goto('https://yahoo.com');
});
drone.addStateTransition('main page', 'search results', async (page, params) => {
  await page.focus('#uh-search-box');
  await page.keyboard.type(params.searchTerm);
  await page.keyboard.press('Enter');
});

describe('my test example', () => {
  beforeAll(async () => {
    await drone.start({
      viewport: {
        width: 1280,
        height: 800,
      },
    });
  });

  drone.test('load yahoo', { actions: async page => {
    drone.ensureState('main page', () => {});
  }});

  drone.test('search for apples', { actions: async page => {
    drone.ensureState('search results', { searchTerm: apples }, async page => {});
  }});

  drone.test('go to next search page', { actions: async page => {
    drone.ensureState('search results', { searchTerm: apples }, async page => {
      let nextPageLink = await page.waitForSelector('a.next');
      await Promise.all([
        nextPageLink.click(),
        page.waitForNavigation({waitUntil: 'networkidle0'}),
      ]);
    });
  }});

  drone.test('go to images tab', { actions: async page => {
    drone.ensureState('search results', { searchTerm: apples }, async page => {
      let imagesTabLink = await page.elementWithText('Images');
      await Promise.all([
        imagesTabLink.click(),
        page.waitForNavigation({waitUntil: 'networkidle0'}),
      ]);
    });
  }});

  afterAll(async () => {
    await drone.stop();
  });
});
