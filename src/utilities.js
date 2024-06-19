// utilities submodule

const escapeXpathString = str => {
  const splitQuotes = str.replace(/'/g, `', "'", '`);
  return `concat('${splitQuotes}', '')`;
};

// allows to click on a list of elements, if the list has only one element
const allowListClick = list => {
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

const hasMethod = (obj, name) => {
  const desc = Object.getOwnPropertyDescriptor (obj, name);
  return !!desc && typeof desc.value === 'function';
}

const getInstanceMethodNames = (obj, stop) => {
  let array = [];
  let proto = Object.getPrototypeOf (obj);
  while (proto && proto !== stop) {
    Object.getOwnPropertyNames (proto)
      .forEach (name => {
        if (name !== 'constructor') {
          if (hasMethod (proto, name)) {
            array.push (name);
          }
        }
      });
    proto = Object.getPrototypeOf (proto);
  }
  return array;
}

// equivalent to array.filter() but works with async filtering functions
const filterAsync = async (arr, callback) => {
  const fail = Symbol();
  return (
    await Promise.all(
      arr.map(async item => ((await callback(item)) ? item : fail)),
    )
  ).filter(i => i !== fail);
};

// return a list of elements that appear in both other lists
const intersection = async (array1, array2, page) => {
  if (!array1 && !array2) return [];
  if (!array1) return array2;
  if (!array2) return array1;
  return filterAsync(array1, async e1 => {
    for (const e2 of array2) {
      let sameElement = await page.evaluate((e1, e2) => e1 === e2, e1, e2);
      if (sameElement) return true;
    }
    return false;
  });
};

// converts ul or ol to JSON representation
const listToJson = async (page, list, options) => {
  const opts = {
    ...{
      allowHTML: false,
    },
    ...options,
  };

  return page.evaluate(
    (list, opts) => {
      const notNull = function(value) {
        return value !== undefined && value !== null;
      };

      const cellValues = function(cell) {
        let value;
        if (opts.allowHTML) {
          value = cell.innerHTML.trim();
        } else {
          value = cell.innerText.trim();
        }
        return value;
      };

      const children = (element, selector) => {
        return Array.from(element.querySelectorAll(`:scope > ${selector}`));
      };

      const scanList = list => {
        let result = [];
        list.forEach(function(cell) {
          result.push(cellValues(cell));
        });
        return result;
      };

      const construct = function(list) {
        return scanList(children(list, 'li'));
      };

      return construct(list);
    },
    list,
    opts,
  );
}

// convert table to JSON representation
const tableToJson = async (page, table, options) => {
  // Set options
  const opts = {
    ...{
      ignoreColumns: [],
      onlyColumns: null,
      ignoreHiddenRows: true,
      headings: null,
      allowHTML: false,
    },
    ...options,
  };

  return page.evaluate(
    (table, opts) => {
      const notNull = function(value) {
        return value !== undefined && value !== null;
      };

      const ignoredColumn = function(index) {
        if (notNull(opts.onlyColumns)) {
          return !opts.onlyColumns.includes(index);
        }
        return opts.ignoreColumns.includes(index);
      };

      const arraysToHash = function(keys, values) {
        let result = {}, index = 0;
        values.forEach(value => {
          // when ignoring columns, the header option still starts
          // with the first defined column
          if (index < keys.length && notNull(value)) {
            result[keys[index]] = value;
            index++;
          }
        });
        return result;
      };

      const cellValues = function(cellIndex, cell) {
        let value;
        if (!ignoredColumn(cellIndex)) {
          if (opts.allowHTML) {
            value = cell.innerHTML.trim();
          } else {
            value = cell.innerText.trim();
          }
          return value;
        }
      };

      const children = (element, selector) => {
        return Array.from(element.querySelectorAll(`:scope > ${selector}`));
      };

      const isVisible = elem => {
        // return elem.offsetWidth === 0 && elem.offsetHeight === 0;
        return true;
      };

      const scanRows = rows => {
        let i,
            j,
            txt,
            tmpArray = [],
            cellIndex = 0;
        rows.forEach(function(row, rowIndex) {
          if (isVisible(row) || !opts.ignoreHiddenRows) {
            if (!tmpArray[rowIndex]) {
              tmpArray[rowIndex] = [];
            }
            cellIndex = 0;
            Array.from(row.children).forEach(function(cell) {
              if (!ignoredColumn(cellIndex)) {
                // process rowspans
                if (cell.rowSpan != 1) {
                  txt = cellValues(cellIndex, cell, []);
                  for (i = 1; i < parseInt(cell.rowSpan); i++) {
                    if (!tmpArray[rowIndex + i]) {
                      tmpArray[rowIndex + i] = [];
                    }
                    tmpArray[rowIndex + i][cellIndex] = txt;
                  }
                }
                // process colspans
                if (cell.colSpan != 1) {
                  txt = cellValues(cellIndex, cell, []);
                  for (i = 1; i < parseInt(cell.colSpan); i++) {
                    // cell has both col and row spans
                    if (cell.rowSpan != 1) {
                      for (j = 0; j < parseInt(cell.rowSpan); j++) {
                        tmpArray[rowIndex + j][cellIndex + i] = txt;
                      }
                    } else {
                      tmpArray[rowIndex][cellIndex + i] = txt;
                    }
                  }
                }
                // skip column if already defined
                while (tmpArray[rowIndex][cellIndex]) {
                  cellIndex++;
                }
                if (!ignoredColumn(cellIndex)) {
                  txt =
                    tmpArray[rowIndex][cellIndex] ||
                    cellValues(cellIndex, cell, []);
                  if (notNull(txt)) {
                    tmpArray[rowIndex][cellIndex] = txt;
                  }
                }
              }
              cellIndex++;
            });
          }
        });
        return tmpArray;
      };

      const constructHeader = function(table) {
        let result = [];
        let tmpArray = scanRows(children(table, 'thead > tr'));
        tmpArray.forEach(function(row) {
          row.forEach((cell, i) => {
            console.log(i, !result[i]);
            if (!result[i]) {
              // first row
              result[i] = cell;
            } else {
              // secondary row, append to existing header
              if (result[i] !== cell) {
                result[i] += `: ${cell}`;
              }
            }
          });
        });
        
        // if headings repeat, add dedupe suffix
        const seen = {}
        result.forEach((e, i) => {
          if (seen[e]) {
            seen[e]++
            result[i] = e + ` (${seen[e]})` 
          } else {
            seen[e] = 1
          }
        })

        return result;
      };

      const construct = function(table, headings) {
        let result = [];
        let tmpArray = scanRows(children(table, 'tbody > tr'));
        let footer = scanRows(children(table, 'tfoot > tr'));
        let needFooter = false;
        if (footer.length > 0) {
          if (footer[0].length !== tmpArray[0].length) {
            needFooter = true;
          } else {
            tmpArray = tmpArray.concat(footer);
          }
        }

        // if headings don't align, use indexes as keys
        if (headings.length !== tmpArray[0].length) {
          headings = Array.from(Array(tmpArray[0].length).keys()).map(String);
        }
        tmpArray.forEach(function(row) {
          if (notNull(row)) {
            txt = arraysToHash(headings, row);
            result[result.length] = txt;
          }
        });
        if (needFooter) { // only runs if footer size is different from body
          let cols = Array.from(footer.length).keys().map(String);
          footer.forEach(function(row) {
            if (notNull(row)) {
              result[result.length] = arraysToHash(cols, row);
            }
          })
        }
        return result;
      };

      // Run
      // const headings = getHeadings(table);
      const headings = constructHeader(table);
      return construct(table, headings);
    },
    table,
    opts,
  );
};

// converts composite state to string
const stateCache = {};
const stateToString = (state) => {
  const string = JSON.stringify(state, Object.keys(state).sort());
  stateCache[string] = state;
  return string;
};

// reverses above operation
const stringToState = (string) => {
  return stateCache[string];
};

// tests if a composite state fragment is a subset of a composite state
const isSubstate = (subState, superState) => {
  for (const [key, value] of Object.entries(subState)) {
    if (superState[key] !== value) {
      return false;
    }
  }
  return true;
};

const isEqual = (a, b) => {
  return JSON.stringify(a) === JSON.stringify(b);
};

const filterByLayer = (states, filteredProps) => {
  return states.filter(state => {
    for (const [key, val] of Object.entries(filteredProps)) {
      if (state[key] !== val) {
        return false;
      }
    }
    return true;
  });
};

module.exports = {
  escapeXpathString,
  allowListClick,
  hasMethod,
  getInstanceMethodNames,
  filterAsync,
  intersection,
  listToJson,
  tableToJson,
  stateToString,
  stringToState,
  isSubstate,
  isEqual,
  filterByLayer,
};
