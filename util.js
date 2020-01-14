// utilities submodule

// equivalent to array.filter() but works with async filtering functions
exports.filterAsync = async (arr, callback) => {
  const fail = Symbol();
  return (
    await Promise.all(
      arr.map(async item => ((await callback(item)) ? item : fail)),
    )
  ).filter(i => i !== fail);
};

// return a list of elements that appear in both other lists
exports.intersection = async (array1, array2) => {
  if (!array1) return array2;
  if (!array2) return array1;
  return filterAsync(array1, async e1 => {
    for (const e2 of array2) {
      let sameElement = await this.page.evaluate((e1, e2) => e1 === e2, e1, e2);
      if (sameElement) return true;
    }
    return false;
  });
};

// convert table to JSON representation
exports.tableToJson = async (page, table, options) => {
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
        var result = {},
          index = 0;
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
        var i,
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
        return result;
      };

      const construct = function(table, headings) {
        let result = [];
        let tmpArray = scanRows(children(table, 'tbody > tr'));
        tmpArray.forEach(function(row) {
          if (notNull(row)) {
            txt = arraysToHash(headings, row);
            result[result.length] = txt;
          }
        });
        return result;
      };

      // Run
      // const headings = getHeadings(table);
      const headings = constructHeader(table);
      console.log('H', JSON.stringify(headings));
      return construct(table, headings);
    },
    table,
    opts,
  );
};
