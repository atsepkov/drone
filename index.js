require('console.table');
const puppeteer = require('puppeteer');
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const fs = require('fs');
const path = require('path');
const expect = require('expect.js');

const DEFAULT_TIMEOUT = 30000;

// initialize directories and config
const workDir = getDir('current');
const goldenDir = getDir('last_successful');
const workConfig = {
  tests: {
    /* expected test times will be placed here */
  },
};
const goldenConfig = readConfig(goldenDir) || {
  resolutions: [
    // resolutions that will be tested
    {width: 1280, height: 800},
  ],
  tests: {}, // this empty hash is for failing gracefully if there are no previous entries
};
cleanDir(workDir);

// setup
let browser;
let page;
let defaultTimeout = DEFAULT_TIMEOUT;

if (!global.it) {
  throw new Error(
    'Drone module must be run from within a test framework (Jest, Mocha, Jasmine, etc.)',
  );
}

const getImageName = name => {
  return name.replace(/\s/g, '_') + '.png';
};

const setup = async options => {
  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  page = await browser.newPage();
  await page.setViewport(
    options.viewport || {
      width: 1280,
      height: 800,
    },
  );
  if (options.defaultTimeout) {
    defaultTimeout = options.defaultTimeout;
  }

  pageEnhancements.forEach(f => (page[f.name] = f));
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
  const absolutePath = path.join(__dirname, build);
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
  async function clickElementWithText(text) {
    const escapedText = escapeXpathString(text);
    const linkHandlers = await this.$x(`//a[contains(text(), ${escapedText})]`);
    if (linkHandlers.length === 1) {
      await linkHandlers[0].click();
    } else if (linkHandlers.length > 1) {
      throw new Error(
        `Ambiguous click command, ${linkHandlers.length} elements with text "${text}" found.`,
      );
    } else {
      throw new Error(`No elements with text "${text}" found.`);
    }
  },
];

// actual test
const testFunction = (name, options) => {
  const timeout = options.timeout || defaultTimeout;
  const expectedDuration = 2000;
  const imageName = getImageName(name);
  const goldenImage = path.join(goldenDir, imageName);
  const workImage = path.join(workDir, imageName);

  // load time test
  const definition = it(
    name,
    async () => {
      if (!page) {
        throw new Error(
          'Browser has not been initialized, perhaps you forgot to run drone.setup()?',
        );
      }
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
                `Actual differs from golden by ${pixelCountDiff} pixels (see ${diffImageName}).`,
              ),
            );
          }
        } catch (e) {
          if (e.code === 'ENOENT' && e.path === goldenImage) {
            // this is the first time we're running this test, pass
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
