
const Drone = require("../index").Drone;
let drone = new Drone(),
    mock = {
      state: null,
    },
    states = ['foo', 'bar', 'baz'];

describe("Basic States", () => {

  test("add states", () => {
    for (const state of states) {
      drone.addState(state, () => {
        return mock.state === state
      })
    }
    // console.log(expect([]))
    expect(drone.baseStates).to.eql(states)
  });

  test("add duplicate state", () => {
    expect(() => {
      drone.addState('foo', () => {})
    }).to.throwError(/already exists/)
  });

  test("add state transitions", () => {
    states.forEach((start, index) => {
      let next = states[index + 1] || states[0]
      drone.addStateTransition(start, next, () => {
        mock.state = next;
      })
    })
    expect(Object.keys(drone.transitions)).to.eql([
      'foo >> bar',
      'bar >> baz',
      'baz >> foo',
    ])
  })

  test("add transition with bad start state", () => {
    expect(() => {
      drone.addStateTransition('bird', 'foo', () => {})
    }).to.throwError(/does not exist/)
  });

  test("add transition with bad end state", () => {
    expect(() => {
      drone.addStateTransition('foo', 'bird', () => {})
    }).to.throwError(/does not exist/)
  });

  test("add useless transition", () => {
    expect(() => {
      drone.addStateTransition('foo', 'foo', () => {})
    }).to.throwError(/state to itself/)
  });

  test("add obsolete transition", () => {
    expect(() => {
      drone.addStateTransition('foo', 'bar', () => {}, 2)
    }).to.throwError(/cheaper path/)
  });

  test("add default state transitions", () => {
    drone.addDefaultStateTransition('foo', () => {
      mock.state = 'foo';
    }, 2)
    expect(Object.keys(drone.transitions)).to.eql([
      'foo >> bar',
      'bar >> baz',
      'baz >> foo',
      '< INVALID STATE > >> foo'
    ])
  })

  test("add default transition with bad end state", () => {
    expect(() => {
      drone.addDefaultStateTransition('bird', () => {})
    }).to.throwError(/does not exist/)
  });

  test("whereAmI uninitialized", async () => {
    expect(await drone.whereAmI()).to.be(null)
  })

  test("path finding from uninitialized state", async () => {
    expect(await drone.findPathToState('baz')).to.eql([
      '< INVALID STATE > >> foo',
      'foo >> bar',
      'bar >> baz',
    ])
  })

  test("ensureState", async () => {
    await drone.ensureState('bar')
    expect(await drone.whereAmI()).to.be('bar')
  })

  test("ensureState no route", async () => {
    drone.addState('qux', () => {
      return mock.state === 'qux'
    })
    await drone.ensureState('qux').then(_ => expect().fail()).catch(e => {
      expect(e.message).to.contain('No route')
    })
  })

  test("ensureState bad state", async () => {
    await drone.ensureState('bird').then(_ => expect().fail()).catch(e => {
      expect(e.message).to.contain('Unknown state')
    })
    // expect(async () => {
    //   await drone.ensureState('bird')
    // }).to.throwError(/Unknown state/)
  })

  test("ensureEitherState", async () => {
    await drone.ensureState('bar')
    await drone.ensureEitherState(['foo', 'baz'])
    expect(await drone.whereAmI()).to.be('baz')
  })

  test("ensureEitherState no route", async () => {
    drone.addState('qux1', () => {
      return mock.state === 'qux1'
    })
    await drone.ensureState('bar')
    await drone.ensureEitherState(['qux', 'qux1']).then(_ => expect().fail()).catch(e => {
      expect(e.message).to.contain('No route')
    })
  })

  test("allStates representation without compositing", async () => {
    expect(drone.allStates).to.eql([
      { base: 'foo' },
      { base: 'bar' },
      { base: 'baz' },
      { base: 'qux' },
      { base: 'qux1' },
    ])
  })
});

