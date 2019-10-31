require('console.table');
const puppeteer = require('puppeteer');
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const fs = require('fs');
const path = require('path');
const expect = require('expect.js');

const DEFAULT_TIMEOUT = 30000;

// setup
let browser;
let page;
let workDir;
let goldenDir;
let defaultTimeout = DEFAULT_TIMEOUT; // default timeout for all tests
let testDir = __dirname; // main test directory
let workConfig;
let goldenConfig;

if (!global.it) {
  throw new Error(
    'Drone module must be run from within a test framework (Jest, Mocha, Jasmine, etc.)',
  );
}

const getImageName = name => {
  return name.replace(/\s/g, '_') + '.png';
};

const setup = async (options = {}) => {
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  page = await browser.newPage();
  pageEnhancements.forEach(f => (page[f.name] = f));

  await page.setViewport(
    options.viewport || {
      width: 1280,
      height: 800,
    },
  );
  if (options.defaultTimeout) {
    defaultTimeout = options.defaultTimeout;
  }
  if (options.testDirectory) {
    testDir = options.testDirectory;
  }
  workDir = getDir('current');
  goldenDir = getDir('last_successful');
  cleanDir(workDir);

  // initialize directories and config
  workConfig = {
    tests: {
      /* expected test times will be placed here */
    },
  };
  goldenConfig = readConfig(goldenDir) || {
    resolutions: [
      // resolutions that will be tested
      {width: 1280, height: 800},
    ],
    tests: {}, // this empty hash is for failing gracefully if there are no previous entries
  };
};

let failedTests = 0;
const teardown = async () => {
  if (!browser) {
    throw new Error(
      'Browser has not been initialized, perhaps you forgot to run drone.setup()?',
    );
  }
  await browser.close();

  // show test metrics
  console.table(
    Object.keys(workConfig.tests).map(testName => {
      return {
        '\ntest': testName,
        'previous (ms)': goldenConfig.tests[testName],
        'current (ms)': workConfig.tests[testName],
      };
    }),
  );

  if (!failedTests) {
    // all tests pass, nominate current run as the new golden
    Object.keys(workConfig.tests).forEach(test => {
      const imageName = getImageName(test);
      fs.rename(
        path.join(workDir, imageName),
        path.join(goldenDir, imageName),
        e => {
          if (e) {
            console.log(
              `Error moving image "${imageName}" to golden directory "${goldenDir}".`,
            );
          }
        },
      );
    });
    workConfig.resolutions = goldenDir.resolutions;
    writeConfig(goldenDir, workConfig);
  } else {
    console.log(`${failedTests} tests failed.`);
  }
};

// returns absolute path to directory for the build, if directory doesn't exist, it will be created
function getDir(build) {
  const absolutePath = path.join(testDir, build);
  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath);
  }
  return absolutePath;
}

// cleans working directory
function cleanDir(dirpath) {
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
function readConfig(dirpath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dirpath, 'config.json')));
  } catch (e) {
    return undefined;
  }
}

// logic for writing build config
function writeConfig(dirpath, data) {
  fs.writeFileSync(
    path.join(dirpath, 'config.json'),
    JSON.stringify(data, null, 2),
  );
}

// framework detection
function detectFramework() {
  const launcher = process.env._;
  return path.basename(launcher);
}

// convenience methods for drone to make testing easier
const escapeXpathString = str => {
  const splitedQuotes = str.replace(/'/g, `', "'", '`);
  return `concat('${splitedQuotes}', '')`;
};
const pageEnhancements = [
  /*
   * specify element to return by exact text within the element (text must be unique,
   * element must be present, or an error will be thrown).
   */
  async function elementWithText(text) {
    const escapedText = escapeXpathString(text);
    const linkHandlers = await this.$x(`//a[contains(text(), ${escapedText})]`);
    if (linkHandlers.length === 1) {
      return linkHandlers[0];
    } else if (linkHandlers.length > 1) {
      throw new Error(
        `Ambiguous click command, ${linkHandlers.length} elements with text "${text}" found.`,
      );
    } else {
      throw new Error(`No elements with text "${text}" found.`);
    }
  },
  /*
   * return all elements with given text
   */
  async function allElementsWithText(text) {
    const escapedText = escapeXpathString(text);
    const linkHandlers = await this.$x(`//a[contains(text(), ${escapedText})]`);
    return linkHandlers;
  },
  /*
   * specify exact coordinates to click within element, fraction between -1 and 1 is
   * treated like pecentage, numbers outside that range are treated as whole pixel
   * offsets.
   */
  async function clickWithinElement(options) {
    const boundingBox = await options.element.boundingBox();
    const xOffset =
      Math.abs(options.offset.x) < 1
        ? (boundingBox.width / 2) * options.offset.x
        : options.offset.x;
    const yOffset =
      Math.abs(options.offset.y) < 1
        ? (boundingBox.height / 2) * options.offset.y
        : options.offset.y;
    await page.mouse.click(
      boundingBox.x + boundingBox.width / 2 + xOffset,
      boundingBox.y + boundingBox.height / 2 + yOffset,
    );
  },
];

// actual test
const testFunction = (name, options) => {
  const timeout = options.timeout || defaultTimeout;
  const imageName = getImageName(name);

  // load time test
  const definition = it(
    name,
    async () => {
      if (!page) {
        throw new Error(
          'Browser has not been initialized, perhaps you forgot to run drone.setup()?',
        );
      }
      let expectedDuration =
        options.duration || goldenConfig.tests[name] || 2000;
      const goldenImage = path.join(goldenDir, imageName);
      const workImage = path.join(workDir, imageName);
      return new Promise(async (resolve, reject) => {
        const start = Date.now();
        options.actions && (await options.actions(page));
        if (options.waitFor) {
          // wait until desired element is loaded
          await page.waitForSelector(options.waitFor, {
            timeout: timeout,
          });
        }
        const operationDuration = Date.now() - start;
        workConfig.tests[name] = operationDuration;

        // hide elements we don't want
        if (options.ignore) {
          await page.evaluate(elementsToOmit => {
            elementsToOmit.forEach(selector => {
              let elements = document.querySelectorAll(selector);
              elements.forEach(
                element => (element.style.visibility = 'hidden'),
              );
            });
          }, options.ignore);
        }

        await page.screenshot({path: workImage});

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
          const diffImageName = getImageName(name + '-diff');
          fs.writeFileSync(
            path.join(workDir, diffImageName),
            PNG.sync.write(diff),
          );

          try {
            expect(pixelCountDiff).to.be(0);

            if (operationDuration > expectedDuration * 1.2) {
              failedTests++;
              reject(
                new Error(
                  `Operation took ${operationDuration}ms, expected to take around ${expectedDuration}ms.`,
                ),
              );
            } else {
              resolve();
            }
          } catch (e) {
            failedTests++;
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
            failedTests++;
            reject(e);
          }
        }
      }).catch(async e => {
        // document this failure, grab image for investigation and rethrow
        if (!workConfig.tests[name]) {
          workConfig.tests[name] = 'TIMEOUT';
        }
        await page.screenshot({path: workImage});
        throw e;
      });
    },
    timeout,
  ); // for jest and jasmine

  // for mocha
  if (definition.timeout instanceof Function) {
    definition.timeout(timeout);
  }
};

module.exports = {
  setup,
  teardown,
  test: testFunction,
};
