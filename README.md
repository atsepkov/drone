# Drone

Tests against different websites, rendering differences highlighted in red:

![investomation example](https://i.imgur.com/RjTcl3It.png 'Investomation')
![yahoo example](https://i.imgur.com/K8XlD57t.png 'Yahoo')

Drone is a webapp UI test framework for lazy people, like myself. I should write more unit tests, but I'm a horrible person,
so I don't. When my web apps break, they typically break in predictable ways, as a result of my refactoring.
This tool helps me find these breakages quickly in a semi-automated way. Here is how it works:

- you define a set of pages to navigate to and set of actions to perform
- the framework executes those actions, and records the results
- from that point on, the results are saved as 'last successful run', recording page content and load times
- any deviation in content in consecutive runs results in a failed overall run
- any increase in load time greater than 20% results in a failed overall run
- you can forgive individual failures using config, forcing a new successful run

In addition to UI testing, Drone can also be used for webscraping. See usage section.

## Installation

    npm install test-drone

## Usage

There are 2 classes within this module:
- `Drone` is a base class that can be spawned through Node directly and can be used for web-scraping.
- `TestDrone` is a testing class extending it that performs screenshot-based testing.

The TestDrone class is meant to be used within a test framework (Jest, Jasmine, and Mocha were tested, but most should work). Note
that your test syntax may differ slightly (for example, in Mocha, you would use `before` and `after` instead of `beforeAll` and `afterAll`).

Let's say we want to test Yahoo's search functionality. Here is a simple test suite (4 tests) that navigates to the main page,
searches for apples, checks the 2nd page of results, and then the images tab. For each of these actions it grabs a screenshot,
and compares load time against previous run:

```javascript
const Drone = require('test-drone').TestDrone;
const drone = new Drone();

describe('my test example', () => {
  beforeAll(async () => {
    await drone.start({
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
      let nextPageLink = await page.waitForSelector('a.next');
      await Promise.all([
        nextPageLink.click(),
        page.waitForNavigation({waitUntil: 'networkidle0'}),
      ]);
    },
  });

  drone.test('go to images tab', {
    actions: async page => {
      let imagesTabLink = await page.elementWithText('Images');
      await Promise.all([
        imagesTabLink.click(),
        page.waitForNavigation({waitUntil: 'networkidle0'}),
      ]);
    },
  });

  afterAll(async () => {
    await drone.stop();
  });
});
```

Running the above test first time will pass. Running it a 2nd time will fail, however, because Yahoo randomizes advertisements, and
placement of images and search results slightly. For Yahoo, this randomization is intentional, but for you that may not be the case.
This is exactly the kinds of changes this test framework intends to find. The output of your 2nd run will look something like this:

      my test example
          1) load yahoo
          2) search for apples
          3) go to next search page
          4) go to images tab

      test                    previous (ms)  current (ms)
      ----------------------  -------------  ------------
      load yahoo              2071           1738
      search for apples       902            938
      go to next search page  1364           1406
      go to images tab        1772           1865

      4 tests failed.


      0 passing (9s)
      4 failing

      1) my test example
           load yahoo:
         Error: Actual differs from golden by 15186 pixels (see load_yahoo-diff.png).
          at Promise (index.js:202:18)

      2) my test example
           search for apples:
         Error: Actual differs from golden by 1383 pixels (see search_for_apples-diff.png).
          at Promise (index.js:202:18)

      3) my test example
           go to next search page:
         Error: Actual differs from golden by 893 pixels (see go_to_next_search_page-diff.png).
          at Promise (index.js:202:18)

      4) my test example
           go to images tab:
         Error: Actual differs from golden by 427337 pixels (see go_to_images_tab-diff.png).
          at Promise (index.js:202:18)

The above tells us run times for each test, as well as why each failed, and which image to check for troubleshooting.

If like Yahoo, you also have portions of your webpage render differently after each reload (i.e. advertisements), you can tell the test
to ignore them in the diff by passing a list of selectors to ignore on the page. For example, by looking at the diff of the first
page (`load_yahoo-diff.png`), we can inspect problematic areas:

