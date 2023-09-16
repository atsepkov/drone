require('console.table');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const pixelmatch = require('pixelmatch');
const PNG = require('pngjs').PNG;
const fs = require('fs');
const path = require('path');
const expect = require('expect.js');
const util = require('./util');

puppeteer.use(StealthPlugin())

const BAD_STATE = '< INVALID STATE >';

/*
 * Base class for puppeteer-powered browsing automation library.
 */
class Drone {

  /* TYPE ANNOTATIONS
  
  interface StateFragment: {
    [layerName: string]: string
  }
  
  interface State: {
    base: string
    ...StateFragment
  }

  interface StateDependency {
    dependency: StateFragment
    baseStateList: string[]
  }
  
  type TestFunction = async (page: puppeteer.Page, params: { [param: key]: any }) => boolean
  type TransitionFunction = async (page: puppeteer.Page, params: { [param: key]: any }) => void
  
  browser: puppeteer.Browser
  page: puppeteer.Page
  defaultTimeout: number
  baseDir: string

  stateTests: {
    [stateName: string]: TestFunction
  }

  states: { [priority: number]: string }
  
  neighbors: { [startState: string]: { [endState: string]: {
    cost: number,
    logic: (page: puppeteer.Page, params: { [param: key]: any }) => void
  } } }

  currentState: string | null

  compositeFragments: {
    [stringifiedName: string]: {
      stateFields: StateFragment,
      baseStateList: string[]
    }
  }

  fragmentTransitions: { [startState: string]: { [endState: string]: {
    cost: number,
    logic: TransitionFunction
  } } }

  layers: {
    [layerName: string]: {
      [stateName: string]: {
        baseStateList: string[],
        testCriteriaCallback: TestFunction,
        dependencies: StateDependency[]
      }
    }
  }

  compositeStates: State[]

  compositeTransitions: { [startState: string]: { [endState: string]: {
    cost: number,
    logic: TransitionFunction
  } } }

  occlusions: {
    [layerName: string]: StateFragment[]
  }

  lastKnown: StateFragment | State

  */

  constructor() {
    // genreal properties
    this.browser = null;
    this.page = null;
    this.defaultTimeout = 30000;
    this.baseDir = __dirname;

    // state machine properties
    this.stateTests = {};           // possible base states the system is aware of
    this.states = [];               // states by priority, states defined earlier on have higher test priority
    this.neighbors = {};            // base state transitions the system is aware of,  used by Dijsktra's algorithm to figure out how to traverse states
    this.currentState = null;       // used to 'cache' current state to speed up some operations

    // composite states;
    this.compositeFragments = {};   // tracks added fragments (to track duplicate declarations and base states)
    this.fragmentTransitions = {};  // transitions for composite layers
    this.layers = {};               // layers of composite states, each layer contains a set of states
    this.compositeStates = [];      // expanded composite states
    this.compositeTransitions = {}; // expanded composite state transitions
    
    // handling untestable states
    this.occlusions = {};           // list of occlusions for each state (while occluded, a state may be untestable)
    this.lastKnown = {};            // last known/cached states for each layer (used to track state through occlusons)
  }

  get baseStates() {
    return this.states.slice();
  }

  get statesInLayer() {
    const layers = Object.keys(this.layers);
    const statesByLayer = {};
    layers.forEach(layer => {
      statesByLayer[layer] = Object.keys(this.layers[layer]);
    });
    return statesByLayer;
  }

  // returns a list of expanded states that match passed in filter, if no filter is passed, returns all expanded states.
  allStates(filter) {
    this.computeCompositeStates();
    if (filter) {
      for (const layer of Object.keys(filter)) {
        if (layer !== 'base' && !this.layers[layer]) {
          throw new Error(`Compositing layer "${layer}" doesn't exist.`);
        }
      }
      return util.filterByLayer(this.compositeStates, filter);
    } else {
      return this.compositeStates.slice();
    }
  }

  get allTransitions() {
    this.computeCompositeTransitions();
    return this.compositeTransitions.slice();
  }

  // given a list of fragments (dependencies), checks that state satisfies at least one of them (by being its superstate)
  isDependencySatisfied(baseState, stateDependency, state) {
    const { dependencies, baseStateList } = stateDependency;
    if (!dependencies || !dependencies.length) {
      return baseStateList.includes(baseState); // no dependencies
    }

    for (const dep of dependencies) {
      if (dep.baseStateList.includes(baseState) && util.isSubstate(dep.dependency, state)) return true;
    }
    return false; // haven't found dep where all keys passed
  }

