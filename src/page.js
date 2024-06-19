/*
 Wraps around Puppeteer's page object to provide a more convenience functions
 */
const util = require('./utilities');

class Page {
    constructor(page) {
        this.page = page;

        // setup a pass-through for all original methods, including those inherited from the prototype
        this.pageMethods = util.getInstanceMethodNames(page);
        this.pageMethods.forEach(method => {
            if (this.page[method].bind) {
                this[method] = this.page[method].bind(this.page);
            } else {
                this[method] = this.page[method];
            }
        });
    }

    /*
     * specify element to return by exact text within the element (text must be unique,
     * element must be present, or an error will be thrown).
     */
    async elementWithText(text) {
        const escapedText = util.escapeXpathString(text);
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
    }

    /*
     * return all elements with given text
     */
    async allElementsWithText(text) {
        const escapedText = util.escapeXpathString(text);
        return this.page.$x(`//*[text()[contains(., ${escapedText})]]`);
    }

    /*
     * specify exact coordinates to click within element, fraction between -1 and 1 is
     * treated like percentage, numbers outside that range are treated as whole pixel
     * offsets.
     */
    async clickWithinElement(options) {
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
    }

    /*
     * wait until at least one instance of element with text exists on the page.
     */
    async waitForElementWithText(text) {
        const escapedText = util.escapeXpathString(text);
        return this.page.waitForXPath(`//*[text()[contains(., ${escapedText})]]`);
    }

    /*
     * wait until content inside the element changes
     */
    async waitForUpdate(element) {
      if (!element) {
          throw new Error('No element passed');
      }
      await element.evaluate((element) => {
        return new Promise((resolve, reject) => {

            // Options for the observer (which mutations to observe)
            const config = { childList: true, subtree: true, characterData: true };

            // Callback function to execute when mutations are observed
            const callback = function(mutationsList, observer) {
                // Assuming the content change is the condition to resolve
                for (let mutation of mutationsList) {
                    if (mutation.type === 'childList' || mutation.type === 'characterData') {
                        observer.disconnect();
                        resolve();
                        return;
                    }
                }
            };

            // Create an instance of MutationObserver
            const observer = new MutationObserver(callback);

            // Start observing the target node for configured mutations
            observer.observe(element, config);

            // Optional: timeout to stop observing if it takes too long
            setTimeout(() => {
                observer.disconnect();
                reject(new Error('Timeout waiting for the element to update'));
            }, 10000); // 10 seconds timeout
        });
      })
    }

    /*
     * wait a user-specified number of milliseconds before continuing, if one number is provided,
     * waits that number of milliseconds, if 2 are provided, waits a random interval between the two)
     */
    async wait(min, max) {
        let ms = min
        if (max) {
            ms = Math.floor(Math.random() * (max - min)) + min
        }
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /*
     * Combines wait with click
     */
    async waitAndClick(selector, options) {
        await this.waitForSelector(selector, options);
        return this.click(selector, options);
    }

    /**
     * start listening for json response to a request
     */
    async onJsonResponse(url, response) {
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
    }

    /*
     * scrapes an element on the page into JSON or TEXT
     * 
     * this is not recursive, while it will grab the nested text content, in json format it will
     * not visit nested elements and will only report the tag and attributes of the element.
     * 
     * however, when invoked on a table in json format, it will recurse down into individual cells
     * and grab entire table as a json object.
     */
    async scrape(element, format) {
        if (format && !['json', 'text'].includes(format)) {
            throw new Error('Invalid format, must be "json" or "text"');
        }

        if (!element) {
          throw new Error('No element passed in to scrape')
        }

        if (format === 'json') {
            // if it's a table, we convert it to json
            if (await element.evaluate(e => e.tagName) === 'TABLE') {
                return await util.tableToJson(this.page, element);
            } else if (['UL', 'OL'].includes(await element.evaluate(e => e.tagName))) {
                return await util.listToJson(this.page, element);
            }
            // if (element._remoteObject.className === 'HTMLTableElement') {
            //     return await util.tableToJson(this.page, element);
            // }
            let value = await element.jsonValue();

            // if json object is empty, we evaluate the attributes manually
            if (Object.keys(value).length === 0) {
                return await this.page.evaluate(e => {
                    let obj = { tag: e.tagName };
                    for (let i = 0; i < e.attributes.length; i++) {
                        obj[e.attributes[i].name] = e.attributes[i].value;
                    }
                    return obj;
                }, element);
            } else {
                return value;
            }
        } else {
            return await this.page.evaluate(
                element => element.innerText,
                element,
            );
        }
    }

    /**
     * filter elements by combination of CSS, text, and XPath
     */
    async filter(options) {
        let cssSelected = options.css ? await this.page.$$(options.css) : null;
        let xpathSelected = options.xpath
          ? await this.page.$x(options.xpath)
          : null;
        let textSelected = options.text
          ? await this.allElementsWithText(options.text)
          : null;
        return util.allowListClick(
          await util.intersection(
            await util.intersection(cssSelected, xpathSelected, this.page),
            textSelected,
            this.page
          ),
        );
    }

    /**
     * similar to filter, but uses innerText instead to match, allowing it to match parent elements
     * 
     * for example: if you have <button><span>Click Me</span></button>, you can match the button with
     * this function, whereas filter with both css and text set would return nothing (since button would
     * be matched by css, and span by text, and they are not the same element).
     */
    async smartFilter(options) {
        let cssSelected = options.css ? await this.page.$$(options.css) : null;
        let xpathSelected = options.xpath
          ? await this.page.$x(options.xpath)
          : null;

        let xpathAndCss = await util.intersection(cssSelected, xpathSelected, this.page)
        if (xpathAndCss.length > 0) {
            if (!options.text) {
                return util.allowListClick(xpathAndCss);
            }

            // now we filter by innerText
            let finalList = [];
            for (let i = 0; i < xpathAndCss.length; i++) {
                let element = xpathAndCss[i];
                let innerText = await this.page.evaluate(e => e.innerText, element);
                // if text is a regex, we match it
                if (
                    (options.text instanceof RegExp && options.text.test(innerText)) ||
                    (typeof options.text === 'string' && innerText.includes(options.text))
                ) {
                    finalList.push(element);
                }
            }
            return util.allowListClick(finalList);
        }

        // only text selector was passed
        let textSelected = options.text
            ? await this.allElementsWithText(options.text)
            : [];
        return util.allowListClick(textSelected);
    }
}

module.exports = Page;
