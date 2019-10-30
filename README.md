# Drone

Tests done against different websites, rendering differences highlighted in red:
![investomation example](https://i.imgur.com/RjTcl3It.png 'Investomation')
![yahoo example](https://i.imgur.com/K8XlD57t.png 'Yahoo')

Drone is a webapp UI test framework for lazy people, like myself. I should write unit tests, but often I don't have
time to, or am too lazy to. When my web apps break, they typically break in predictable ways, as a result of my refactoring.
This tool helps me find these breakages quickly in a semi-automated way. Here is how it works:

- you define a set of pages to navigate to and set of actions to perform
- the framework executes those actions, and records the results
- from that point on, the results are saved as 'last successful run', recording page content and load times
- any deviation in content in consecutive runs results in a failed overall run
- any increase in load time greater than 20% results in a failed overall run
- you can forgive individual failures using config, forcing a new successful run

## Usage

The test module is meant to be used within a test framework (Jest, Jasmine, and Mocha were tested, but most should work). Note
that your test syntax may differ slightly (for example, in Mocha, you would use `before` and `after` instead of `beforeAll` and `afterAll`).

Let's say we want to test Yahoo's search functionality. Here is a simple test suite (4 tests) that navigates to the main page,
searches for apples, checks the 2nd page of results, and then the images tab. For each of these actions it grabs a screenshot,
and compares load time against previous run:

    const drone = require('./drone');

    describe('my test example', () => {

      beforeAll(async () => {
        await drone.setup({
          viewport: {
            width: 1280,
            height: 800
          }
        })
      })

      drone.test('load yahoo', {
        waitFor:  '#mega-banner-close',
        actions: async (page) => {
          await page.goto('https://yahoo.com');
        },
      });

      drone.test('search for apples', {
        waitFor: '.compPagination',
        actions: async (page) => {
          await page.focus('#uh-search-box');
          await page.keyboard.type('apples');
          await page.keyboard.press('Enter');
        },
      });

      drone.test('go to next search page', {
        actions: async (page) => {
          let nextPage = await page.waitForSelector('a.next');
          await Promise.all([
            nextPage.click(),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
          ])
        },
      });

      drone.test('go to images tab', {
        actions: async (page) => {
          await Promise.all([
            page.clickElementWithText('Images'),
            page.waitForNavigation({ waitUntil: 'networkidle0' })
          ])
        },
      });

      afterAll(async () => {
        await drone.teardown();
      })
    })

Running the above test first time will pass. Running it a 2nd time will fail, however, because Yahoo randomizes advertisements, and
placement of images and search results slightly. For Yahoo, this randomization is intentional, but for you that may not be the case.
This is exactly the kinds of changes this test framework intends to find.

If you too, however, have portions of your webpage render differently after each reload (i.e. advertisements), you can tell the test
to ignore them in the diff by passing a list of selectors to ignore on the page. For example, by looking at the diff of the first
page (load_yahoo-diff.png), we can inspect problematic areas:

![diff example](https://i.imgur.com/K8XlD57.png 'Diff Example')

From above image we can see that stories in "Trending Now" section as well as screenshots below the main story triggered a false
positive by loading in a different order from the golden image. We can easily fix that by finding the relevant selectors and telling
Drone to ignore those elements (yes, I'm aware that given the highly dynamic nature of Yahoo front page the rest of the elements
will change within a few hours or a day as well - but let's ignore that for now since that will probably not be the case for the
web app you're testing). Let's assume that Yahoo gave the ID of `#trending-now` to the section in the top-right and a class of
`.thumbnail` to every element below the main story (Yahoo actually didn't do that, they used cryptic classes and no IDs instead
(bad Yahoo), but you will probably give proper IDs and avoid mangling names in dev given the good developer you are). Eliminating
false positives is now as simple as changing the test to:

    drone.test('load yahoo', {
      waitFor:  '#mega-banner-close',
      ignore: ['#trending-now', '.thumbnail'],
      actions: async (page) => {
        await page.goto('https://yahoo.com');
      },
    });

## Complete API

To make usage simpler, the rest of this guide describes drone API. The params are described in TypeScript-like format to give
you an idea of which field take what arguments and which fields are optional.

    drone.setup(options: {
      viewport?: { width: number, height: number }
    })

Used to initialize drone and setup a browser instance.

    drone.test(testName: string, {
      waitFor?: string, // selector to wait for before grabbing the screenshot and completing the test
      actions?: (page: puppeteer.Page) => { ... }, // logic to perform during the test
      ignore?: string[],   // list of selectors to ignore (if more than one element satisfies a selector, all will be ignored)
      timeout?: number // optional timeout to specify, default timeout is 30,000 ms
    })

Test definition logic, note that you should not use `it` or `test` functions from your framework, the above test will automatically
call it internally (see above example).

    drone.teardown()

Terminate tests, close browser instance, show a table of test results, and if all tests are successful, replace golden directory with
current results.

    page.clickElementWithText(text: string)

A convenience function that can be used to click on an exact link instead of trying to find it via selectors. This function will throw
an error if no elements match the selector or more than one element with this exact text exists. Note that the text must be exact, not
a substring.
