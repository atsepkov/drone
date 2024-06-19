/*
 This is the state machine responsible for generating a traversal graph for the website
 */
const util = require('./utilities');

const BAD_STATE = '< INVALID STATE >';

class StateMachine {

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

    _currentState: string | null

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
        // state machine properties
        this.stateTests = {};           // possible base states the system is aware of
        this.states = [];               // states by priority, states defined earlier have a higher test priority
        this.neighbors = {};            // base state transitions the system is aware of,  used by Dijkstra's algorithm to figure out how to traverse states
        this._currentState = null;      // used to 'cache' current state to speed up some operations
        this.stateTriggers = {};        // triggers that are run when a state is entered

        // meta states
        this.metaStates = {};           // meta states are states that are not yet materialized (this is stateTests for meta states)
        this.metaNeighbors = {};        // meta state transitions
        this.params = {};               // maps params to meta state transitions that can set them
        this._currentParams = {};       // used to 'cache' current params

        // composite states;
        this.compositeFragments = {};   // tracks added fragments (to track duplicate declarations and base states)
        this.fragmentTransitions = {};  // transitions for composite layers
        this.layers = {};               // layers of composite states, each layer contains a set of states
        this.compositeStates = [];      // expanded composite states
        this.compositeTransitions = {}; // expanded composite state transitions
        
