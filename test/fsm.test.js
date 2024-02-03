const util = require("../src/utilities");
const Drone = require("../index").Drone;
let drone1 = new Drone(), // drone for simple tests
    drone2 = new Drone(), // drone for composite tests
    mock = {
      state: null,
    },
    states = ['foo', 'bar', 'baz'];

function getTransitionMap(transitions) {
  return Object.entries(transitions).map(([k, v]) => [k, Object.keys(v)])
}

describe("Basic States", () => {

  test("add states", () => {
    for (const state of states) {
      drone1.addState(state, () => {
        return mock.state === state
      })
    }
    // console.log(expect([]))
    expect(drone1.fsm.baseStates).to.eql(states)
  });

  test("add duplicate state", () => {
    expect(() => {
      drone1.addState('foo', () => {})
    }).to.throwError(/already exists/)
  });

  test("add state transitions", () => {
    states.forEach((start, index) => {
      let next = states[index + 1] || states[0]
      drone1.addStateTransition(start, next, () => {
        mock.state = next;
      })
    })
    expect(getTransitionMap(drone1.fsm.neighbors)).to.eql([
      ['foo', ['bar']],
      ['bar', ['baz']],
      ['baz', ['foo']],
    ])
  })

  test("add transition with bad start state", () => {
    expect(() => {
      drone1.addStateTransition('bird', 'foo', () => {})
    }).to.throwError(/does not exist/)
  });

  test("add transition with bad end state", () => {
    expect(() => {
      drone1.addStateTransition('foo', 'bird', () => {})
    }).to.throwError(/does not exist/)
  });

  test("add useless transition", () => {
    expect(() => {
      drone1.addStateTransition('foo', 'foo', () => {})
    }).to.throwError(/state to itself/)
  });

  test("add obsolete transition", () => {
    // transition obsoleted by a cheaper, earlier declared transition
    expect(drone1.fsm.neighbors['foo']['bar'].cost).to.equal(1)
    expect(() => {
      drone1.addStateTransition('foo', 'bar', () => {}, 2)
    }).to.throwError(/cheaper path/)
    expect(drone1.fsm.neighbors['foo']['bar'].cost).to.equal(1)
  });

  test("add better transition", () => {
    // transition making earlier transition obsolete
    expect(drone1.fsm.neighbors['foo']['bar'].cost).to.equal(1)
    drone1.addStateTransition('foo', 'bar', () => {
      mock.state = 'bar'
    }, 0.5)
    expect(drone1.fsm.neighbors['foo']['bar'].cost).to.equal(0.5)
  });

  test("add default state transitions", () => {
    drone1.addDefaultStateTransition('foo', () => {
      mock.state = 'foo';
    }, 2)
    expect(getTransitionMap(drone1.fsm.neighbors)).to.eql([
      ['foo', ['bar']],
      ['bar', ['baz']],
      ['baz', ['foo']],
      ['< INVALID STATE >', ['foo']],
    ])
  })

  test("add default transition with bad end state", () => {
    expect(() => {
      drone1.addDefaultStateTransition('bird', () => {})
    }).to.throwError(/does not exist/)
  });

  test("whereAmI uninitialized", async () => {
    expect(await drone1.whereAmI()).to.be(null)
  })

  test("path finding from uninitialized state", async () => {
    expect(await drone1.findPathToState('baz')).to.eql([
      ['< INVALID STATE >', 'foo'],
      ['foo', 'bar'],
      ['bar', 'baz'],
    ])
  })

  test("getNeighbors", async () => {
    expect(drone1.fsm.getNeighbors('foo')).to.eql(['bar']);
    expect(drone1.fsm.getNeighbors('bar')).to.eql(['baz']);
    expect(drone1.fsm.getNeighbors('baz')).to.eql(['foo']);
  })

  test("getNeighbors (non-existant state)", async () => {
    expect(() => {
      drone1.fsm.getNeighbors('food')
    }).to.throwError(/not a valid state/)
  })

  test("ensureState", async () => {
    await drone1.ensureState('bar')
    expect(await drone1.whereAmI()).to.be('bar')
  })

  test("ensureState no route", async () => {
    drone1.addState('qux', () => {
      return mock.state === 'qux'
    })
    await drone1.ensureState('qux').then(_ => expect().fail()).catch(e => {
      expect(e.message).to.contain('No route')
    })
  })

  test("ensureState bad state", async () => {
    await drone1.ensureState('bird').then(_ => expect().fail()).catch(e => {
      expect(e.message).to.contain('Unknown state')
    })
    // expect(async () => {
    //   await drone1.ensureState('bird')
    // }).to.throwError(/Unknown state/)
  })

  test("ensureEitherState", async () => {
    await drone1.ensureState('bar')
    await drone1.ensureEitherState(['foo', 'baz'])
    expect(await drone1.whereAmI()).to.be('baz')
  })

  test("ensureEitherState no route", async () => {
    drone1.addState('qux1', () => {
      return mock.state === 'qux1'
    })
    await drone1.ensureState('bar')
    await drone1.ensureEitherState(['qux', 'qux1']).then(_ => expect().fail()).catch(e => {
      expect(e.message).to.contain('No route')
    })
  })

  test("allStates representation without compositing", () => {
    expect(drone1.fsm.allStates()).to.eql([
      { base: 'foo' },
      { base: 'bar' },
      { base: 'baz' },
      { base: 'qux' },
      { base: 'qux1' },
    ])
  })
});