![diff example](https://i.imgur.com/K8XlD57.png 'Diff Example')

From above image we can see that stories in "Trending Now" section as well as screenshots below the main story, and the list of other
stores triggered a false positive by loading in a different order from the golden image. We can easily fix that by finding the
relevant selectors and telling Drone to ignore those elements (yes, I'm aware that given the highly dynamic nature of Yahoo front
page the rest of the elements will change within a few hours or a day as well - but let's ignore that for now since that will
probably not be the case for the web app you're testing). Let's assume that Yahoo gave the ID of `#trending-now` to the section
in the top-right, a class of `.thumbnail` to every thumbnail element below the main story and an ID of `#stories` to the container
below listing other stories (Yahoo actually didn't do that, they used cryptic classes and no IDs instead (bad Yahoo), but you will
probably give proper IDs and avoid mangling ID/class names in dev environment given the good developer that you are). Eliminating
false positives is now as simple as changing the test to:

```javascript
drone.test('load yahoo', {
  waitFor: '#mega-banner-close',
  ignore: ['#trending-now', '.thumbnail', '#stories'],
  actions: async page => {
    await page.goto('https://yahoo.com');
  },
});
```

Remove golden version of the image and rerun the test, these elements will now be ignored from the diff.

Finally, let's say you're testing a website that takes a long time to load. Your coworker (not you, of course) wrote a bad DB
query that takes over 30 seconds to execute. Your website entertains regular users with a loading screen, but Drone is not so
easily amused. The test runner times out after 30 seconds instead of waiting for your query to return. You can remedy this
situation as well by setting a higher `timeout` for your individual test. Similarly, if the same coworker wrote all of your
DB queries, and they ALL take over 30 seconds to run, you can set `defaultTimeout` during setup call that will apply to all
tests that don't explicitly define their own.

## Complete API

To make usage simpler, the rest of this guide describes drone API. The params are described in TypeScript-like format to give
you an idea of which field take what arguments and which fields are optional.

### Drone

    drone.start(options: {
      testDirectory?: string, // absolute path to directory where test data will be placed (defaults to node_modules/test-drone)
      defaultTimeout?: number, // default timeout for all tests (defaults to 30,000 ms)
      viewport?: { width: number, height: number }
    })

Used to initialize drone and setup a browser instance.

    drone.stop()

Terminate tests, close browser instance, show a table of test results, and if all tests are successful, replace golden directory with
current results.

### TestDrone

    drone.test(testName: string, {
      waitFor?: string, // selector to wait for before grabbing the screenshot and completing the test
      actions?: (page: puppeteer.Page) => { ... }, // logic to perform during the test
      ignore?: string[],   // list of selectors to ignore (if more than one element satisfies a selector, all will be ignored)
      timeout?: number, // optional timeout to specify, default timeout is 30,000 ms
      duration?: number // maximum duration to allow for the test, defaults to 120% of previous run
    })

Test definition logic, note that you should not use `it` or `test` functions from your framework, the above test will automatically
call it internally (see above example).

### Page

The `page` argument passed to `actions` function is a Puppeteer page object (see https://devdocs.io/puppeteer/index#class-page for
usage) with a few convenience methods I added to make testing easier:

    page.elementWithText(text: string)

A convenience function that can be used to find element by text instead of trying to find it via selectors. This function will throw
an error if no elements contain this exact text or more than one element with this exact text exists. Note that the text must be exact,
not a substring.

    page.allElementsWithText(text: string)

Same as above, but will return an array of all elements with this text.

    page.clickWithinElement(options: {
      element: ElementHandle, // element to click on, please make sure to pass a handle, not a selector or text
      offset: {
        x: number, // offset from the center (fraction within -1 < x < 1 is treated as percentage, otherwise as pixels)
        y: number  // offset from the center (fraction within -1 < x < 1 is treated as percentage, otherwise as pixels)
      }
    })

Convenience function for clicking exact position within the element (the `x/y` offset is relative to the center of the element). If a
fraction between -1 and 1 is provided the coordinate is treated as a percentage, otherwise the offset is treated as exact pixel amount.

    page.waitForElementWithText(text: string)

Returns a promise that resolves when at least one element with given text appears on the page.

    page.wait(ms: number)

Returns a promise that resolves after `ms` milliseconds.

    page.scrape(element: ElementHandle, format: 'json' | 'text')

Returns a promise that resolves to element content, either as text or json hash.