        // handling untestable states
        this.occlusions = {};           // list of occlusions for each state (while occluded, a state may be untestable)
        this.lastKnown = {};            // last known/cached states for each layer (used to track state through occlusions)
    }


    /* LOGIC THAT OBSERVES THE STATE MACHINE */

    // return a shallow copy of a list of states being tracked
    get baseStates() {
        return this.states.slice();
    }

    // return states ordered by layer, can be used as a hashmap to get states in a specified layer
    get statesInLayer() {
        const layers = Object.keys(this.layers);
        const statesByLayer = {};
        layers.forEach(layer => {
            statesByLayer[layer] = Object.keys(this.layers[layer]);
        });
        return statesByLayer;
    }

    get currentParams() {
        return { ...this._currentParams };
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

    // meta-states define params needed to compile them into regular states, this function checks if these
    // params are actually being used within the function body
    // HACK: we rely on regex to detect params for now rather than mocking the page object and running the function
    _getUnusedParams(func, paramNames) {
        const unusedParams = [];
        const funcString = func.toString();
        for (const paramName of paramNames) {
            const paramRegex = new RegExp(`\\b${paramName}\\b`);
            if (!paramRegex.test(funcString)) {
                unusedParams.push(paramName);
            }
        }
        return unusedParams;
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

    // get neighbors of a state, neighbors are states we can traverse to (from startState), previous states are not necessarily neighbors
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

    // figures out current state and returns its name to the user, returns null if no states match
    async getCurrentState(page) {
        // if cached state is correct, return that
        if (this._currentState && await this.stateTests[this._currentState](page, this._currentParams)) {
            return this._currentState;
        }

        // otherwise loop through all states to find the correct one
        for (const stateName of this.states) {
            if (await this.stateTests[stateName](page, this._currentParams)) {
                return stateName;
            }
        }
        return null;
    }

    // similar to getCurrentState, but returns all layers (a composite version of getCurrentState)
    async getCurrentStateDetail(page) {
        const baseState = await this.getCurrentState(page, this._currentParams);
        const isCorrectState = (layer, state) => {
            if (state.baseStateList.includes(baseState)) {
                if (this._isLastKnownOccluded(layer)) {
                    return true; // assume correct state if untestable
                }
                if (state.testCriteriaCallback(page, this._currentParams)) {
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

    async _isLastKnownOccluded(layerName) {
        const lastKnownState = {
          base: this._currentState,
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
            if (util.isSubstate(occlusion, await this.getCurrentStateDetail())) {
                return true;
            }
        }
        return false;
    }

    // compiles meta-states needed to traverse to a given state into our state machine
    compileMetaStates(endState, params) {
        
    }

    // computes shortest path to desired state using Dijkstra's algorithm.
    async findPathToState(startState, startParams, endState, endParams) {
        if (!this.stateTests[startState] && !this.metaStates[startState]) {
            throw new Error(`Unknown state: "${startState}", you must add this state to Drone first.`);
        } else if (!this.stateTests[endState] && !this.metaStates[endState]) {
            throw new Error(`Unknown state: "${endState}", you must add this state to Drone first.`)
        }
        if (startState === endState) {
            return []; // already there
        }
        if (!this.neighbors[startState] && !this.metaNeighbors[startState]) {
            startState = BAD_STATE; // legit state, but no path exists out of it
        }

        // check if we need to traverse any meta-states
        if ((startParams && !util.isEqual(this._currentParams, startParams))) {
            // startParams have not yet been compiled into our state machine
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

        let current = endState;
        let prev = vertices[endState].prev;
        const path = [ [prev, current] ];
        if (prev === null) {
            throw Error(`No route exists from "${startState}" (current) to "${endState}" and no default route exists.`);
        }
        while (prev !== startState && prev !== BAD_STATE) {
            current = vertices[current].prev;
            prev = vertices[prev].prev;
            path.unshift([prev, current]);
        }
        return path;
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


    /* LOGIC THAT MODIFIES/BUILDS THE STATE MACHINE */

    // define a state name and test criteria that must be true to determine whether
    // we're already in this state.
    addState(stateName, testCriteriaCallback) {
        if (stateName === BAD_STATE || stateName in this.stateTests) {
            throw new Error(`State "${stateName}" already exists, please use unique state names.`);
        }

        this.states.push(stateName);
        this.stateTests[stateName] = testCriteriaCallback;
    }

    // Similar to regular state, but a meta-state also takes additional parameters that are not yet available at build time,
    // specifying these parameters during navigation will result in meta-state getting compiled into a regular state. A single
    // meta state can be compiled into multiple states, if different parameters are passed for the same final state.
    addMetaState(stateName, params, testCriteriaCallback) {
        if (stateName === BAD_STATE || stateName in this.stateTests) {
            throw new Error(`State "${stateName}" already exists, please use unique state names.`);
        } else if (stateName in this.metaStates) {
            throw new Error(`Meta-state "${stateName}" already exists, please use unique meta-state names.`);
        }

        if (!params || Object.keys(params).length === 0) {
            throw new Error(`Meta-state "${stateName}" must use at least one parameter.`);
        }

        this.metaStates[stateName] = {
            params,                         // params required to compile this meta-state into a regular state
            stateTest: testCriteriaCallback // test we run to determine whether we're in this state, params will be passed to it
        };
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

    // define transition from startState to endState, optionally define cost (default = 1)
    // the algorithm will prefer transitions with cheaper cost
    addStateTransition(startState, endState, transitionLogicCallback, cost = 1) {

        // do not allow transition to self unless this is a meta-state
        if (startState === endState) {
            throw new Error(`Transition from state to itself is not allowed (${startState}).`);
        }

        // check that both states exist and our transition is cheaper than existing one
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

        const transition = {
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

    // same as above, but for meta-states. Meta transitions require that at least one of startState or endState is a meta-state.
    // If endState is a meta-state, params are required. Transition will share the same params as the endState.
    // NOTE: meta-states can define transitions to themselves, the only requirement is that params are different. Also,
    // meta-states can transition back to regular state by resetting the parameters being tracked.
    addMetaStateTransition(startState, endState, transitionLogicCallback, cost = 1) {

        // make sure at least one of the states is a meta-state
        if (!this.metaStates[startState] && !this.metaStates[endState]) {
            throw new Error(`At least one of the states "${startState}" and "${endState}" must be a meta-state.`);
        }

        // check that both states exist and our transition is cheaper than existing one
        if (!this.metaStates[startState] && !this.stateTests[startState]) {
            throw new Error(`Start state "${startState}" does not exist.`);
        } else if (!this.metaStates[endState] && !this.stateTests[endState]) {
            throw new Error(`End state "${endState}" does not exist.`);
        } else if (!this.metaStates[startState] && !this.metaStates[endState]) {
            throw new Error(`At least one of the states "${startState}" and "${endState}" must be a meta-state.`);
        } else if (
            this.metaNeighbors[startState] &&
            this.metaNeighbors[startState][endState] &&
            this.metaNeighbors[startState][endState].cost <= cost
        ) {
            const oldCost = this.metaNeighbors[startState][endState].cost;
            throw new Error(`A cheaper path (cost = ${oldCost}) from "${startState}" to "${endState}" already exists.`);
        }

        // check that params are being used in the transition logic
        const startParams = this.metaStates[startState] ? this.metaStates[startState].params : {};
        const endParams = this.metaStates[endState] ? this.metaStates[endState].params : {};
        // the transition should set all params present in endState but missing in startState
        const newParams = Object.keys(endParams).filter(param => !startParams[param]);
        const unusedParams = this._getUnusedParams(transitionLogicCallback, newParams);
        if (unusedParams.length) {
            throw new Error(`Transition from "${startState}" to "${endState}" does not use all required params: ${unusedParams.join(', ')}.`);
        }

        // if this is a transition to itself, we need to make sure that at least one param is updated
        if (startState === endState) {
            const paramNames = Object.keys(startParams);
            const unusedParams = this._getUnusedParams(transitionLogicCallback, paramNames);
            if (unusedParams.length === paramNames.length) {
                throw new Error(`Transition from "${startState}" to itself must update at least one param.`);
            }
        }

        // document params that are being set by this transition
        newParams.forEach(param => {
            if (!this.params[param]) {
                this.params[param] = [];
            }
            this.params[param].push({ startState, endState });
        });

        const transition = {
            cost: cost,
            params: this.metaStates[endState] ? this.metaStates[endState].params : {},
            logic: transitionLogicCallback
        };
        if (!this.metaNeighbors[startState]) {
            this.metaNeighbors[startState] = {};
        }
        this.metaNeighbors[startState][endState] = transition;
    }

    // compiles a given meta-state and all meta-states required to traverse to it into a regular set of states
    _compileMetaState(metaStateName, params) {
        if (!this.metaStates[metaStateName]) {
            throw new Error(`Unknown meta-state: "${metaStateName}", you must add it to Drone first.`);
        }
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

    addStateOcclusion(layerName, stateList) {
        this.occlusions[layerName] = stateList;
    }

    onState(stateName, logicCallback) {
        this.stateTriggers[stateName] = logicCallback;
    }


    /* STATE MACHINE NAVIGATION */

    // traverses a given path
    async traversePath(path, retries, page, params) {

        // perform navigation, return true if succeeded, false if failed
        const attempt = async (start, end) => {
            await this.neighbors[start][end].logic(page, params);
            let newState = await this.getCurrentState(page, params);
            if (newState !== end) {
                if (newState === this._currentState) {
                    console.error(`Route "${start} >> ${end}" did not result in any state transition.`);
                } else {
                    console.error(`Route "${start} >> ${end}" resulted in transition to wrong state (${newState}).`);
                    this._currentState = newState; // document transition to wrong state
                    if (this.stateTriggers[newState]) {
                        await this.stateTriggers[newState](page, params);
                    }
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
            this._currentState = end; // document transition to correct state
            if (this.stateTriggers[end]) {
                await this.stateTriggers[end](page, params);
            }
        }
    }
}

module.exports = StateMachine;