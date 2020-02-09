
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
});

describe("Composite States", () => {

  test("add composite state", () => {
    drone.addCompositeState({ 'logged in': 'yes' }, ['bar', 'baz', 'qux'], () => {
      return !!mock['logged in']
    })
    expect(drone.statesInLayer['logged in']).to.eql(['yes'])
  })

  test("add duplicate composite state", () => {
    expect(() => {
      drone.addCompositeState({ 'logged in': 'yes' }, [], () => {})
    }).to.throwError(/already exists/)
  });

  test("missing composite state", () => {
    expect(() => {
      drone.allStates
    }).to.throwError(/No composite state/)
  })

  test("default composite state", () => {
    drone.addDefaultCompositeState({ 'logged in': 'unknown' }, () => {
      return false;
    })
    expect(drone.layers['logged in']['unknown'].baseStateList).to.eql(['foo', 'qux1'])
  })

  test("composite state overlap", () => {
    drone.addCompositeState({ 'logged in': 'no' }, ['foo', 'bar'], () => {
      return !mock['logged in']
    })
    expect(drone.statesInLayer['logged in']).to.eql(['yes', 'unknown', 'no'])
    expect(drone.allStates).to.eql([
      { base: 'foo', 'logged in': 'unknown'  },
      { base: 'foo', 'logged in': 'no'  },
      { base: 'bar', 'logged in': 'yes'  },
      { base: 'bar', 'logged in': 'no'  },
      { base: 'baz', 'logged in': 'yes'  },
      { base: 'qux', 'logged in': 'yes'  },
      { base: 'qux1', 'logged in': 'unknown'  }
    ])
  })

  test("stacking composite layers", () => {
    drone.addCompositeState({ vip: 'yes' }, ['bar', 'baz', 'qux'], () => {
      return mock.vip
    })
    drone.addCompositeState({ vip: 'no' }, drone.baseStates, () => {
      return !mock.vip
    })
    expect(Object.keys(drone.statesInLayer)).to.eql(['logged in', 'vip'])
    expect(drone.allStates).to.eql([
      { base: 'foo', 'logged in': 'unknown', vip: 'no' },
      { base: 'foo', 'logged in': 'no', vip: 'no' },
      { base: 'bar', 'logged in': 'yes', vip: 'yes' },
      { base: 'bar', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', 'logged in': 'no', vip: 'yes' },   // technically this state shouldn't exist, but our logic allows it for now
      { base: 'bar', 'logged in': 'no', vip: 'no' },
      { base: 'baz', 'logged in': 'yes', vip: 'yes' },
      { base: 'baz', 'logged in': 'yes', vip: 'no' },
      { base: 'qux', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux', 'logged in': 'yes', vip: 'no' },
      { base: 'qux1', 'logged in': 'unknown', vip: 'no' }
    ])
  })
})
