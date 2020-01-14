require('console.table');
const puppeteer = require('puppeteer');
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const fs = require('fs');
const path = require('path');
const expect = require('expect.js');
const util = require('./util');

const BAD_STATE = '<< INVALID STATE >>';

/*
 * Base class for puppeteer-powered browsing automation library.
 */
class Drone {
  constructor() {
    // genreal properties
    this.browser = null;
    this.page = null;
    this.defaultTimeout = 30000;
    this.baseDir = __dirname;

    // state machine properties
    this.states = {}; // possible states the system is aware of
    this.stateOrder = []; // states defined earlier on have higher test priority
    this.transitions = {}; // state transitions the system is aware of
    this.neighbors = {}; // used by Dijsktra's algorithm to figure out how to traverse states
    this.currentState = null; // used to 'cache' current state to speed up some operations
  }

  // call this to setup and start the drone
  async start(options = {}) {
    // general setup
    this.browser = await puppeteer.launch(options);
    this.page = await this.browser.newPage();
    this.defaultTimeout = options.defaultTimeout
      ? options.defaultTimeout
      : this.defaultTimeout;
    this.baseDir = options.baseDirectory ? options.baseDirectory : this.baseDir;
    this.config = this.readConfig(this.baseDir);
    await this.page.setViewport(options.viewport || this.config.resolutions[0]);

    // state machine setup

    // page convenience methods

    const escapeXpathString = str => {
      const splitedQuotes = str.replace(/'/g, `', "'", '`);
      return `concat('${splitedQuotes}', '')`;
    };

    /*
     * specify element to return by exact text within the element (text must be unique,
     * element must be present, or an error will be thrown).
     */
    this.page.elementWithText = async text => {
      const escapedText = escapeXpathString(text);
      const linkHandlers = await this.page.$x(
        `//*[text()[contains(., ${escapedText})]]`,
      );
      if (linkHandlers.length === 1) {
        return linkHandlers[0];
      } else if (linkHandlers.length > 1) {
        throw new Error(
          `Ambiguous click command, ${linkHandlers.length} elements with text "${text}" found.`,
        );
      } else {
        throw new Error(`No elements with text "${text}" found.`);
      }
    };
    /*
     * return all elements with given text
     */
    this.page.allElementsWithText = async text => {
      const escapedText = escapeXpathString(text);
      return this.page.$x(`//*[text()[contains(., ${escapedText})]]`);
    };
    /*
     * specify exact coordinates to click within element, fraction between -1 and 1 is
     * treated like pecentage, numbers outside that range are treated as whole pixel
     * offsets.
     */
    this.page.clickWithinElement = async options => {
      const boundingBox = await options.element.boundingBox();
      const xOffset =
        Math.abs(options.offset.x) < 1
          ? (boundingBox.width / 2) * options.offset.x
          : options.offset.x;
      const yOffset =
        Math.abs(options.offset.y) < 1
          ? (boundingBox.height / 2) * options.offset.y
          : options.offset.y;
      await this.page.mouse.click(
        boundingBox.x + boundingBox.width / 2 + xOffset,
        boundingBox.y + boundingBox.height / 2 + yOffset,
      );
    };
    /*
     * wait until at least one instance of element with text exists on the page.
     */
    this.page.waitForElementWithText = async text => {
      const escapedText = escapeXpathString(text);
      return this.page.waitForXPath(`//*[text()[contains(., ${escapedText})]]`);
    };
    /*
     * wait a user-specified number of milliseconds before continuing
     */
    this.page.wait = async ms => {
      return new Promise(resolve => setTimeout(resolve, ms));
    };
    /*
     * scrapes an element on the page into JSON or TEXT
     */
    this.page.scrape = async (element, format) => {
      if (format === 'json') {
        if (element._remoteObject.className === 'HTMLTableElement') {
          return await util.tableToJson(this.page, element);
        }
        // content = await this.page.evaluate(element => element.outerHTML, element);
        return await element.jsonValue();
      } else {
        return await this.page.evaluate(
          element => element.textContent,
          element,
        );
      }
    };
    /**
     * filter elements by combination of CSS, text, and XPath
     */
    const convenienceWrap = list => {
      list.click = async () => {
        if (list.length === 1) {
          return list[0].click();
        } else {
          throw new Error(
            `List has ${list.length} elements in it, click requires exactly 1.`,
          );
        }
      };
      return list;
    };
    this.page.filter = async options => {
      let cssSelected = options.css ? await this.page.$$(options.css) : null;
      let xpathSelected = options.xpath
        ? await this.page.$x(options.xpath)
        : null;
      let textSelected = options.text
        ? await this.page.allElementsWithText(options.text)
        : null;
      // clog('clog', cssSelected, xpathSelected, textSelected, options)
      return convenienceWrap(
        await util.intersection(
          await util.intersection(cssSelected, xpathSelected),
          textSelected,
        ),
      );
    };
  }

  // call this to shut down the drone
  async stop() {
    if (!this.browser) {
      throw new Error(
        'Browser has not been initialized, perhaps you forgot to run drone.start()?',
      );
    }
    await this.browser.close();
    this.writeConfig(this.baseDir, this.config);
  }

  // returns absolute path to directory for the build, if directory doesn't exist, it will be created
  getDir(build) {
    const absolutePath = path.join(this.baseDir, build);
    if (!fs.existsSync(absolutePath)) {
      fs.mkdirSync(absolutePath);
    }
    return absolutePath;
  }

  // call this to clean working directory
  cleanDir(dirpath) {
    const files = fs.readdirSync(dirpath);
    files.forEach(file => {
      fs.unlink(path.join(dirpath, file), e => {
        if (e) {
          console.log(
            `Error deleting "${file}" in "${dirpath}", failed to clean work directory.`,
          );
        }
      });
    });
  }

  // logic for reading build config
  readConfig(dirpath) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dirpath, 'config.json')));
    } catch (e) {
      return {
        resolutions: [
          // resolutions that will be tested
          {width: 1280, height: 800},
        ],
        cache: {}, // any variables we have cached
        tests: {}, // this empty hash is for failing gracefully if there are no previous entries
      };
    }
  }

  // logic for writing build config
  writeConfig(dirpath, data) {
    fs.writeFileSync(
      path.join(dirpath, 'config.json'),
      JSON.stringify(data, null, 2),
    );
  }

  // run this to execute a set of actions on the page
  async actions(logic, options = {}) {
    if (!this.browser) {
      throw new Error(
        'Browser has not been initialized, perhaps you forgot to run drone.start()?',
      );
    }

    // caching of actions result to improve drone performance and minimize harm to the webs
    if (options.cache) {
      if (typeof options.cache !== 'string') {
        // in case someone tries to use it as a boolean
        throw new Error(
          'cache parameter must be a string (a key to cache the data under).',
        );
      }

      return new Promise(async (resolve, reject) => {
        try {
          if (!(options.cache in this.config.cache)) {
            this.config.cache[options.cache] = await logic(this.page);
          }
          resolve(this.config.cache[options.cache]);
        } catch (e) {
          reject(e);
        }
      });
    }
    return logic(this.page);
  }
}

