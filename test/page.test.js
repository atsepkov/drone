const util = require("../src/utilities");
const Drone = require("../index").Drone;
const drone = new Drone();

describe("Page Interaction", () => {
    beforeAll(async () => {
        jest.setTimeout(30000);
        await drone.start({
            executablePath: process.env.CHROME_BIN,
            viewport: {
                width: 1280,
                height: 800
            }
        });
    });

    it("can use native page methods", async () => {
        await drone.page.goto("https://investomation.com");
        const title = await drone.page.title();
        expect(title).to.contain("Investomation");
    })
    
    it("can grab element using text", async () => {
        const element = await drone.page.elementWithText("Take Me to the Sign Up Page");
        expect(element).to.be.ok;
        expect(await element.evaluate(e => e.tagName)).to.equal("SPAN");
    });

    it("can grab a group of elements using xpath filter", async () => {
        const buttons = await drone.page.filter({ xpath: "//button" });

        // there should be at least 4 buttons on the page
        // console.log(expect(Object.getOwnPropertyNames(buttons.length).to))
        expect(buttons.length).to.be.greaterThan(3);

        // there should be a log in button
        const logInButton = buttons.find(b => b.textContent === "Log In");
        expect(logInButton).to.be.ok;

        // there should be a sign up button
        const signUpButton = buttons.find(b => b.textContent === "Sign Up");
        expect(signUpButton).to.be.ok;

        // there should be a demo button
        const demoButton = buttons.find(b => b.textContent === "Demo");
        expect(demoButton).to.be.ok;

        // and there should be another sign up button with a different text
        const signUpButton2 = buttons.find(b => b.textContent === "Take Me to the Sign Up Page");
        expect(signUpButton2).to.be.ok;
    })

    it("can grab a group of elements using css filter", async () => {
        const cssButtons = await drone.page.filter({ css: "button" });

        // should match the number of buttons found with xpath
        const xpathButtons = await drone.page.filter({ xpath: "//button" });
        expect(cssButtons.length).to.equal(xpathButtons.length);

        // also test other selectors
        const buttons = await drone.page.filter({ css: ".s-btn" });
        expect(buttons.length).to.be.greaterThan(3);

        // select images within logo layers
        const images = await drone.page.filter({ css: ".source-logo img" });
        expect(images.length).to.be.equal(6);
        // each should be an image
        for (let i = 0; i < images.length; i++) {
            let image = images[i];
            let data = await image.evaluate(e => {
                return {
                    tag: e.tagName,
                    src: e.src
                }
            });
            expect(data.tag).to.equal("IMG")
            expect(data.src).to.match(/\/static\/(.*)-logo.png/)
        }
    })

    it("can grab a group of elements using text filter", async () => {
        const buttons = await drone.page.filter({ text: "Sign Up" });
        expect(buttons.length).to.be.equal(2);
    })

    it("can grab an intersection of elements using multiple filters", async () => {
        const buttons = await drone.page.filter({ xpath: "//button" });
        const primaryColorElements = await drone.page.filter({ css: ".primary-color" });
        const intersection = await util.intersection(buttons, primaryColorElements, drone.page);
        const primaryColorButtons = await drone.page.filter({ xpath: "//button", css: ".primary-color" });

        expect(primaryColorButtons.length).to.be.lessThan(buttons.length);
        expect(primaryColorButtons.length).to.be.lessThan(primaryColorElements.length);
        expect(primaryColorButtons.length).to.be.equal(intersection.length);
    })

    it("can grab intersections with smart filter that regular filter fails on", async () => {
        const loginButton1 = await drone.page.filter({ xpath: "//button", css: ".primary-color", text: "Log In"});
        expect(loginButton1.length).to.be.equal(0); // text is wrapped in a span, so we fail to match

        const loginButton2 = await drone.page.smartFilter({ xpath: "//button", css: ".primary-color", text: "LOG IN"});
        expect(loginButton2.length).to.be.equal(1); // smart filter should match (but applies transform)

        const loginButton3 = await drone.page.smartFilter({ xpath: "//button", css: ".primary-color", text: "Log In"});
        expect(loginButton3.length).to.be.equal(0); // smart filter is case sensitive
    })

    it("can use regex in smart filter", async () => {
        const loginButton = await drone.page.smartFilter({ xpath: "//button", css: ".primary-color", text: /log in/i });
        expect(loginButton.length).to.be.equal(1);
    })

    it("can scrape page content", async () => {
        const tierCards = await drone.page.filter({ css: ".tier-card" });
        const tiers = ['Explorer', 'Trailblazer', 'Architect']

        for (let i = 0; i < tierCards.length; i++) {
            const card = tierCards[i];
            const content = await drone.page.scrape(card);

            // each card should contain the tier name and a lengthy description
            expect(content).to.contain(tiers[i])
            expect(content.length).to.be.greaterThan(100);
        }
    })

    it("can scrape elements as json", async () => {
        const images = await drone.page.filter({ css: ".source-logo img" });
        for (let i = 0; i < images.length; i++) {
            const image = images[i];
            const data = await drone.page.scrape(image, "json");

            expect(data).to.be.an("object");
            expect(data.tag).to.equal("IMG");
            expect(data.src).to.be.a("string");
            expect(data.src).to.match(/\/static\/(.*)-logo.png/);
            expect(data.alt).to.be.a("string");
            expect(data.alt).to.contain("logo");
        }
    })

    it("can scrape tables without header", async () => {
        // NOTE: W3 schools actually has a malformed header, so this is a good edge case test
        // in this case our keys will be indexes of the columns instead of headings
        await drone.page.goto("https://www.w3schools.com/html/html_tables.asp");
        const table = await drone.page.filter({ css: ".w3-example table" });
        
        // data should be in TSV-like format with 3 columns
        const data = await drone.page.scrape(table[0]);
        let cells = data.split("\n").map(row => row.split("\t"));
        
        for (let i = 0; i < cells.length; i++) {
            let row = cells[i];
            expect(row.length).to.be.equal(3);
            expect(row[0]).to.be.a("string");
            expect(row[1]).to.be.a("string");
            expect(row[2]).to.be.a("string");
        }

        const json = await drone.page.scrape(table[0], "json");
        expect(json).to.be.an("array");
        expect(json.length).to.equal(cells.length); // number of rows should be the same

        // now compare each row against the corresponding index of the TSV data
        for (let i = 0; i < json.length; i++) {
            let row = json[i];
            expect(row).to.be.an("object");
            expect(row["0"]).to.equal(cells[i][0]);
            expect(row["1"]).to.equal(cells[i][1]);
            expect(row["2"]).to.equal(cells[i][2]);
        }
    })

    it("can scrape tables with header", async () => {
        await drone.page.goto("https://en.wikipedia.org/wiki/Local_government_in_the_United_States");
        const table = await drone.page.smartFilter({ css: ".wikitable", text: /30 largest Cities/ });
        const json = await drone.page.scrape(table[0], "json");

        expect(json).to.be.an("array");
        expect(json.length).to.equal(30);

        const strToNum = str => parseInt(str.replace(/,/g, ""));
        for (let i = 0; i < json.length - 1; i++) {
            expect(json[i].City).to.be.a("string");

            // since cities are ranked by population, we can check that they're in descending order
            expect(
                strToNum(json[i]["2020 pop.\n\nestimate"])
            ).to.be.greaterThan(
                strToNum(json[i + 1]["2020 pop.\n\nestimate"])
            );
        }
    })
    
    afterAll(async () => {
        await drone.stop();
    });
});