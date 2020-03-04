
const Drone = require("../index").Drone;
let drone1 = new Drone(), // drone for simple tests
    drone2 = new Drone(), // drone for composite tests
    mock = {
      state: null,
    },
    states = ['foo', 'bar', 'baz'];

describe("Basic States", () => {

  test("add states", () => {
    for (const state of states) {
      drone1.addState(state, () => {
        return mock.state === state
      })
    }
    // console.log(expect([]))
    expect(drone1.baseStates).to.eql(states)
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
    expect(Object.keys(drone1.transitions)).to.eql([
      'foo >> bar',
      'bar >> baz',
      'baz >> foo',
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
    expect(() => {
      drone1.addStateTransition('foo', 'bar', () => {}, 2)
    }).to.throwError(/cheaper path/)
  });

  test("add default state transitions", () => {
    drone1.addDefaultStateTransition('foo', () => {
      mock.state = 'foo';
    }, 2)
    expect(Object.keys(drone1.transitions)).to.eql([
      'foo >> bar',
      'bar >> baz',
      'baz >> foo',
      '< INVALID STATE > >> foo'
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
      '< INVALID STATE > >> foo',
      'foo >> bar',
      'bar >> baz',
    ])
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

  test("allStates representation without compositing", async () => {
    expect(drone1.allStates).to.eql([
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
    expect(drone2.statesInLayer['gender']).to.eql(['male'])
  })

  test("add duplicate composite state", () => {
    expect(() => {
      drone2.addCompositeState({ 'gender': 'male' }, [], () => {})
    }).to.throwError(/already exists/)
  });

  test("missing composite state", () => {
    expect(() => {
      drone2.allStates
    }).to.throwError(/No composite state/)
  })

  test("default composite state", () => {
    drone2.addDefaultCompositeState({ 'gender': 'unknown' }, () => {
      return false;
    })
    expect(drone2.layers['gender']['unknown'].baseStateList).to.eql(['foo', 'qux1'])
  })

  test("composite state overlap", () => {
    drone2.addCompositeState({ 'gender': 'female' }, ['bar', 'baz', 'qux1'], () => {
      return !mock['gender']
    })
    expect(drone2.statesInLayer['gender']).to.eql(['male', 'unknown', 'female'])
    expect(drone2.allStates).to.eql([
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
    drone2.addCompositeState({ 'access': 'us' }, drone2.baseStates, () => {
      return mock.access === 'us'
    })
    drone2.addCompositeState({ 'access': 'international' }, drone2.baseStates, () => {
      return mock.access === 'international'
    })
    expect(Object.keys(drone2.statesInLayer)).to.eql(['gender', 'access'])
    expect(drone2.allStates).to.eql([
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
    expect(Object.keys(drone2.statesInLayer)).to.eql(['gender', 'access', 'logged in', 'vip'])
    expect(drone2.allStates).to.eql([
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

    expect(drone2.layers['item exists']['no'].baseStateList).to.eql(['foo', 'qux1'])
    expect(drone2.layers['item visible']['no'].baseStateList).to.eql(['bar' , 'baz', 'foo', 'qux1'])
  });

  test("composite state transition", () => {
    drone2.addCompositeStateTransition({ base: 'baz', vip: 'no' }, { vip: 'yes' }, () => {
      mock.vip = 'yes'
    })
    drone2.addCompositeStateTransition({ base: 'baz', gender: 'male', vip: 'yes' }, { base: 'qux' }, () => {
      mock.state = 'qux'
    })
    drone2.addCompositeStateTransition({ base: 'baz', gender: 'female', vip: 'yes' }, { base: 'qux1' }, () => {
      mock.state = 'qux1'
    })
    console.log(drone2.fragmentTransitions, Object.values(drone2.fragmentTransitions)[0])
  })

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

  test("getNeighbors (incomplete)", () => {
    expect(() => {
      drone2.getNeighbors({ base: 'baz', gender: 'female' })
    }).to.throwError(/getNeighbors\(\) requires complete state/)
  })

  test("getNeighbors", () => {
    let a = drone2.getNeighbors({
      base: 'baz',
      access: 'us',
      gender: 'female',
      'logged in': 'yes',
      vip: 'no',
      'item exists': 'no',
      'item visible': 'no'
    })
    console.log(a)
  })

  test("add composite state that causes earlier transition to create side-effects", () => {
    // side-effect is created because gender can't exist in 'foo' state, yet transition bar >> foo doesn't factor that in
    expect(() => {
      drone1.addCompositeState({ 'gender': 'male' }, ['bar', 'baz', 'qux'], () => {})
    }).to.throwError(/creates side-effects/)
  })
})
