const Drone = require('../drone').Drone;
const drone = new Drone();

(async () => {
    await drone.start();

    let cities = await drone.actions(async (page) => {
        await page.goto('https://en.wikipedia.org/wiki/List_of_United_States_cities_by_population');
        let table = await page.waitForSelector('table.wikitable:nth-child(18)');
        return page.scrape(table, 'json')
    // }, {
    //     cache: 'cities by population'
    })

    console.log(cities);

    await drone.stop();
})();