describe("Composite States", () => {

  beforeAll(() => {
    for (const state of [...states, 'qux', 'qux1']) {
      drone2.addState(state, () => {
        return mock.state === state
      })
    }
  });

  test("add composite state", () => {
    drone2.addCompositeState({ 'gender': 'male' }, ['bar', 'baz', 'qux'], () => {
      return !!mock['gender']
    })
    expect(drone2.fsm.statesInLayer['gender']).to.eql(['male'])
  })

  test("add duplicate composite state", () => {
    expect(() => {
      drone2.addCompositeState({ 'gender': 'male' }, [], () => {})
    }).to.throwError(/already exists/)
  });

  test("missing composite state", () => {
    expect(() => {
      drone2.fsm.allStates()
    }).to.throwError(/No composite state/)
  })

  test("default composite state", () => {
    drone2.addDefaultCompositeState({ 'gender': 'unknown' }, () => {
      return false;
    })
    expect(drone2.fsm.layers['gender']['unknown'].baseStateList).to.eql(['foo', 'qux1'])
  })

  test("composite state overlap", () => {
    drone2.addCompositeState({ 'gender': 'female' }, ['bar', 'baz', 'qux1'], () => {
      return !mock['gender']
    })
    expect(drone2.fsm.statesInLayer['gender']).to.eql(['male', 'unknown', 'female'])
    expect(drone2.fsm.allStates()).to.eql([
      { base: 'foo', gender: 'unknown'  },
      { base: 'bar', gender: 'male'  },
      { base: 'bar', gender: 'female'  },
      { base: 'baz', gender: 'male'  },
      { base: 'baz', gender: 'female'  },
      { base: 'qux', gender: 'male'  },
      { base: 'qux1', gender: 'unknown'  },
      { base: 'qux1', gender: 'female'  } 
    ])
  })

  test("stacking composite layers (iterative)", () => {
    drone2.addCompositeState({ 'access': 'us' }, drone2.fsm.baseStates, () => {
      return mock.access === 'us'
    })
    drone2.addCompositeState({ 'access': 'international' }, drone2.fsm.baseStates, () => {
      return mock.access === 'international'
    })
    expect(Object.keys(drone2.fsm.statesInLayer)).to.eql(['gender', 'access'])
    expect(drone2.fsm.allStates()).to.eql([
      { base: 'foo', gender: 'unknown', access: 'us'  },
      { base: 'foo', gender: 'unknown', access: 'international' },
      { base: 'bar', gender: 'male', access: 'us'  },
      { base: 'bar', gender: 'male', access: 'international' },
      { base: 'bar', gender: 'female', access: 'us'  },
      { base: 'bar', gender: 'female', access: 'international' },
      { base: 'baz', gender: 'male', access: 'us'  },
      { base: 'baz', gender: 'male', access: 'international' },
      { base: 'baz', gender: 'female', access: 'us'  },
      { base: 'baz', gender: 'female', access: 'international' },
      { base: 'qux', gender: 'male', access: 'us'  },
      { base: 'qux', gender: 'male', access: 'international' },
      { base: 'qux1', gender: 'unknown', access: 'us'  },
      { base: 'qux1', gender: 'unknown', access: 'international' },
      { base: 'qux1', gender: 'female', access: 'us'  },
      { base: 'qux1', gender: 'female', access: 'international' }
    ])
  })

  test("stacking composite layers (one step)", () => {
    drone2.addCompositeState({ 'logged in': 'yes', vip: 'no' }, ['bar', 'baz'], () => {
      return mock['logged in'] && !mock.vip
    })
    drone2.addCompositeState({ 'logged in': 'yes', vip: 'yes' }, ['bar', 'baz', 'qux', 'qux1'], () => {
      return mock['logged in'] && mock.vip
    })
    drone2.addCompositeState({ 'logged in': 'no', vip: 'no' }, ['foo', 'bar'], () => {
      return !mock['logged in'] && !mock.vip
    })
    expect(Object.keys(drone2.fsm.statesInLayer)).to.eql(['gender', 'access', 'logged in', 'vip'])
    expect(drone2.fsm.allStates()).to.eql([
      { base: 'foo', gender: 'unknown', access: 'us', 'logged in': 'no', vip: 'no' },
      { base: 'foo', gender: 'unknown', access: 'international', 'logged in': 'no', vip: 'no' },
      { base: 'bar', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'bar', gender: 'male', access: 'us', 'logged in': 'no', vip: 'no' },
      { base: 'bar', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'yes' },
      { base: 'bar', gender: 'male', access: 'international', 'logged in': 'no', vip: 'no' },
      { base: 'bar', gender: 'female', access: 'us', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', gender: 'female', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'bar', gender: 'female', access: 'us', 'logged in': 'no', vip: 'no' },
      { base: 'bar', gender: 'female', access: 'international', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', gender: 'female', access: 'international', 'logged in': 'yes', vip: 'yes' },
      { base: 'bar', gender: 'female', access: 'international', 'logged in': 'no', vip: 'no' },
      { base: 'baz', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'no' },
      { base: 'baz', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'baz', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'no' },
      { base: 'baz', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'yes' },
      { base: 'baz', gender: 'female', access: 'us', 'logged in': 'yes', vip: 'no' },
      { base: 'baz', gender: 'female', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'baz', gender: 'female', access: 'international', 'logged in': 'yes', vip: 'no' },
      { base: 'baz', gender: 'female', access: 'international', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux1', gender: 'unknown', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux1', gender: 'unknown', access: 'international', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux1', gender: 'female', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux1', gender: 'female', access: 'international', 'logged in': 'yes', vip: 'yes' }
    ])
  })

  // NOTE: these tests should really be with getNeighbors, but they become too verbose later
  test("allStates filter", () => {
    expect(drone2.fsm.allStates({
      gender: 'male'
    })).to.eql([
      { base: 'bar', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'bar', gender: 'male', access: 'us', 'logged in': 'no', vip: 'no' },
      { base: 'bar', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'yes' },
      { base: 'bar', gender: 'male', access: 'international', 'logged in': 'no', vip: 'no' },
      { base: 'baz', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'no' },
      { base: 'baz', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'baz', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'no' },
      { base: 'baz', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux', gender: 'male', access: 'us', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux', gender: 'male', access: 'international', 'logged in': 'yes', vip: 'yes' }
    ])
  })

  test("allStates filter (multiple)", () => {
    expect(drone2.fsm.allStates({
      gender: 'female',
      access: 'us',
      vip: 'no'
    })).to.eql([
      { base: 'bar', gender: 'female', access: 'us', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', gender: 'female', access: 'us', 'logged in': 'no', vip: 'no' },
      { base: 'baz', gender: 'female', access: 'us', 'logged in': 'yes', vip: 'no' }
    ])
  })

  test("allStates filter (bad layer)", () => {
    expect(() => {
      drone2.fsm.allStates({
        gender: 'female',
        access: 'us',
        vip: 'no',
        age: '99'
      })
    }).to.throwError(/doesn't exist/)
  })

  test("add duplicate stacking composite state", () => {
    expect(() => {
      drone2.addCompositeState({ 'logged in': 'yes', vip: 'no' }, [], () => {})
    }).to.throwError(/already exists/)
  });

  test("default stacking composite state", () => {
    drone2.addCompositeState({ 'item exists': 'yes', 'item visible': 'yes' }, ['baz', 'qux'], () => {
      return mock['item exists'] && mock['item visible']
    })
    drone2.addCompositeState({ 'item exists': 'yes', 'item visible': 'no' }, ['bar', 'baz'], () => {
      return mock['item exists'] && !mock['item visible']
    })
    drone2.addDefaultCompositeState({ 'item exists': 'no', 'item visible': 'no' }, () => {
      return !mock['item exists'] && !mock['item visible']
    })

    expect(drone2.fsm.layers['item exists']['no'].baseStateList).to.eql(['foo', 'qux1'])
    expect(drone2.fsm.layers['item visible']['no'].baseStateList).to.eql(['bar' , 'baz', 'foo', 'qux1'])
  });

  test("add composite state transitions", () => {
    const start1 = { base: 'baz', vip: 'no' }, end1 = { vip: 'yes' };
    const start2 = { base: 'baz', gender: 'male', vip: 'yes' }, end2 = { base: 'qux' };
    const start3 = { base: 'baz', gender: 'female', vip: 'yes' }, end3 = { base: 'qux1' };

    // TODO: two-way transition candidate
    const start4 = { 'item exists': 'yes', 'item visible': 'no' }, end4 = { 'item exists': 'yes', 'item visible': 'yes' };
    const start5 = { 'item exists': 'yes', 'item visible': 'yes' }, end5 = { 'item exists': 'yes', 'item visible': 'no' };
    // const start4 = { base: 'baz', gender: 'female' }, end4 = { gender: 'male' };
    // const start5 = { base: 'baz', gender: 'male' }, end5 = { gender: 'female' };
    // const start6 = { base: 'foo', gender: 'unknown' }, end6 = { base: 'bar', gender: 'male' };
    // const start7 = { base: 'foo', gender: 'unknown' }, end7 = { base: 'bar', gender: 'female' };
    drone2.addStateTransition('bar', 'baz', () => {
      mock.state = 'baz';
    })
    drone2.addCompositeStateTransition(start1, end1, () => {
      mock.vip = 'yes'
    })
    drone2.addCompositeStateTransition(start2, end2, () => {
      mock.state = 'qux'
    })
    drone2.addCompositeStateTransition(start3, end3, () => {
      mock.state = 'qux1'
    })
    drone2.addCompositeStateTransition(start4, end4, () => {
      mock.itemVisible = 'yes'
    })
    drone2.addCompositeStateTransition(start5, end5, () => {
      mock.itemVisible = 'no'
    })
    expect(getTransitionMap(drone2.fsm.fragmentTransitions)).to.eql([
      [util.stateToString({ base: 'bar' }), [ util.stateToString({ base: 'baz' }) ]],
      [util.stateToString(start1), [util.stateToString(end1)]],
      [util.stateToString(start2), [util.stateToString(end2)]],
      [util.stateToString(start3), [util.stateToString(end3)]],
      [util.stateToString(start4), [util.stateToString(end4)]],
      [util.stateToString(start5), [util.stateToString(end5)]],
    ])
  })

  test("add obsolete composite state transition", () => {
    // transition obsoleted by a cheaper, earlier declared transition
    const start = { base: 'baz', vip: 'no' };
    const end = { vip: 'yes' };
    const startString = util.stateToString(start);
    const endString = util.stateToString(end);
    expect(drone2.fsm.fragmentTransitions[startString][endString].cost).to.equal(1)
    expect(() => {
      drone2.addCompositeStateTransition(start, end, () => {}, 2)
    }).to.throwError(/cheaper path/)
    expect(drone2.fsm.fragmentTransitions[startString][endString].cost).to.equal(1)
  })

  test("add better composite state transition", () => {
    // transition making an earlier transition obsolete
    const start = { base: 'baz', vip: 'no' };
    const end = { vip: 'yes' };
    const startString = util.stateToString(start);
    const endString = util.stateToString(end);
    expect(drone2.fsm.fragmentTransitions[startString][endString].cost).to.equal(1)
    drone2.addCompositeStateTransition(start, end, () => {
      mock.vip = 'yes'
    }, 0.5)
    expect(drone2.fsm.fragmentTransitions[startString][endString].cost).to.equal(0.5)
  });

  test("composite state transition with bad start state layer", () => {
    expect(() => {
      drone2.addCompositeStateTransition({ 'logged in': 'yes', vip: 'no', 'parties': 'hard' }, { vip: 'yes' }, () => {})
    }).to.throwError(/No generated state matches composite start/)
  })

  test("composite state transition with bad start state layer combination", () => {
    // this tests a single multi-layer composite state
    expect(() => {
      drone2.addCompositeStateTransition({ 'logged in': 'no', vip: 'yes' }, { vip: 'yes' }, () => {})
    }).to.throwError(/No generated state matches composite start/)
  })

  test("composite state transition with bad start state layer combination 2", () => {
    // this tests composite layer combining with base state it can't be a part of
    expect(() => {
      drone2.addCompositeStateTransition({ 'base': 'qux1', gender: 'male' }, () => {})
    }).to.throwError(/No generated state matches composite start/)
  })

  // below 4 tests not only test end state problem detection, but that tricky valid start states don't get flagged
  test("composite state transition with bad end state layer", () => {
    expect(() => {
      drone2.addCompositeStateTransition({ 'logged in': 'no' }, { 'logged in': 'yes', vip: 'no', 'parties': 'hard' }, () => {})
    }).to.throwError(/No generated state matches composite end/)
  })

  test("composite state transition with bad end state layer combination", () => {
    // this tests a single multi-layer composite state
    expect(() => {
      drone2.addCompositeStateTransition({ 'base': 'bar', 'logged in': 'no' }, { 'logged in': 'no', vip: 'yes' }, () => {})
    }).to.throwError(/No generated state matches composite end/)
  })

  test("composite state transition with bad end state layer combination 2", () => {
    // this tests composite layer combining with base state it can't be a part of
    expect(() => {
      drone2.addCompositeStateTransition({ 'access': 'international', 'logged in': 'yes' }, { 'base': 'qux1', gender: 'male' }, () => {})
    }).to.throwError(/No generated state matches composite end/)
  })

  test("composite state transition with implicit bad end state layer combination", () => {
    // this tests composite layer combining with implicit base state it can't be a part of
    expect(() => {
      drone2.addCompositeStateTransition({ base: 'qux1', gender: 'female' }, { gender: 'male' }, () => {})
    }).to.throwError(/No generated state matches composite end/)
  })

  test("isValidState (yes)", () => {
    expect(drone2.fsm.isValidState({
      base: 'qux',
      gender: 'male',
    })).to.be.ok();
  })

  test("isValidState (no)", () => {
    expect(drone2.fsm.isValidState({
      base: 'qux',
      gender: 'female',
    })).to.not.be.ok();
    expect(drone2.fsm.isValidState({
      base: 'qux',
      vip: 'no',
    })).to.not.be.ok();
  })

  test("getNeighbors (ambiguity)", () => {
    expect(() => {
      drone2.fsm.getNeighbors({ base: 'baz', gender: 'female' })
    }).to.throwError(/define more layers to resolve ambiguity/)
  })

  test("getNeighbors (invalid state)", () => {
    // baz is inaccessible without login
    expect(() => {
      drone2.fsm.getNeighbors({
        base: 'baz',
        access: 'us',
        gender: 'female',
        'logged in': 'no',
        vip: 'no',
        'item exists': 'no',
        'item visible': 'no'
      })
    }).to.throwError(/not a valid state/)
  })

  test("getNeighbors", () => {
    expect(drone2.fsm.getNeighbors(

      {
        base: 'baz',
        access: 'us',
        gender: 'female',
        'logged in': 'yes',
        vip: 'no',
        'item exists': 'yes',
        'item visible': 'no'
      }

    )).to.eql([{
      base: 'baz',
      access: 'us',
      gender: 'female',
      'logged in': 'yes',
      vip: 'yes',
      'item exists': 'yes',
      'item visible': 'no'
    },
    {
      base: 'baz',
      access: 'us',
      gender: 'female',
      'logged in': 'yes',
      vip: 'no',
      'item exists': 'yes',
      'item visible': 'yes'
    }])
  })

  /*
  test("add composite state that causes earlier transition to create side-effects", () => {
    // side-effect is created because gender can't exist in 'foo' state, yet transition bar >> foo doesn't factor that in
    expect(() => {
      drone1.addCompositeState({ 'gender': 'male' }, ['bar', 'baz', 'qux'], () => {})
    }).to.throwError(/creates side-effects/)
  })
  */
})
