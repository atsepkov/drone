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

Both `Drone` and `TestDrone` allow 2 approaches to coding: imperative and declarative.
You can see example usage for each one by looking at `example.js`, `example.declarative.js` and `example.test.js` files.

The difference between declarative and imperative approaches is the coding style:

- **Imperative**: do action `A`, then do action `B`, then do action `C` (which should load page `S`), then do action `D`.
- **Declarative**: make sure page `S` is loaded, then do `D`.

You can find more information in [Imperative](#imperative-approach) and [Declarative](#declarative-approach) sections that
follow. Declarative approach is recommended, as it's a lot more durable (in case of 404 pages, or page errors) 
and even allows retries. But declarative is not often as intuitive and requires a bit more preparation on your end.
I also recommend declarative approach for testing, since it allows you to make your tests independent more easily and also allows
you to make your tests more thorough.

### Basic Example
A quick example webscraping a table from a web page into a json file for use in case:
```javascript
const fs = require('fs');
const Drone = require('test-drone').Drone;
const drone = new Drone();

const file = 'state_abbreviations.json';
const url = 'https://docs.omnisci.com/v4.0.1/3_apdx_states.html';
const tableSelector = 'table.colwidths-given.docutils';

(async () => {
    await drone.start();
    const data = (await drone.actions(async (page) => {
        await page.goto(url);
        const table = await page.waitForSelector(tableSelector);
        return page.scrape(table, 'json');
    }, { cache: url })); // be nice, cache result

    fs.writeFileSync(file, JSON.stringify(data));
    await drone.stop();
})();
```
### Testing
We'll show 2 approaches to testing, imperative and declarative. Note that each of these approaches can also be used for webscraping
(jsut use `Drone` instead of `TestDrone`).

#### Imperative Approach
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

#### Declarative Approach
The alternative approach involves defining states (i.e. web pages) and ransitions between them. Drone then builds an 
internal state machine and learns how to navigate the website. Instead of giving it step-by-step instructions you can then 
simply ask the drone to make sure it's in proper state before running your instructions. Drone figures out shortest path to 
desired state from current using Dijkstra's algorithm. This is very similar to how your GPS system works, it's a GPS system 
for web crawling.

Taking the Yahoo example above, we can rewrite it using this declarative approach:

```javascript
const Drone = require('test-drone').TestDrone;
const drone = new Drone();

drone.addState('main page', async (page) => {
  return await page.$('#mega-banner-close');
});
drone.addState('search results', async (page) => {
  return await page.$('.compPagination');
});

drone.addDefaultStateTransition('main page', (page) => {
  await page.goto('https://yahoo.com');
});
drone.addStateTransition('main page', 'search results', (page, params) => {
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

  drone.test('go to images tab', { async page => {
    let imagesTabLink = await page.elementWithText('Images');
    await Promise.all([
      imagesTabLink.click(),
      page.waitForNavigation({waitUntil: 'networkidle0'}),
    ]);
  }});

  afterAll(async () => {
    await drone.stop();
  });
});
```

The benefits of this approach may not be apparent at first. Unlike the imperative approach, this approach is
less fragile and easier to use for more complex tests/crawlers. It deals with failures better by ensuring
that your operations start in the correct state. In case of failures it will retry the navigation until it's 
obvious that the transition is broken. If the website has a hickup, fails to load or serves a 404 page, the 
declarative approach will be able to recover from it, the imperative approach will not.

The other powerful feature of declarative mode is `TestDrone.testAllStates`, which will automatically navigate to
every declared state in random order and test that this state works as expected, taking photos if there are issues. See
[TestDrone.testAllStates](#testdrone-testallstates) for more info.

## Complete API

To make usage simpler, the rest of this guide describes drone API. The params are described in TypeScript-like format to give
you an idea of which field take what arguments and which fields are optional.

### Drone

#### Drone.start

    drone.start(options: {
      testDirectory?: string, // absolute path to directory where test data will be placed (defaults to node_modules/test-drone)
      defaultTimeout?: number, // default timeout for all tests (defaults to 30,000 ms)
      viewport?: { width: number, height: number }
    })

Used to initialize drone and setup a browser instance.

#### Drone.stop

    drone.stop()

Terminate tests, close browser instance, show a table of test results, and if all tests are successful, replace golden directory with
current results.

#### Drone.actions

    drone.actions(logic: async (page: puppeteer.Page) => { ... }, options: {
        cache?: string // variable to cache the result under, if omitted no caching will be done
    })

Run a set of actions on the page. Note that both `Drone.actions()` and `TestDrone.test()` leave the page/drone in its final state, 
they do no cleanup to reset the state back to what it was prior to running this logic. This means you can stack logic through
multiple calls to these methods but also that your starting state depends on the final state of the logic ran beforehand. Be aware
of this when caching partial operations, cached operations will skip navigation and page manipulation. However, do use caching
whenever possible to avoid bombarding other sites with drones. Fly responsibly!

#### Drone.addState (declarative mode)

    drone.addState(stateName: string, testCriteriaCallback: (page: puppeteer.Page, params: {}) => boolean)

Registers a new state with drone's internal state machine. A state is typically a page, but can be anything you want to uniquely
identify, such as `logged in` and `logged out` screens. The username of logged in user, on the other hand, is probably not a good
state, because it would explode the number of states in the state machine and make it harder to wrap your head around. Tracking the name
of logged in user is better done by storing it to `params` argument passed in to state testing function. This argument preserves any
properties you set on it, allowing you to test for them later or use them in other states. State name is a unique string, similar 
to test description in Jest. The test criteria function is used by drone to decide whether it's in the right state. You should define 
a list of test criteria within it, with return value identifying whether you're in this state or not. Test criteria can be any checks 
you choose to perform, from persence of certain elements, to text on the page, to cookies, etc. It's in your interest to make these as 
specific as possible, you should make sure no other state can pass the combination of this test criteria.

#### Drone.addStateTransition (declarative mode)

    drone.addStateTransition(
      startState: string,
      endState: string,
      transitionLogicCallback: (page: puppeteer.Page, params: {}) => void,
      cost: number = 1
    )

Registers a new state transition between two states. Note that both states must exist when you call this function (you can define them
via `drone.addState()` method shown above). Start and end states should be unique state names you gave each state when adding it. Cost
is an optional weight you assign to this transition, higher value makes this transition more expensive from navigation point of view and
less likely to be taken by the state machine. You can use this to discourage inefficent/slow web pages. The default is 1. The callback
function is a set of logic drone can perform to end up in `endState` if it knows that it's already in `startState`. Note that drone
will test if transition was successful and repeat the transition if an error occurred. If transition results in the wrong state, drone
will recompute shortest path from new state and attempt navigation again. An error will be shown to the user if this occurs, but drone
will not terminate unless maximum number of retries has been reached.

#### Drone.addDefaultStateTransition (declarative mode)

    drone.addStateTransition(
      endState: string,
      transitionLogicCallback: (page: puppeteer.Page, params: {}) => void,
      cost: number = 1
    )

Similar to `addStateTransition` except the start state is assumed to be any state the user didn't explicitly register. Drone will
fallback to this if it ends up in a state it doesn't understand (an undocumented 404 page or server error). **Tip**: navigation to
home page is a good default state transition to add.

#### Drone.whereAmI (declarative mode)

    drone.whereAmI()

You can call this at any time to ask drone to classify the current state you're in based on state test criteria you specified when
registering your states. Drone will return `stateName` string that you assigned to this state. If drone can't determine the state,
it will return the string `<< INVALID STATE >>`. Attempting to transition from this state will invoke deftault state transition.

#### Drone.findPathToState (declarative mode)

    drone.findPathToState(stateName: string) => Transition[]

Returns a list corresponding to state transitions that must be performed to navigate from drone's current state to desired state. You
usually won't need to call this method directly unless you're troubleshooting drone's navigation, `drone.ensureState` will call this
automatically.

#### Drone.traversePath (declarative mode)

    drone.traversePath(path: Transition[], retries: number)

Navigates the passed in path, gives up if any transition fails more than the number of requested retries. Retries are reset after
a successful transition. Same as with `drone.findPathToState`, you usually won't need this method unless you're troubleshooting.

#### ensureState (declarative mode)

    drone.ensureState(stateName: string, params: {}, actions: async (page: puppeteer.Page) => { ... }, retries: number)

Tells drone to find its way to requested state, no matter where drone is now, and execute a set of actions afterwards. Each
transition will be attempted the number of times specified by `retry` in the event of failure. The format of actions function is
the same as that of `drone.actions` method. `params` is your persistent set of arguments you decide to pass in, which can be used
for testing states, or performing state transitions (i.e. you can store login credentials, current search query, etc.).

#### ensureEitherState (declarative mode)

    drone.ensureEitherState(stateList: string[], params: {}, actions: async (page: puppeteer.Page) => { ... }, retries: number)

Tells drone to find its way to either of the passed in states, whichever is faster to get to. This can be used when you can use
either of the passed in states as a starting state. For example, in order to perform a new search query on Google, you can start
at the home page (google.com) or any other page that has a search bar.

### TestDrone

#### TestDrone.test

    drone.test(testName: string, options: {
      waitFor?: string, // selector to wait for before grabbing the screenshot and completing the test
      actions?: (page: puppeteer.Page) => { ... }, // logic to perform during the test
      ignore?: string[],   // list of selectors to ignore (if more than one element satisfies a selector, all will be ignored)
      timeout?: number, // optional timeout to specify, default timeout is 30,000 ms
      duration?: number // maximum duration to allow for the test, defaults to 120% of previous run
    })

Test definition logic, note that you should not use `it` or `test` functions from your framework, the above test will automatically
call it internally (see above example).

#### TestDrone.testAllStates (declarative mode) (WORK IN PROGRESS)

    drone.testAllStates(params: {}, order: string[])

Tests whether all requested states can be navigated to and whether all requested transitions result in correct state navigations.
States will be checked in random order, to maximize coverage between runs, but you can pass an `order` you want them traversed in
to override that. This test function alone can probably replace most of your UI tests.

### Page

The `page` argument passed to `actions` function is a Puppeteer page object (see https://devdocs.io/puppeteer/index#class-page for
usage) with a few convenience methods I added to make testing easier:

#### Page.elementWithText

    page.elementWithText(text: string)

A convenience function that can be used to find element by text instead of trying to find it via selectors. This function will throw
an error if no elements contain this exact text or more than one element with this exact text exists. Note that the text must be exact,
not a substring.

#### Page.allElementsWithText

    page.allElementsWithText(text: string)

Same as above, but will return an array of all elements with this text.

#### Page.clickWithinElement

    page.clickWithinElement(options: {
      element: ElementHandle, // element to click on, please make sure to pass a handle, not a selector or text
      offset: {
        x: number, // offset from the center (fraction within -1 < x < 1 is treated as percentage, otherwise as pixels)
        y: number  // offset from the center (fraction within -1 < x < 1 is treated as percentage, otherwise as pixels)
      }
    })

Convenience function for clicking exact position within the element (the `x/y` offset is relative to the center of the element). If a
fraction between -1 and 1 is provided the coordinate is treated as a percentage, otherwise the offset is treated as exact pixel amount.

#### Page.waitForElementWithText

    page.waitForElementWithText(text: string)

Returns a promise that resolves when at least one element with given text appears on the page.

#### Page.wait

    page.wait(ms: number)

Returns a promise that resolves after `ms` milliseconds.

#### Page.filter

    page.filter({ css?: string, xpath?: string, text?: string })

Returns a list of elements that satisfy all of the passed in criteria (subset of elements that can be selected with passed in css 
selected, filtered down to elements that can also by selected by passed in xpath, and contain passed in text). Note that you can
omit some of these properties, resulting in the corresponding filter not being applied.

#### Page.scrape

    page.scrape(element: ElementHandle, format: 'json' | 'text')

Returns a promise that resolves to element content, either as text or json object. The json format is still a work in progress right
now, and works best for HTML table elements.