/*
 * Automation subclass for UI testing
 */
class TestDrone extends Drone {
  constructor() {
    if (!global.it) {
      throw new Error(
        'TestDrone must be run from within a test framework (Jest, Mocha, Jasmine, etc.)',
      );
    }
    super();

    this.goldenDir = null;
    this.goldenConfig = null;

    this.currentDir = null;
    this.currentConfig = null;
  }

  // detect which test framework is running (Mocha, Jest, Jasmine, etc.)
  detectFramework() {
    const launcher = process.env._;
    return path.basename(launcher);
  }

  // creates an image name from string
  getImageName(name) {
    return name.replace(/\s/g, '_') + '.png';
  }

  async start(options = {}) {
    await super.start(options);

    this.currentDir = this.getDir('current');
    this.goldenDir = this.getDir('last_successful');
    this.cleanDir(this.currentDir);
    this.failedTests = 0;

    // initialize directories and config
    this.currentConfig = {
      tests: {
        /* expected test times will be placed here */
      },
    };
    this.goldenConfig = this.readConfig(this.goldenDir);
    this.config = this.goldenConfig; // override original config location (for Drone.actions)
  }

  // actual test
  test(name, options) {
    const timeout = options.timeout || this.defaultTimeout;
    const imageName = this.getImageName(name);

    // load time test
    const definition = it(
      name,
      async () => {
        if (!this.page) {
          throw new Error(
            'Browser has not been initialized, perhaps you forgot to run drone.start()?',
          );
        }
        let expectedDuration =
          options.duration || this.goldenConfig.tests[name] || 2000;
        const goldenImage = path.join(this.goldenDir, imageName);
        const workImage = path.join(this.currentDir, imageName);
        return new Promise(async (resolve, reject) => {
          const start = Date.now();
          options.actions && (await options.actions(this.page));
          if (options.waitFor) {
            // wait until desired element is loaded
            await this.page.waitForSelector(options.waitFor, {
              timeout: timeout,
            });
          }
          const operationDuration = Date.now() - start;
          this.currentConfig.tests[name] = operationDuration;

          // hide elements we don't want
          if (options.ignore) {
            await this.page.evaluate(elementsToOmit => {
              elementsToOmit.forEach(selector => {
                let elements = document.querySelectorAll(selector);
                elements.forEach(
                  element => (element.style.visibility = 'hidden'),
                );
              });
            }, options.ignore);
          }

          await this.page.screenshot({path: workImage});

          try {
            const img1 = PNG.sync.read(fs.readFileSync(goldenImage));
            const img2 = PNG.sync.read(fs.readFileSync(workImage));
            const {width, height} = img1;
            const diff = new PNG({width, height});
            const pixelCountDiff = pixelmatch(
              img1.data,
              img2.data,
              diff.data,
              width,
              height,
              {threshold: 0.1},
            );
            const diffImageName = this.getImageName(name + '-diff');
            fs.writeFileSync(
              path.join(this.currentDir, diffImageName),
              PNG.sync.write(diff),
            );

            try {
              expect(pixelCountDiff).to.be(0);

              if (operationDuration > expectedDuration * 1.2) {
                this.failedTests++;
                reject(
                  new Error(
                    `Operation took ${operationDuration}ms, expected to take around ${expectedDuration}ms.`,
                  ),
                );
              } else {
                resolve();
              }
            } catch (e) {
              this.failedTests++;
              reject(
                new Error(
                  `Actual differs from expected by ${pixelCountDiff} pixels (see ${diffImageName}).`,
                ),
              );
            }
          } catch (e) {
            if (e.code === 'ENOENT' && e.path === goldenImage) {
              // this is the first time we're running this test, pass
              // this also has the benefit of bypassing initial duration limit, allowing this test to dictate the duration
              resolve();
            } else {
              this.failedTests++;
              reject(e);
            }
          }
        }).catch(async e => {
          // document this failure, grab image for investigation and rethrow
          if (!this.currentConfig.tests[name]) {
            this.currentConfig.tests[name] = 'TIMEOUT';
          }
          await this.page.screenshot({path: workImage});
          throw e;
        });
      },
      timeout,
    ); // for jest and jasmine

    // for mocha
    if (definition.timeout instanceof Function) {
      definition.timeout(timeout);
    }
  }

  async stop() {
    await super.stop();

    // show test metrics
    console.table(
      Object.keys(this.currentConfig.tests).map(testName => {
        return {
          '\ntest': testName,
          'previous (ms)': this.goldenConfig.tests[testName],
          'current (ms)': this.currentConfig.tests[testName],
        };
      }),
    );

    if (!this.failedTests) {
      // all tests pass, nominate current run as the new golden
      Object.keys(this.currentConfig.tests).forEach(test => {
        const imageName = this.getImageName(test);
        fs.rename(
          path.join(this.currentDir, imageName),
          path.join(this.goldenDir, imageName),
          e => {
            if (e) {
              console.log(
                `Error moving image "${imageName}" to golden directory "${goldenDir}".`,
              );
            }
          },
        );
      });
      writeConfig(this.goldenDir, {
        ...this.goldenConfig,
        ...this.currentConfig,
      });
    } else {
      console.log(`${this.failedTests} tests failed.`);
    }
  }
}

/*
 * Automation subclass for web-scraping
 */
class ScrapeDrone extends Drone {}

module.exports = {
  Drone,
  TestDrone,
  ScrapeDrone,
};