  // expands base states into composite states using layers
  computeCompositeStates() {
    let states = this.states.map(state => {
      return { base: state }
    });
    for (const [layer, layerStates] of Object.entries(this.layers)) { // loop through compositing layers
      let newStates = [];
      for (const state of states) { // loop through semi-generated composite states
        let baseState = state.base;
        let stateUsed = false;
        for (const [stateLayer, stateDependency] of Object.entries(layerStates)) { // loop through all defined states for a given layer
          if (this.isDependencySatisfied(baseState, stateDependency, state)) {
            stateUsed = true;
            newStates.push({
              ...state,
              [layer]: stateLayer
            })
          }
        }
        if (!stateUsed) {
          throw new Error(`No composite state of type "${layer}" exists for base state "${baseState}".`)
        }
      }
      states = newStates;
    }
    this.compositeStates = states;
  }

  computeCompositeTransitions() {

  }

  getNeighbors(startState) {
    if (typeof startState === 'string') {
      if (!this.stateTests[startState]) {
        throw new Error(`"${startState}" is not a valid state.`);
      }
      return Object.keys(this.neighbors[startState] || {});
    } else {
      const startString = util.stateToString(startState);
      const nextStates = [];
      // for (const layer of [ 'base', ...Object.keys(this.layers) ]) { // loop through compositing layers
      //   if (!(layer in startState)) {
      //     throw new Error(`Composite state for layer "${layer}" is missing from ${startString}, getNeighbors() requires complete state.`);
      //   }
      // }

      if (!this.isValidState(startState)) {
        throw new Error(`${startString} is not a valid state.`);
      }

      let found = false;
      for (const fullState of this.allStates(startState)) {
        if (found) {
          throw new Error(`Multiple composite states match ${startString}, define more layers to resolve ambiguity.`)
        }
        found = true

        for (const stateString of Object.keys(this.fragmentTransitions)) {
          if (util.isSubstate(util.stringToState(stateString), fullState)) {
            // we do no verification for valid end state here, since we assume addCompositeStateTransition safety check already handles it
            for (const endStateString of Object.keys(this.fragmentTransitions[stateString])) {
              const endState = util.stringToState(endStateString);
              nextStates.push({
                ...startState,
                ...endState
              });
            }
          }
        }
      }
      return nextStates;
    }
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

    if (options.debug) {
      console.log('Base directory:', this.baseDir)
      console.log('Config:', this.config)
    }

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
    /**
     * start listening for json response to a request
     */
    this.page.onJsonResponse = async (url, response) => {
      // url can have wildcards
      const responseUrl = response.url();
      if (url.includes('*')) {
        const urlRegex = new RegExp(url.replace(/\*/g, '.*'));
        if (!urlRegex.test(responseUrl)) {
          return;
        }
      } else if (url !== responseUrl) {
        return;
      }

      const responseHeaders = response.headers();
      const contentType = responseHeaders['content-type'];
      if (!contentType || !contentType.includes('application/json')) {
        return;
      }

      const responseJson = await response.json();
      this.page.emit('jsonResponse', responseJson);
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
          const errorImage = path.join(baseDir, 'latest-error.png')
          await this.page.screenshot({path: errorImage})
          reject(e);
        }
      });
    }
    return logic(this.page);
  }
    
  // state-machine logic

  // define a state name and test criteria that must be true to determine whether
  // we're already in this state.
  addState(stateName, testCriteriaCallback) {
    if (stateName === BAD_STATE || stateName in this.stateTests) {
      throw new Error(`State "${stateName}" already exists, please use unique state names.`);
    }

    this.states.push(stateName);
    this.stateTests[stateName] = testCriteriaCallback;
  }

  // define a composite state (a modifier for base state, i.e. logged in)
  addCompositeState(stateFields, baseStateList, testCriteriaCallback) {
    const layers = Object.keys(stateFields);
    const stateString = util.stateToString(stateFields);
    if (Object.keys(this.compositeFragments).includes(stateString)) {
      throw new Error(`Composite state "${stateString}" already exists, please use unique state names.`);
    }
    this.compositeFragments[stateString] = { stateFields, baseStateList };

    let dependency = {}
    for (const layer of layers) {
      if (!this.layers[layer]) {
        this.layers[layer] = {};
      }
      const stateLayer = this.layers[layer];
      const stateField = stateFields[layer];
      if (!stateLayer[stateField]) {
        stateLayer[stateField] = {
          baseStateList,
          testCriteriaCallback,
          dependencies: []
        };
      } else {
        const orig = stateLayer[stateField].baseStateList;
        stateLayer[stateField].baseStateList = [...orig, ...baseStateList.filter(item => orig.indexOf(item) < 0)]
      }
      if (layers.length > 1) {
        if (Object.keys(dependency).length) {
          stateLayer[stateField].dependencies.push({ dependency, baseStateList })
        }
        // stack dependencies for next layer
        dependency = {...dependency, [layer]: stateField}
      }
      // console.log(layer, stateLayer, Object.values(stateLayer).map(a => a.dependencies))
    }
  }

  // define default composite state (composite state that applies itself to all base states that do not yet have a composite state at this layer)
  addDefaultCompositeState(stateFields, testCriteriaCallback) {
    const layers = Object.keys(stateFields);
    const baseStateList = this.states.filter(state => {
      for (const layer of layers) {
        for (let compositeState of Object.values(this.layers[layer])) {
          if (compositeState.baseStateList.includes(state)) {
            return false;
          }
        }
      }
      return true;
    });

    this.addCompositeState(stateFields, baseStateList, testCriteriaCallback);
  }

  // returns a list of side-effects (empty if none), that is all additional layer transitions that would be required
  // for this transition to be possible, this function tests 2 possible problems:
  // 1. not every superstate of startState has a corresponding endState superstate
  // 2. a single startState superstate resulting in multiple endState superstates
  testTransitionSideEffects(startState, endState) {
    const sideEffects = [];
    const allStates = this.allStates();
    const startSuperStates = allStates.filter(state => util.isSubstate(startState, state));
    const endSuperStates = allStates.filter(state => util.isSubstate(endState, state));

    const startSuperStatesUsed = {};
    startSuperStates.forEach(state => {
      const startSuperStateString = util.stateToString(state);
      const expectedEndState = {
        ...state,
        ...endState
      };
      const expectedEndStateString = util.stateToString(expectedEndState);
      for (const endSuperState of endSuperStates) {
        if (util.stateToString(endSuperState) === expectedEndStateString) {
          if (startSuperStatesUsed[startSuperStateString]) {
            sideEffects.push(
              `Can't traverse ${util.stateToString(startState)} to ${util.stateToString(endState)}. Multiple end states possible.`
            );
          } else {
            startSuperStatesUsed[startSuperStateString] = true;
          }
        }
      }
      if (!startSuperStatesUsed[startSuperStateString]) {
        sideEffects.push(
          `Can't traverse ${util.stateToString(startState)} to ${util.stateToString(endState)}. No end state exists for start state: ${startSuperStateString}.`
        );
      }
    });
    return sideEffects;
  }

  // Same as above, but tests if existing transitions create side-effects
  testStateSideEffects(fragment, baseStates) {
    const superStates = this.allStates().filter(state => util.isSubstate(startState, state));

  }

  // returns true if all superstates of startState can transition to all superstates of endState, false otherwise
  canTransitionWithoutSideEffects(startState, endState) {
    return this.findSideEffects(startState, endState) == null;
  }

  // define transition from startState to endState, optionally define cost (default = 1)
  // the algorithm will prefer transitions with cheaper cost
  addStateTransition(startState, endState, transitionLogicCallback, cost = 1) {

    if (!this.stateTests[startState]) {
      throw new Error(`Start state "${startState}" does not exist.`);
    } else if (!this.stateTests[endState]) {
      throw new Error(`End state "${endState}" does not exist.`);
    } else if (startState === endState) {
      throw new Error(`Trying to add transition from state to itself (${startState}).`);
    } else if (
      this.neighbors[startState] &&
      this.neighbors[startState][endState] &&
      this.neighbors[startState][endState].cost <= cost
    ) {
      const oldCost = this.neighbors[startState][endState].cost;
      throw new Error(`A cheaper path (cost = ${oldCost}) from "${startState}" to "${endState}" already exists.`);
    }

    let transition = {
      cost: cost,
      logic: transitionLogicCallback
    };
    if (!this.neighbors[startState]) {
      this.neighbors[startState] = {};
    }
    this.neighbors[startState][endState] = transition;

    const startString = util.stateToString({ base: startState });
    const endString = util.stateToString({ base: endState });

    if (!this.fragmentTransitions[startString]) {
      this.fragmentTransitions[startString] = {};
    }
    this.fragmentTransitions[startString][endString] = transition;
  }

  // define transition that is guaranteed to get us to this endState regardless of where
  // we currently are (i.e. unknown state)
  addDefaultStateTransition(endState, transitionLogicCallback, cost = 1) {

    if (!this.stateTests[endState]) {
      throw new Error(`End state "${endState}" does not exist.`);
    }

    let transition = {
      cost: cost,
      logic: transitionLogicCallback
    };
    if (!this.neighbors[BAD_STATE]) {
      this.neighbors[BAD_STATE] = {};
    }
    this.neighbors[BAD_STATE][endState] = transition;
  }

  // returns true if this state exists based on combination of state fragments, false otherwise
  isValidState(state) {
    let found = false;
    for (const existingState of this.allStates()) {
      if (util.isSubstate(state, existingState)) {
        found = true;
        break;
      }
    }
    return found;
  }

  addCompositeStateTransition(startState, endState, transitionLogicCallback, cost = 1) {
    const expandedEndStateFragment = { ...startState, ...endState };
    [startState, expandedEndStateFragment].forEach((requestedState, index) => {
      if (!this.isValidState(requestedState)) {
        throw new Error(`No generated state matches composite ${index ? 'end' : 'start'} state of ${util.stateToString(requestedState)}`);
      }
    })

    const startString = util.stateToString(startState);
    const endString = util.stateToString(endState);

    const transition = {
      cost: cost,
      logic: transitionLogicCallback
    }
    if (!this.fragmentTransitions[startString]) {
      this.fragmentTransitions[startString] = {};
    }
    if (this.fragmentTransitions[startString][endString] && this.fragmentTransitions[startString][endString].cost < cost) {
      const oldCost = this.fragmentTransitions[startString][endString].cost;
      throw new Error(`A cheaper path (cost = ${oldCost}) for ${startString} >> ${endString} transition already exists.`);
    }
    this.fragmentTransitions[startString][endString] = transition;
  }

  // figures out current state and returns its name to the user, returns null if no states match
  async whereAmI() {
    // if cached state is correct, return that
    if (this.currentState && await this.stateTests[this.currentState](this.page, this.params)) {
      return this.currentState;
    }

    // otherwise loop through all states to find the correct one
    for (const stateName of this.states) {
      if (await this.stateTests[stateName](this.page, this.params)) {
        return stateName;
      }
    }
    return null;
  }

  // similar to whereAmI, but returns all layers (a composite version of whereAmI)
  async getStateDetail() {
    const baseState = await this.whereAmI();
    const isCorrectState = (layer, state) => {
      if (state.baseStateList.includes(baseState)) {
        if (this._isLastKnownOccluded(layer)) {
          return true; // assume correct state if untestable
        }
        if (state.testCriteriaCallback(this.page, this.params)) {
          return true; // passed test
        }
      }
      return false;
    }

    const layers = {};
    for (const layer of this.layers) {
      const lastKnownStateName = this.lastKnown[layer];
      if (lastKnownStateName) { // state cache exists
        const lastKnownState = this.layers[layer][lastKnownStateName];
        if (isCorrectState(layer, lastKnownState)) {
          layers[layer] = lastKnownState;
        } else { // cache exists but is wrong
          let foundState = false;
          for (const stateName of this.layers[layer]) {
            const state = this.layers[layer][stateName];
            if (isCorrectState(layer, state)) {
              layers[layer] = stateName;
              foundState = true;
            }
          }
          if (!foundState) {
            throw new Error(`Unable to determine state for "${layer}" layer and last known state of "${lastKnownStateName}" failed test.`);
          }
        }
      } else { // no state cache, need to figure out the state
        let foundState = false;
        for (const stateName of this.layers[layer]) {
          const state = this.layers[layer][stateName];
          if (isCorrectState(layer, state)) {
            layers[layer] = stateName;
            foundState = true;
          }
        }
        if (!foundState) {
          throw new Error(`Unable to determine state for "${layer}" layer, no last known state exists.`);
        }
      }
    }
    return layers;
  }

  addStateOcclusion(layerName, stateList) {
    this.occlusions[layerName] = stateList;
  }

  async _isLastKnownOccluded(layerName) {
    const lastKnownState = {
      base: this.currentState,
      ...this.lastKnown
    }
    for (const occlusion of this.occlusions[layerName]) {
      if (util.isSubstate(occlusion, lastKnownState)) {
        return true;
      }
    }
    return false;
  }

  async isOccluded(layerName) {
    for (const occlusion of this.occlusions[layerName]) {
      if (util.isSubstate(occlusion, await this.getStateDetail())) {
        return true;
      }
    }
    return false;
  }

  // computes shortest path to desired state using Dijkstra's algorithm.
  async findPathToState(stateName) {
    if (!this.states.includes(stateName)) {
      throw new Error(`Unknown state: "${stateName}", you must add this state to Drone first.`)
    }
    let startState = await this.whereAmI() || BAD_STATE;
    if (!this.neighbors[startState]) {
      startState = BAD_STATE; // legit state, but no path exists out of it
    }
    if (startState === stateName) {
      return []; // already there
    }

    const unvisited = [...this.states];
    const vertices = {};

    this.states.forEach((state) => {
      let distance, prev = null;
      if (startState === state) {
        distance = 0;
      } else {
        distance = Infinity;
        prev = null;
      }
      vertices[state] = { distance, prev };
    });
    // if (startState === BAD_STATE) {
      unvisited.push(BAD_STATE);
      vertices[BAD_STATE] = { distance: 0, prev: null };
    // }

    while (unvisited.length) {
      // find node with shortest distance
      let node = null;
      let minDistance = Infinity;
      unvisited.forEach((state) => {
        if (vertices[state].distance < minDistance) {
          minDistance = vertices[state].distance;
          node = state;
        }
      });
      unvisited.splice(unvisited.indexOf(node), 1);

      (Object.keys(this.neighbors[node] || {})).forEach(neighbor => {
        let distance = minDistance + this.neighbors[node][neighbor].cost;
        if (distance < vertices[neighbor].distance) {
          vertices[neighbor] = { distance, prev: node }
        }
      });
    }

    let current = stateName;
    let prev = vertices[stateName].prev;
    const path = [ [prev, current] ];
    if (prev === null) {
      throw Error(`No route exists from "${startState}" (current) to "${stateName}" and no default route exists.`);
    }
    while (prev !== startState && prev !== BAD_STATE) {
      current = vertices[current].prev;
      prev = vertices[prev].prev;
      path.unshift([prev, current]);
    }
    return path;
  }

  // traverses a given path
  async traversePath(path, retries) {

    // perform navigation, return true if succeeded, false if failed
    const attempt = async (start, end) => {
      await this.neighbors[start][end].logic(this.page, this.params);
      let newState = await this.whereAmI();
      if (newState !== end) {
        if (newState === this.currentState) {
          console.error(`Route "${start} >> ${end}" did not result in any state transition.`);
        } else {
          console.error(`Route "${start} >> ${end}" resulted in transition to wrong state (${newState}).`);
          this.currentState = newState; // document transition to wrong state
        }
        return false;
      }
      return true;
    } 

    // now traverse the path
    for (const route of path) {
      let [start, end] = route;
      let retryAttempts = 0;
      let success = false;
      while (!success && retryAttempts < retries) {
        success = await attempt(start, end);
        retryAttempts++;
      }
      if (!success) {
        throw new Error(`Failed to traverse "${start} >> ${end}" route after ${retries} attempts.`)
      }
      this.currentState = end; // document transition to correct state
    }
  }

  // navigates to correct state if we're not already in that state, if navigation
  // is impossible, throws an error.
  async ensureState(stateName, params, actions, retries = 3) {
    const path = await this.findPathToState(stateName, params);
    await this.traversePath(path, retries);
    if (typeof actions === 'function') {
      return await actions(this.page, this.params);
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
          return cost + this.neighbors[start][end].cost
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
    await this.traversePath(cheapestPath, retries);
    if (typeof actions === 'function') {
      return await actions(this.page, this.params, cheapestState);
    }
  }

  // returns a shuffled copy of the list
  shuffle(list) {
    list = list.slice(); // make a copy
    for (let i1 = list.length - 1; i1 > 0; i1--) {
      const i2 = math.floor(Math.random() * (i1 + 1));
      const temp = list[i1];
      list[i1] = list[i2];
      list[i2] = temp;
    }
    return list;
  }

  // compares two images on disk
  diffImage(workImage, goldenImagem, diffImage) {
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
