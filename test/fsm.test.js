
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
      { base: 'foo', 'logged in': 'unknown', vip: 'no' },
      { base: 'foo', 'logged in': 'no', vip: 'no' },
      { base: 'bar', 'logged in': 'yes', vip: 'yes' },
      { base: 'bar', 'logged in': 'yes', vip: 'no' },
      { base: 'bar', 'logged in': 'no', vip: 'no' },
      { base: 'baz', 'logged in': 'yes', vip: 'yes' },
      { base: 'baz', 'logged in': 'yes', vip: 'no' },
      { base: 'qux', 'logged in': 'yes', vip: 'yes' },
      { base: 'qux', 'logged in': 'yes', vip: 'no' },
      { base: 'qux1', 'logged in': 'unknown', vip: 'no' }
    ])
  })
})
