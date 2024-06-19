require('console.table');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const fs = require('fs');
const path = require('path');
const expect = require('expect.js');
const StateMachine = require('./src/state_machine');
const Page = require('./src/page');
const util = require('./src/utilities');

puppeteer.use(StealthPlugin())

/*
 * Base class for puppeteer-powered browsing automation library.
 */
class Drone {

  constructor() {
    // general properties
    this.browser = null;
    this.page = null;
    this.defaultTimeout = 30000;
    this.baseDir = __dirname;
    this.fsm = new StateMachine();

    // State Machine Run Log
    this.runLog = [];
  }

  // build the state machine in a single definition instead of having to call the methods in the right order
  stateMachine(definition) {

    // require all states to have test logic and transitions
    for (let stateName in definition) {
      if (!definition[stateName].test || typeof definition[stateName].test !== 'function') {
        throw new Error(`State "${stateName}" doesn't define a test function.`);
      }
      if (!definition[stateName].transitions || !Object.keys(definition[stateName].transitions).length) {
        throw new Error(`State "${stateName}" doesn't define any transitions.`);
      }
    }

    // add states
    for (let stateName in definition) {
      // if params are present, then create a meta-state, otherwise create a basic state
      if (definition[stateName].params) {
        this.addMetaState(stateName, definition[stateName].params, definition[stateName].test);
      } else {
        this.addState(stateName, definition[stateName].test);
      }
    }

    // add transitions
    let defaultTransitionPresent = false;
    for (let stateName in definition) {
      for (let fromState in definition[stateName].transitions) {
        let cost = 1
        let logic
        if (typeof definition[stateName].transitions[fromState] === 'function') {
          logic = definition[stateName].transitions[fromState]
        } else {
          logic = definition[stateName].transitions[fromState].logic
          cost = definition[stateName].transitions[fromState].cost || 1
        }
        if (!test) {
          throw new Error(`Transition from "${fromState}" to "${stateName}" doesn't define the logic for performing the transition.`);
        }
        if (fromState === '*') {
          defaultTransitionPresent = true;
          this.addDefaultStateTransition(stateName, test, cost);
        } else {
          this.addStateTransition(fromState, stateName, test, cost);
        }
      }
    }
    if (!defaultTransitionPresent) {
      throw new Error('At least one default (*) transition is required to recover from bad states.');
    }
  }

  // call this to setup and start the drone
  async start(options = {}) {
    // general setup
    this.browser = await puppeteer.launch(options);
    this.page = new Page(await this.browser.newPage());
    this.defaultTimeout = options.defaultTimeout
      ? options.defaultTimeout
      : this.defaultTimeout;
    this.baseDir = options.baseDirectory ? options.baseDirectory : this.baseDir;
    this.config = this.readConfig(this.baseDir);
    await this.page.setViewport(options.viewport || this.config.resolutions[0]);

    if (options.debug) {
      this.debug = options.debug;
      console.log('Base directory:', this.baseDir)
      console.log('Config:', this.config)
    }
  }