describe("Composite States", () => {

  test("add composite state", () => {
    drone.addCompositeState({ 'gender': 'male' }, ['bar', 'baz', 'qux'], () => {
      return !!mock['gender']
    })
    expect(drone.statesInLayer['gender']).to.eql(['male'])
  })

  test("add duplicate composite state", () => {
    expect(() => {
      drone.addCompositeState({ 'gender': 'male' }, [], () => {})
    }).to.throwError(/already exists/)
  });

  test("missing composite state", () => {
    expect(() => {
      drone.allStates
    }).to.throwError(/No composite state/)
  })

  test("default composite state", () => {
    drone.addDefaultCompositeState({ 'gender': 'unknown' }, () => {
      return false;
    })
    expect(drone.layers['gender']['unknown'].baseStateList).to.eql(['foo', 'qux1'])
  })

  test("composite state overlap", () => {
    drone.addCompositeState({ 'gender': 'female' }, ['bar', 'baz', 'qux1'], () => {
      return !mock['gender']
    })
    expect(drone.statesInLayer['gender']).to.eql(['male', 'unknown', 'female'])
    expect(drone.allStates).to.eql([
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
    drone.addCompositeState({ 'access': 'us' }, drone.baseStates, () => {
      return mock.access === 'us'
    })
    drone.addCompositeState({ 'access': 'international' }, drone.baseStates, () => {
      return mock.access === 'international'
    })
    expect(Object.keys(drone.statesInLayer)).to.eql(['gender', 'access'])
    expect(drone.allStates).to.eql([
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
    drone.addCompositeState({ 'logged in': 'yes', vip: 'no' }, ['bar', 'baz'], () => {
      return mock['logged in'] && !mock.vip
    })
    drone.addCompositeState({ 'logged in': 'yes', vip: 'yes' }, ['bar', 'baz', 'qux', 'qux1'], () => {
      return mock['logged in'] && mock.vip
    })
    drone.addCompositeState({ 'logged in': 'no', vip: 'no' }, ['foo', 'bar'], () => {
      return !mock['logged in'] && !mock.vip
    })
    expect(Object.keys(drone.statesInLayer)).to.eql(['gender', 'access', 'logged in', 'vip'])
    expect(drone.allStates).to.eql([
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
      drone.addCompositeState({ 'logged in': 'yes', vip: 'no' }, [], () => {})
    }).to.throwError(/already exists/)
  });

  test("default stacking composite state", () => {
    drone.addCompositeState({ 'item exists': 'yes', 'item visible': 'yes' }, ['baz', 'qux'], () => {
      return mock['item exists'] && mock['item visible']
    })
    drone.addCompositeState({ 'item exists': 'yes', 'item visible': 'no' }, ['bar', 'baz'], () => {
      return mock['item exists'] && !mock['item visible']
    })
    drone.addDefaultCompositeState({ 'item exists': 'no', 'item visible': 'no' }, () => {
      return !mock['item exists'] && !mock['item visible']
    })

    expect(drone.layers['item exists']['no'].baseStateList).to.eql(['foo', 'qux1'])
    expect(drone.layers['item visible']['no'].baseStateList).to.eql(['bar' , 'baz', 'foo', 'qux1'])
  });

  test("composite state transition", () => {
    drone.addCompositeStateTransition({ base: 'baz', vip: 'no' }, { vip: 'yes' }, () => {
      mock.vip = 'yes'
    })
    drone.addCompositeStateTransition({ base: 'baz', gender: 'male', vip: 'yes' }, { base: 'qux' }, () => {
      mock.state = 'qux'
    })
    drone.addCompositeStateTransition({ base: 'baz', gender: 'female', vip: 'yes' }, { base: 'qux1' }, () => {
      mock.state = 'qux1'
    })
    console.log(drone.fragmentTransitions, Object.values(drone.fragmentTransitions)[0])
  })

  test("composite state transition with bad start state layer", () => {
    expect(() => {
      drone.addCompositeStateTransition({ 'logged in': 'yes', vip: 'no', 'parties': 'hard' }, { vip: 'yes' }, () => {})
    }).to.throwError(/No generated state matches composite start/)
  })

  test("composite state transition with bad start state layer combination", () => {
    // this tests a single multi-layer composite state
    expect(() => {
      drone.addCompositeStateTransition({ 'logged in': 'no', vip: 'yes' }, { vip: 'yes' }, () => {})
    }).to.throwError(/No generated state matches composite start/)
  })

  test("composite state transition with bad start state layer combination 2", () => {
    // this tests composite layer combining with base state it can't be a part of
    expect(() => {
      drone.addCompositeStateTransition({ 'base': 'qux1', gender: 'male' }, () => {})
    }).to.throwError(/No generated state matches composite start/)
  })

  // below 4 tests not only test end state problem detection, but that tricky valid start states don't get flagged
  test("composite state transition with bad end state layer", () => {
    expect(() => {
      drone.addCompositeStateTransition({ 'logged in': 'no' }, { 'logged in': 'yes', vip: 'no', 'parties': 'hard' }, () => {})
    }).to.throwError(/No generated state matches composite end/)
  })

  test("composite state transition with bad end state layer combination", () => {
    // this tests a single multi-layer composite state
    expect(() => {
      drone.addCompositeStateTransition({ 'base': 'bar', 'logged in': 'no' }, { 'logged in': 'no', vip: 'yes' }, () => {})
    }).to.throwError(/No generated state matches composite end/)
  })

  test("composite state transition with bad end state layer combination 2", () => {
    // this tests composite layer combining with base state it can't be a part of
    expect(() => {
      drone.addCompositeStateTransition({ 'access': 'international', 'logged in': 'yes' }, { 'base': 'qux1', gender: 'male' }, () => {})
    }).to.throwError(/No generated state matches composite end/)
  })

  test("composite state transition with implicit bad end state layer combination", () => {
    // this tests composite layer combining with implicit base state it can't be a part of
    expect(() => {
      drone.addCompositeStateTransition({ base: 'qux1', gender: 'female' }, { gender: 'male' }, () => {})
    }).to.throwError(/No generated state matches composite end/)
  })

  test("getNeighbors (incomplete)", () => {
    expect(() => {
      drone.getNeighbors({ base: 'baz', gender: 'female' })
    }).to.throwError(/getNeighbors\(\) requires complete state/)
  })

  test("getNeighbors", () => {
    let a = drone.getNeighbors({
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
})