  // 
  async disableAssetsFromLoading() {
    if (!this.page) {
      throw new Error(
        'Page has not been initialized, perhaps you forgot to run drone.start()?',
      );
    }

    await this.page.setRequestInterception(true)
    this.page.on('request', (request) => {
      if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    })
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
    this.writeRunLog(this.baseDir);
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

  writeRunLog(dirpath) {
    const date = new Date();
    fs.writeFileSync(
      path.join(dirpath, `run-log-${date}.json`),
      JSON.stringify(this.runLog, null, 2),
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
          const logEntry = {
            type: 'error',
            error: e.stack,
          }
          try {
            const errorImage = path.join(this.baseDir, 'latest-error.png')
            await this.page.screenshot({path: errorImage, fullPage: true})
            logEntry.screenshot = errorImage
            console.error(e.message)
            console.error(`Screenshot saved to ${errorImage}`)
          } catch (e1) {
            // if we fail w/ screenshot, this wasn't a UI error to begin with (e.g. proxy, connection, etc.)
            console.error('No screenshot available...')
          }
          this.runLog.push(logEntry);
          this.writeRunLog(this.baseDir);
          reject(e);
        }
      });
    }

    // not using cache
    try {
      return await logic(this.page);
    } catch (e) {
      const logEntry = {
        type: 'error',
        error: e.stack,
      }
      try {
        const errorImage = path.join(this.baseDir, 'latest-error.png')
        await this.page.screenshot({path: errorImage, fullPage: true})
        logEntry.screenshot = errorImage
        console.error(e.message)
        console.error(`Screenshot saved to ${errorImage}`)
      } catch (e1) {
        // if we fail w/ screenshot, this wasn't a UI error to begin with (e.g. proxy, connection, etc.)
        console.error('No screenshot available...')
      }
      this.runLog.push(logEntry);
      this.writeRunLog(this.baseDir);
      throw e
    }
  }
    
  // state-machine logic

  // define a state name and test criteria that must be true to determine whether
  // we're already in this state.
  addState(stateName, testCriteriaCallback) {
    this.fsm.addState(stateName, testCriteriaCallback);
  }

  // define a meta-state that has parameters (i.e. logged in, but with different user)
  addMetaState(stateName, addMetaState, testCriteriaCallback) {
    this.fsm.addMetaState(stateName, params, testCriteriaCallback);
  }

  // define a composite state (a modifier for base state, i.e. logged in)
  addCompositeState(stateFields, baseStateList, testCriteriaCallback) {
    this.fsm.addCompositeState(stateFields, baseStateList, testCriteriaCallback);
  }

  // define default composite state (composite state that applies itself to all base states that do not yet have a composite state at this layer)
  addDefaultCompositeState(stateFields, testCriteriaCallback) {
    this.fsm.addDefaultCompositeState(stateFields, testCriteriaCallback);
  }

  // define transition from startState to endState, optionally define cost (default = 1)
  // the algorithm will prefer transitions with cheaper cost
  addStateTransition(startState, endState, transitionLogicCallback, cost = 1) {
    this.fsm.addStateTransition(startState, endState, transitionLogicCallback, cost);
  }

  // define meta-state transition
  addMetaStateTransition(startState, endState, transitionLogicCallback, cost = 1) {
    this.fsm.addMetaStateTransition(startState, endState, transitionLogicCallback, cost);
  }

  // define transition that is guaranteed to get us to this endState regardless of where
  // we currently are (i.e. unknown state)
  addDefaultStateTransition(endState, transitionLogicCallback, cost = 1) {
    this.fsm.addDefaultStateTransition(endState, transitionLogicCallback, cost);
  }

  addCompositeStateTransition(startState, endState, transitionLogicCallback, cost = 1) {
    this.fsm.addCompositeStateTransition(startState, endState, transitionLogicCallback, cost);
  }

  // perform this logic whenever we enter this state
  onState(stateName, logicCallback) {
    this.fsm.onState(stateName, logicCallback);
  }

  // logic to track state interaction for debugging purposes (State Machine Run Log)
  _onStateEnter(stateName) {
    if (this.debug) {
      const index = this.runLog.length;
      const screenshot = path.join(this.baseDir, `${index}_${stateName}.png`);

      const logEntry = {
        type: 'state load',
        stateName,
        screenshot,
      }
      this.runLog.push(logEntry);
    }
  }

  // figures out current base state and returns its name to the user, returns null if no states match
  async whereAmI() {
    return this.fsm.getCurrentState(this.page);
  }

  // same as above, but returns all layers
  async detailedWhereAmI() {
    return this.fsm.getCurrentStateDetail(this.page);
  }

  // computes shortest path to desired state using Dijkstra's algorithm.
  async findPathToState(stateName, params) {
    const currentState = await this.whereAmI();
    return this.fsm.findPathToState(currentState, this.fsm.currentParams, stateName, params);
  }

  // traverses a given path
  async traversePath(path, retries, params) {
    return this.fsm.traversePath(path, retries, this.page, params);
  }

  // navigates to correct state if we're not already in that state,
  // then (optionally) performs user-requested actions, and returns the result.
  // if navigation is impossible, throws an error.
  async ensureState(stateName, params, actions, retries = 3) {
    const path = await this.findPathToState(stateName, params);
    await this.traversePath(path, retries, params);
    if (typeof actions === 'function') {
      return await actions(this.page, params);
    }
  }

  // similar to above, but is satisfied by more than one state, note that it prefers the state with the shortest path
  async ensureEitherState(stateList, params, actions, retries = 3) {
    let cheapestCost = Infinity, cheapestPath = null, cheapestState;
    for (const state of stateList) {
      try {
        const path = await this.findPathToState(state, params);
        const cost = path.reduce((cost, transition) => {
          const [start, end] = transition;
          return cost + this.fsm.neighbors[start][end].cost
        }, 0);
        if (cost < cheapestCost) {
          cheapestCost = cost;
          cheapestPath = path;
          cheapestState = state;
        }
      } catch (err) {
        if (!/No route exists/.test(err)) {
          throw err;
        }
      }
    }

    if (!cheapestPath) {
      throw new Error(`No route exists from "${this.whereAmI()}" (current state) to either of requested states: ${stateList.join(', ')}`);
    }
    await this.traversePath(cheapestPath, retries, params);
    if (typeof actions === 'function') {
      return await actions(this.page, this.params, cheapestState);
    }
  }


  // returns a shuffled copy of the list
  shuffle(list) {
    list = list.slice(); // make a copy
    for (let i1 = list.length - 1; i1 > 0; i1--) {
      const i2 = Math.floor(Math.random() * (i1 + 1));
      const temp = list[i1];
      list[i1] = list[i2];
      list[i2] = temp;
    }
    return list;
  }

  // compares two images on disk
  diffImage(workImage, goldenImage, diffImage) {
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
      fs.writeFileSync(
        diffImage,
        PNG.sync.write(diff),
      );

      return pixelCountDiff;
    } catch (e) {
      if (e.code === 'ENOENT' && e.path === goldenImage) {
        // this is the first time we're running this test, return null
        return null;
      } else {
        throw e;
      }
    }
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
          throw new Error('Browser has not been initialized, perhaps you forgot to run drone.start()?');
        }
        let expectedDuration = options.duration || this.goldenConfig.tests[name] || 2000;
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
          const diffImage = path.join(this.currentDir, this.getImageName(name + '-diff'));

          try {
            let pixelCountDiff = this.diffImage(workImage, goldenImage, diffImage);
            if (pixelCountDiff === null) {
              // first time we're running this test
              resolve();
            } else {
              try {
                expect(pixelCountDiff).to.be(0);

                if (operationDuration > expectedDuration * 1.2) {
                  this.failedTests++;
                  reject(
                    new Error(`Operation took ${operationDuration}ms, expected to take around ${expectedDuration}ms.`),
                  );
                } else {
                  resolve();
                }
              } catch (e) {
                this.failedTests++;
                reject(
                  new Error(`Actual differs from expected by ${pixelCountDiff} pixels (see ${diffImageName}).`),
                );
              }
            }
          } catch (e) {
            // an error occurred while comparing images
            this.failedTests++;
            reject(e);
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

  testAllStates(params, order) {
    const stateDir = this.getDir('current/states');
    let testOrder = order || this.shuffle(this.states);
    let testedTransitions = {};

    /*
     * idea:
     * traverse all states in random order, for each state:
     * - capture any transition errors and fail test if any occur (making sure we end up in correct state is part of this)
     * - take screenshot and note transition that got us here
     * - if we already traversed this state, compare screenshots (fail if they don't match)
     * - (bonus) if current page/state satisfies more than 1 state test, give a warning
     * - (bonus) compare screenshots with last run for this state (fail if they don't match)
     *
     * for any state transitions that haven't been traversed, go to start state and test them as well
     */

    for (let state of testOrder) {
      const thisStateDir = this.getDir(`${stateDir}/${state.replace(/ /g, '\\ ')}`);
      const definition = it(
        `state navigation: ${state}`,
        async () => {
          if (!this.page) {
            throw new Error('Browser has not been initialized, perhaps you forgot to run drone.start()?');
          }

          return new Promise(async (resolve, reject) => {
            try {
              const pathToState = this.findPathToState(state);
              for (let transition in pathToState) {
                const [start, end] = transition;
                if (!testedTransitions[start]) {
                  testedTransitions[start] = {};
                }
                testedTransitions[start][end] = true;
              }
              await this.ensureState(state, async (page) => {
                // state successfully loaded
                const stateScreenshot = path.join(thisStateDir, pathToState[pathToState.length - 1] + '.png');
                await page.screenshot({path: stateScreenshot});
                // let pixelCountDiff = this.diffImage(startScreenshot, goldenImage, diffImage);
              });
            } catch (e) {
              // couldn't navigate to this state
              this.failedTests++;
              reject(e);
            }
          });
        },
        timeout,
      ); // for jest and jasmine

      // for mocha
      if (definition.timeout instanceof Function) {
        definition.timeout(timeout);
      }
    }

    // now run through remaining untested transitions
    for (let start of Object.keys(this.neighbors)) {
      for (let end of Object.keys(this.neighbors[start])) {
        const thisStateDir = this.getDir(`${stateDir}/${start.replace(/ /g, '\\ ')}`);
        if (testedTransitions[start][end]) {
          it(`transition navigation: ${start} >> ${end} (tested with states)`, () => {
            return;
          });
        } else {
          // untraversed transition
          const definition = it(
            `transition navigation: ${start} >> ${end}`,
            async () => {
              if (!this.page) {
                throw new Error('Browser has not been initialized, perhaps you forgot to run drone.start()?');
              }

              await ensureState(start, async (page) => {
                const transition = `${start} >> ${end}`;
                const stateScreenshot = path.join(thisStateDir, transition + '.png');
                await this.traversePath([start, end], 3);
                await page.screenshot({ path: stateScreenshot });
              });
            },
            timeout,
          ); // for jest and jasmine

          // for mocha
          if (definition.timeout instanceof Function) {
            definition.timeout(timeout);
          }
        }
      }
    }

    // now test images
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
