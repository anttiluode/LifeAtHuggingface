/*
 * Life2 — history.
 *
 * Places, eras, names, money and a scripted timeline of real events. The texts are
 * short and simplified on purpose; dates are real. Events are forks and pressures
 * (plague, war, famine, crashes, migration), never verdicts: what they do to your
 * family still runs through the vine economy in engine.js.
 *
 * Deliberately left out as playable events: genocide, slavery and similar atrocities.
 * They are history, but they are not something to turn into a dice roll.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- places
  const REGIONS = {
    italy: {
      name: "Italy",
      label: (y) => (y < 476 ? "the Roman Empire" : y < 1861 ? "Italy" : "Italy"),
      money: (y) => (y < 300 ? { cur: "sesterces", k: 100 } : y < 1252 ? { cur: "solidi", k: 1 } : y < 1861 ? { cur: "florins", k: 1 }
        : y < 2002 ? { cur: "lire", k: y < 1945 ? 500 : 100000 } : { cur: "euros", k: 1000 }),
      names: (y) => (y < 500 ? NAMES.roman : y < 1900 ? NAMES.italianOld : NAMES.italianNew),
      surnames: (y) => (y < 500 ? ["Aurelius", "Valerius", "Claudius", "Flavius", "Junius", "Livius"] : ["Bellini", "Moretti", "Ricci", "Conti", "Marino", "Greco", "Galli", "Esposito"]),
      look: (y) => (y < 476 ? "a Roman town in the 2nd century, terracotta roofs, tunics and stolas, oil lamps"
        : y < 1300 ? "an early medieval Italian hill village, rough stone houses, wool cloaks"
        : y < 1600 ? "Renaissance Tuscany, ochre plaster houses, linen and wool, candlelight"
        : y < 1860 ? "an Italian town in the 18th century, shutters and courtyards"
        : y < 1945 ? "an Italian village in the early 20th century, black clothes, cobbled streets"
        : "modern Italy, apartment balconies, scooters"),
    },
    england: {
      name: "England",
      label: () => "England",
      money: (y) => ({ cur: "pounds", k: y < 1800 ? 1 : y < 1900 ? 2 : y < 1950 ? 10 : y < 1980 ? 100 : 1000 }),
      names: (y) => (y < 1900 ? NAMES.englishOld : NAMES.englishNew),
      surnames: () => ["Ashdown", "Fletcher", "Thatcher", "Webb", "Cooper", "Hale", "Barlow", "Whitaker"],
      look: (y) => (y < 1700 ? "Tudor and Stuart England, timber-framed houses, wool and leather, rushlight"
        : y < 1840 ? "Georgian England, brick terraces, bonnets and coats"
        : y < 1914 ? "Victorian industrial England, terraced houses, coal smoke, gaslight"
        : y < 1960 ? "England in the mid 20th century, ration books, wireless sets"
        : "modern England, terraced streets, rain"),
    },
    finland: {
      name: "Finland",
      label: (y) => (y < 1809 ? "Sweden's eastern lands" : y < 1917 ? "the Grand Duchy of Finland" : "Finland"),
      money: (y) => (y < 1860 ? { cur: "roubles", k: 5 } : y < 1945 ? { cur: "markka", k: 100 } : y < 1963 ? { cur: "markka", k: 20000 }
        : y < 2002 ? { cur: "markka", k: 3000 } : { cur: "euros", k: 1000 }),
      names: (y) => (y < 1940 ? NAMES.finnishOld : NAMES.finnishNew),
      surnames: () => ["Mäkelä", "Virtanen", "Korhonen", "Heikkinen", "Laine", "Koskinen", "Rantanen", "Luode"],
      look: (y) => (y < 1900 ? "a Finnish farmhouse in the 19th century, red log walls, birch forest, snow, rye fields"
        : y < 1950 ? "Finland in the early 20th century, log houses, sauna, wartime coats"
        : y < 1990 ? "Finland in the 1970s, concrete suburbs, birch trees, wool sweaters"
        : "modern Finland, Helsinki apartments, birch forest, winter light"),
    },
    germany: {
      name: "Germany",
      label: (y) => (y < 1871 ? "the German lands" : "Germany"),
      money: (y) => (y < 1873 ? { cur: "thaler", k: 10 } : y < 1924 ? { cur: "marks", k: 100 } : y < 1948 ? { cur: "Reichsmarks", k: 100 }
        : y < 2002 ? { cur: "Deutsche Marks", k: 1500 } : { cur: "euros", k: 1000 }),
      names: (y) => (y < 1940 ? NAMES.germanOld : NAMES.germanNew),
      surnames: () => ["Becker", "Hoffmann", "Krüger", "Wagner", "Schäfer", "Brandt", "Vogel", "Lorenz"],
      look: (y) => (y < 1914 ? "Imperial Germany around 1900, half-timbered town, factory chimneys, lace collars"
        : y < 1950 ? "Germany in the 1920s to 1940s, tenement courtyards, worn coats"
        : y < 1990 ? "West Germany in the 1960s, new apartment blocks, Volkswagens"
        : "modern Germany, tidy streets, bicycles, tram lines"),
    },
    america: {
      name: "America",
      label: (y) => (y < 1776 ? "the American colonies" : "the United States"),
      money: (y) => ({ cur: "dollars", k: y < 1900 ? 50 : y < 1950 ? 100 : y < 1980 ? 500 : 3000 }),
      names: (y) => (y < 1920 ? NAMES.americanOld : NAMES.americanNew),
      surnames: () => ["Walker", "Miller", "Hayes", "Turner", "Brooks", "Carter", "Reed", "Sullivan"],
      look: (y) => (y < 1860 ? "early America, clapboard houses, wagons, homespun clothes"
        : y < 1920 ? "America around 1900, tenements and farmhouses, immigrants, steam trains"
        : y < 1960 ? "America in the 1940s and 50s, porches, radios, Sunday clothes"
        : "modern America, suburbs, highways, big skies"),
    },
  };

  const NAMES = {
    roman: { m: ["Marcus", "Lucius", "Gaius", "Titus", "Quintus", "Publius", "Sextus", "Decimus", "Aulus", "Gnaeus", "Servius", "Spurius", "Tiberius", "Manius", "Appius", "Numerius"],
      f: ["Julia", "Claudia", "Livia", "Aurelia", "Cornelia", "Flavia", "Tullia", "Faustina", "Valeria", "Octavia", "Antonia", "Domitia", "Junia", "Caecilia", "Licinia", "Sabina"] },
    italianOld: { m: ["Giovanni", "Marco", "Lorenzo", "Pietro", "Antonio", "Matteo", "Bernardo", "Niccolò", "Francesco", "Jacopo", "Filippo", "Bartolo", "Guido", "Andrea", "Simone", "Tommaso", "Cosimo", "Lapo"],
      f: ["Maria", "Lucia", "Francesca", "Caterina", "Giulia", "Chiara", "Agnese", "Beatrice", "Margherita", "Bianca", "Lisa", "Ginevra", "Costanza", "Piera", "Tessa", "Nanna", "Bice", "Lapa"] },
    italianNew: { m: ["Giuseppe", "Luca", "Alessandro", "Davide", "Lorenzo", "Paolo", "Andrea", "Marco", "Stefano", "Roberto", "Franco", "Enzo", "Salvatore", "Fabio", "Mario", "Carlo"],
      f: ["Anna", "Sofia", "Giorgia", "Martina", "Elena", "Chiara", "Valentina", "Giulia", "Rosa", "Teresa", "Carla", "Silvia", "Paola", "Francesca", "Laura", "Lucia"] },
    englishOld: { m: ["William", "John", "Thomas", "Richard", "Henry", "Edward", "George", "James", "Robert", "Walter", "Hugh", "Nicholas", "Ralph", "Roger", "Francis", "Samuel"],
      f: ["Alice", "Agnes", "Mary", "Joan", "Elizabeth", "Anne", "Margaret", "Sarah", "Catherine", "Jane", "Isabel", "Eleanor", "Martha", "Susanna", "Dorothy", "Bridget"] },
    englishNew: { m: ["Oliver", "Harry", "Jack", "Thomas", "Daniel", "Sam", "Arthur", "George", "Alfie", "Ben", "Charlie", "Joe", "Tom", "Freddie", "Leo", "Max"],
      f: ["Grace", "Emily", "Charlotte", "Lucy", "Sophie", "Hannah", "Ruby", "Olivia", "Amelia", "Isla", "Jessica", "Chloe", "Ella", "Mia", "Poppy", "Evie"] },
    finnishOld: { m: ["Matti", "Juho", "Heikki", "Antti", "Erkki", "Toivo", "Väinö", "Pekka", "Johannes", "Kalle", "Eino", "Lauri", "Oskari", "Aarne", "Yrjö", "Viljo"],
      f: ["Maria", "Anna", "Liisa", "Kaisa", "Aino", "Helmi", "Elina", "Lempi", "Hilja", "Saima", "Impi", "Siiri", "Kerttu", "Elsa", "Martta", "Hanna"] },
    finnishNew: { m: ["Mikko", "Jari", "Ville", "Aleksi", "Juha", "Eero", "Lauri", "Antti", "Timo", "Janne", "Petri", "Onni", "Eetu", "Joonas", "Tuomas", "Ilkka"],
      f: ["Laura", "Sanna", "Emilia", "Veera", "Satu", "Iida", "Aino", "Katja", "Minna", "Noora", "Hanna", "Kaisa", "Elina", "Saara", "Ella", "Pinja"] },
    germanOld: { m: ["Johann", "Heinrich", "Friedrich", "Wilhelm", "Karl", "Hans", "Otto", "Ernst", "Hermann", "Paul", "Walter", "Kurt", "Fritz", "Georg", "August", "Gustav"],
      f: ["Anna", "Margarethe", "Katharina", "Elisabeth", "Gertrud", "Ilse", "Frieda", "Hedwig", "Martha", "Emma", "Berta", "Luise", "Erna", "Klara", "Helene", "Käthe"] },
    germanNew: { m: ["Lukas", "Jonas", "Felix", "Paul", "Leon", "Max", "Tim", "Jan", "Niklas", "Tobias", "Florian", "Stefan", "Michael", "Thomas", "Julian", "Moritz"],
      f: ["Lena", "Mia", "Hannah", "Lea", "Sophie", "Laura", "Clara", "Anna", "Julia", "Sarah", "Lisa", "Katrin", "Sabine", "Nina", "Emma", "Marie"] },
    americanOld: { m: ["John", "William", "James", "Henry", "Frank", "Robert", "Samuel", "Walter", "George", "Charles", "Joseph", "Thomas", "Edward", "Harry", "Albert", "Fred"],
      f: ["Mary", "Sarah", "Elizabeth", "Ruth", "Dorothy", "Betty", "Clara", "Edith", "Helen", "Margaret", "Florence", "Ethel", "Mildred", "Alice", "Grace", "Lillian"] },
    americanNew: { m: ["Michael", "Chris", "Tyler", "Ryan", "Jordan", "Kevin", "Jason", "Brandon", "Justin", "Matt", "Josh", "Andrew", "Eric", "David", "Nick", "Sean"],
      f: ["Jennifer", "Jessica", "Ashley", "Megan", "Emily", "Sarah", "Olivia", "Amanda", "Brittany", "Lauren", "Kayla", "Rachel", "Nicole", "Hannah", "Taylor", "Madison"] },
  };

  // ---------------------------------------------------------------- where a dynasty can begin
  const STARTS = [
    { id: "rome", region: "italy", year: 150, title: "Rome, 150", blurb: "The Empire at its height. Plague and frontier wars are coming." },
    { id: "florence", region: "italy", year: 1325, title: "Florence, 1325", blurb: "Wool, banks and painters. In twenty years the Black Death arrives." },
    { id: "england", region: "england", year: 1590, title: "England, 1590", blurb: "Plague years, a civil war, a great fire, and later the first stock bubbles." },
    { id: "finland", region: "finland", year: 1845, title: "Finland, 1845", blurb: "Rye, birch and frost. The great hunger years are near; then America calls." },
    { id: "germany", region: "germany", year: 1890, title: "Germany, 1890", blurb: "Factories and a new empire. Two world wars and money that can vanish overnight." },
    { id: "modern", region: "finland", year: 1990, title: "Finland, 1990", blurb: "A depression, then phones, the euro, a crash, a pandemic. Your own century." },
    { id: "america", region: "america", year: 1900, title: "America, 1900", blurb: "Tenements, farms and railroads. The crash of 1929 is a generation away." },
  ];

  // ---------------------------------------------------------------- the timeline
  // type: plague | war | famine | econ | boom | migration | displacement | disaster | flavor
  // sev: how hard it hits (0..1). shock: one-off asset returns. dest: migration target.
  const EVENTS = [
    // Italy and Rome
    { id: "antonine", region: "italy", from: 165, to: 180, type: "plague", sev: 0.35, title: "The Antonine Plague", text: "Soldiers back from the east bring a fever. It goes from house to house.", cause: "the pestilence" },
    { id: "marcomanni", region: "italy", from: 166, to: 180, type: "war", sev: 0.2, title: "War on the Danube", text: "The emperor raises new legions against the Marcomanni." },
    { id: "crisis3", region: "italy", from: 235, to: 284, type: "econ", sev: 0.3, title: "The Crisis of the Third Century", text: "Emperors rise and fall in months. The silver in the coins grows thin.", shock: { cash: -0.5, land: -0.1 } },
    { id: "cyprian", region: "italy", from: 249, to: 262, type: "plague", sev: 0.45, title: "The Plague of Cyprian", text: "A sickness of fever and bleeding eyes. The bishops write that the end has come.", cause: "the pestilence" },
    { id: "alaric", region: "italy", from: 410, to: 410, type: "war", sev: 0.5, title: "The Visigoths sack Rome", text: "For three days the city that ruled the world is plundered." },
    { id: "fall476", region: "italy", from: 476, to: 476, type: "flavor", title: "The last emperor of the West is deposed", text: "Romulus Augustulus is sent away to Campania. Few notice at first." },
    { id: "gothicwar", region: "italy", from: 535, to: 554, type: "war", sev: 0.55, title: "The Gothic War", text: "Justinian's armies come to take Italy back. The fighting lasts twenty years." },
    { id: "justinian", region: "italy", from: 541, to: 549, type: "plague", sev: 0.6, title: "The Plague of Justinian", text: "Swellings in the groin and armpit, then death within days." },
    { id: "lombards", region: "italy", from: 568, to: 572, type: "war", sev: 0.4, title: "The Lombards cross the Alps", text: "A whole people on the move, with their herds and their swords." },
    { id: "arnoflood", region: "italy", from: 1333, to: 1333, type: "disaster", sev: 0.25, title: "The Arno floods Florence", text: "The river takes the bridges and the ground floors of the city." },
    { id: "bankfail", region: "italy", from: 1343, to: 1346, type: "econ", sev: 0.3, title: "The great banks fail", text: "The Peruzzi and the Bardi collapse. The English king does not repay.", shock: { lending: -0.6, trade: -0.2 } },
    { id: "blackdeath_it", region: "italy", from: 1347, to: 1351, type: "plague", sev: 1.0, title: "The Black Death", text: "Ships from the east bring a pestilence. In Florence, perhaps half the city dies." },
    { id: "ciompi", region: "italy", from: 1378, to: 1378, type: "flavor", title: "The Ciompi revolt", text: "The wool carders of Florence rise up and, for a summer, rule." },
    { id: "italianwars", region: "italy", from: 1494, to: 1559, type: "war", sev: 0.2, title: "The Italian Wars", text: "France and Spain fight over Italy for two generations." },
    { id: "sack1527", region: "italy", from: 1527, to: 1527, type: "war", sev: 0.45, title: "The Sack of Rome", text: "Unpaid imperial troops loot the city of the popes." },
    { id: "milanplague", region: "italy", from: 1629, to: 1631, type: "plague", sev: 0.5, title: "The plague of Milan", text: "Armies bring the plague down from the north." },
    { id: "napoleon_it", region: "italy", from: 1796, to: 1814, type: "war", sev: 0.2, title: "Napoleon in Italy", text: "French armies, new laws, old churches stripped of silver." },
    { id: "unify", region: "italy", from: 1861, to: 1861, type: "flavor", title: "Italy is one country", text: "A kingdom of Italy. The village priest says it changes nothing. It changes taxes." },
    { id: "emig_it", region: "italy", from: 1880, to: 1914, type: "migration", dest: "america", p: 0.12, title: "Ships to America", text: "Half the village has a cousin in New York. Letters come with money inside." },
    { id: "ww1_it", region: "italy", from: 1915, to: 1918, type: "war", sev: 0.6, title: "Italy enters the Great War", text: "Men go up to the Alps and the Isonzo." },
    { id: "march1922", region: "italy", from: 1922, to: 1922, type: "flavor", title: "The March on Rome", text: "Mussolini is made prime minister. The black shirts are everywhere." },
    { id: "ww2_it", region: "italy", from: 1940, to: 1945, type: "war", sev: 0.6, title: "Italy at war again", text: "Africa, Greece, Russia. Then the war comes up the peninsula itself." },
    { id: "miracolo", region: "italy", from: 1951, to: 1963, type: "boom", sev: 0.25, title: "The economic miracle", text: "Fiats, televisions, factory jobs in the north." },

    // England
    { id: "plague1603", region: "england", from: 1603, to: 1603, type: "plague", sev: 0.3, title: "Plague in London", text: "The new king's coronation and the plague arrive together." },
    { id: "plague1625", region: "england", from: 1625, to: 1625, type: "plague", sev: 0.3, title: "Plague again", text: "Red crosses on the doors." },
    { id: "civilwar_en", region: "england", from: 1642, to: 1651, type: "war", sev: 0.4, title: "The Civil War", text: "King against Parliament. Brothers on both sides." },
    { id: "greatplague", region: "england", from: 1665, to: 1665, type: "plague", sev: 0.45, title: "The Great Plague", text: "The dead carts go round at night. Those who can, leave London." },
    { id: "greatfire", region: "england", from: 1666, to: 1666, type: "disaster", sev: 0.35, title: "The Great Fire of London", text: "It starts in a bakery on Pudding Lane and burns for four days." },
    { id: "emig_en", region: "england", from: 1620, to: 1900, type: "migration", dest: "america", p: 0.03, title: "Passage to America", text: "A ship is leaving. There is land on the other side, they say." },
    { id: "southsea", region: "england", from: 1720, to: 1720, type: "econ", sev: 0.4, title: "The South Sea Bubble bursts", text: "Everyone bought shares. Now everyone is selling.", shock: { stocks: -0.8 } },
    { id: "mills", region: "england", from: 1770, to: 1840, type: "boom", sev: 0.15, title: "The mills", text: "Steam, cotton and long hours. Wages in coin instead of in kind." },
    { id: "napoleon_en", region: "england", from: 1803, to: 1815, type: "war", sev: 0.15, title: "The wars with Napoleon", text: "The press gangs are in the harbour towns." },
    { id: "ww1_en", region: "england", from: 1914, to: 1918, type: "war", sev: 0.6, title: "The Great War", text: "Over by Christmas, they say." },
    { id: "ww2_en", region: "england", from: 1939, to: 1945, type: "war", sev: 0.4, title: "War again", text: "Gas masks for the children. Evacuation trains." },
    { id: "blitz", region: "england", from: 1940, to: 1941, type: "disaster", sev: 0.3, title: "The Blitz", text: "Night after night, the bombers over the cities." },
    { id: "nhs", region: "england", from: 1948, to: 1948, type: "flavor", title: "The NHS is founded", text: "A doctor without a bill, for the first time." },

    // Finland
    { id: "crimean", region: "finland", from: 1854, to: 1855, type: "war", sev: 0.1, title: "The Crimean War on the coast", text: "British ships bombard the fortresses. Tar and ships burn in the harbours." },
    { id: "nalkavuodet", region: "finland", from: 1866, to: 1868, type: "famine", sev: 1.0, title: "The great hunger years", text: "Frost in August. The bark bread runs out. People walk the roads begging." },
    { id: "emig_fi", region: "finland", from: 1880, to: 1914, type: "migration", dest: "america", p: 0.10, title: "America-fever", text: "From Ostrobothnia whole villages go. Michigan, Minnesota, the mines." },
    { id: "indep", region: "finland", from: 1917, to: 1917, type: "flavor", title: "Finland declares independence", text: "The sixth of December. Candles in the windows." },
    { id: "civilwar_fi", region: "finland", from: 1918, to: 1918, type: "war", sev: 0.45, title: "The Civil War", text: "Reds and Whites. Neighbours on both sides, and the camps after." },
    { id: "winterwar", region: "finland", from: 1939, to: 1940, type: "war", sev: 0.55, title: "The Winter War", text: "Forty degrees below. White snow suits in the forest." },
    { id: "continuation", region: "finland", from: 1941, to: 1944, type: "war", sev: 0.55, title: "The Continuation War", text: "Three more years. The letters from the front grow shorter." },
    { id: "karelia", region: "finland", from: 1944, to: 1944, type: "displacement", p: 0.12, sev: 0.5, title: "Karelia is lost", text: "Four hundred thousand people leave their homes with what fits on a cart." },
    { id: "lapland", region: "finland", from: 1944, to: 1945, type: "war", sev: 0.15, title: "The Lapland War", text: "The north is burned as the Germans withdraw." },
    { id: "lama", region: "finland", from: 1991, to: 1993, type: "econ", sev: 0.5, title: "The depression of the nineties", text: "Banks fail, homes are worth half, one in five has no job.", shock: { stocks: -0.5, land: -0.35 } },
    { id: "nokia", region: "finland", from: 1996, to: 2000, type: "boom", sev: 0.3, title: "The Nokia years", text: "Everyone knows someone who got rich on options." },
    { id: "euro_fi", region: "finland", from: 2002, to: 2002, type: "flavor", title: "The euro", text: "Markka become euros. Prices look small, then they don't." },

    // Germany
    { id: "ww1_de", region: "germany", from: 1914, to: 1918, type: "war", sev: 0.7, title: "The Great War", text: "Flowers in the rifle barrels at the station." },
    { id: "hunger1917", region: "germany", from: 1916, to: 1917, type: "famine", sev: 0.4, title: "The turnip winter", text: "The blockade. Turnip bread, turnip soup, turnip jam." },
    { id: "hyper", region: "germany", from: 1923, to: 1923, type: "econ", sev: 0.9, title: "Hyperinflation", text: "A loaf of bread costs billions. Savings become paper.", shock: { cash: -0.99, lending: -0.95 } },
    { id: "nazis", region: "germany", from: 1933, to: 1933, type: "flavor", title: "Hitler becomes chancellor", text: "Within months there is no opposition left. Some neighbours are taken away." },
    { id: "ww2_de", region: "germany", from: 1939, to: 1945, type: "war", sev: 0.8, title: "The Second World War", text: "The radio speaks of victories. Then of sacrifices." },
    { id: "bombing", region: "germany", from: 1942, to: 1945, type: "disaster", sev: 0.3, title: "The bombing of the cities", text: "Cellars, sirens, phosphorus." },
    { id: "flight", region: "germany", from: 1945, to: 1946, type: "displacement", p: 0.2, sev: 0.6, title: "Flight from the east", text: "Twelve million people on the roads westward." },
    { id: "currency48", region: "germany", from: 1948, to: 1948, type: "econ", sev: 0.4, title: "The currency reform", text: "New Deutsche Marks. Old savings shrink to almost nothing.", shock: { cash: -0.9, lending: -0.9 } },
    { id: "wunder", region: "germany", from: 1950, to: 1966, type: "boom", sev: 0.3, title: "The economic miracle", text: "Rubble cleared, factories humming, a Volkswagen in the yard." },
    { id: "wall", region: "germany", from: 1961, to: 1961, type: "flavor", title: "The Wall", text: "In one night Berlin is cut in two." },
    { id: "wallfalls", region: "germany", from: 1989, to: 1989, type: "flavor", title: "The Wall falls", text: "People dancing on it with hammers." },
    { id: "emig_de", region: "germany", from: 1890, to: 1913, type: "migration", dest: "america", p: 0.03, title: "Bremen to New York", text: "The steamers leave every week." },

    // America
    { id: "civilwar_us", region: "america", from: 1861, to: 1865, type: "war", sev: 0.45, title: "The Civil War", text: "North against South. Six hundred thousand dead." },
    { id: "panic1873", region: "america", from: 1873, to: 1873, type: "econ", sev: 0.3, title: "The Panic of 1873", text: "The railroad banks fail.", shock: { stocks: -0.4, lending: -0.2 } },
    { id: "crash29", region: "america", from: 1929, to: 1932, type: "econ", sev: 0.6, title: "The Crash and the Depression", text: "Black Tuesday. Then bread lines.", shock: { stocks: -0.6, lending: -0.3, land: -0.25 } },
    { id: "ww2_us", region: "america", from: 1942, to: 1945, type: "war", sev: 0.3, title: "The war", text: "Pearl Harbor. Everyone's son is in uniform." },
    { id: "postwar", region: "america", from: 1946, to: 1970, type: "boom", sev: 0.25, title: "The postwar boom", text: "Suburbs, cars, college on the GI Bill." },
    { id: "vietnam", region: "america", from: 1965, to: 1973, type: "war", sev: 0.1, title: "The draft", text: "Numbers drawn on television." },

    // shared, everywhere
    { id: "flu1918", region: "*", from: 1918, to: 1919, type: "plague", sev: 0.2, title: "The Spanish flu", text: "It kills the young and strong, not only the old.", cause: "the flu" },
    { id: "crash29w", region: "england|germany|finland|italy", from: 1930, to: 1932, type: "econ", sev: 0.4, title: "The Depression", text: "Factories close. Prices fall. Nobody is hiring.", shock: { stocks: -0.5, lending: -0.2 } },
    { id: "dotcom", region: "*", from: 2000, to: 2001, type: "econ", sev: 0.3, title: "The dot-com crash", text: "The internet companies were not worth what everyone said.", shock: { stocks: -0.45 } },
    { id: "gfc", region: "*", from: 2008, to: 2008, type: "econ", sev: 0.4, title: "The financial crisis", text: "Banks that were too big to fail, failing.", shock: { stocks: -0.45, land: -0.15 } },
    { id: "covid", region: "*", from: 2020, to: 2021, type: "plague", sev: 0.06, title: "The pandemic", text: "Masks, empty streets, grandparents behind windows.", cause: "the virus" },
  ];

  // background hazards when nothing scripted is happening (per year)
  function background(year) {
    if (year < 1700) return { famine: 0.012, plague: 0.010, war: 0.008 };
    if (year < 1900) return { famine: 0.006, plague: 0.007, war: 0.005 };
    if (year < 1950) return { famine: 0.002, plague: 0.003, war: 0.000 };
    return { famine: 0.0, plague: 0.001, war: 0.0 };
  }

  // how hard ordinary life is: age-driven mortality factor, infant and childbirth risk, and
  // 'adult' = deaths from accidents and infections that health and youth do not prevent
  function eraLife(year) {
    if (year < 1700) return { mort: 6.0, infant: 0.07, childbirth: 0.012, adult: 0.016 };
    if (year < 1850) return { mort: 4.5, infant: 0.05, childbirth: 0.009, adult: 0.012 };
    if (year < 1920) return { mort: 2.6, infant: 0.03, childbirth: 0.005, adult: 0.007 };
    if (year < 1960) return { mort: 1.5, infant: 0.008, childbirth: 0.001, adult: 0.002 };
    return { mort: 1.0, infant: 0.0008, childbirth: 0.0001, adult: 0.0004 };
  }

  // ---------------------------------------------------------------- work
  // wage is per year in internal units (10 units = a modest year of living)
  const PROFESSIONS = [
    { id: "labourer", label: "labourer", from: -9999, to: 9999, minClass: 0, wage: 9, risk: 0.2 },
    { id: "farmer", label: "farmer", from: -9999, to: 1960, minClass: 1, wage: 12, land: true, risk: 0.3 },
    { id: "artisan", label: "artisan", from: -9999, to: 1950, minClass: 1, wage: 14, risk: 0.15 },
    { id: "soldier", label: "soldier", from: -9999, to: 9999, minClass: 0, wage: 11, risk: 0.2, soldier: true },
    { id: "merchant", label: "merchant", from: -9999, to: 9999, minClass: 2, wage: 22, risk: 0.45 },
    { id: "cleric", label: "priest or scholar", from: -9999, to: 1900, minClass: 2, wage: 16, risk: 0.05 },
    { id: "landlord", label: "landowner", from: -9999, to: 1950, minClass: 4, wage: 40, land: true, risk: 0.2 },
    { id: "factory", label: "factory worker", from: 1770, to: 9999, minClass: 0, wage: 13, risk: 0.25 },
    { id: "clerk", label: "office clerk", from: 1850, to: 9999, minClass: 1, wage: 17, risk: 0.1 },
    { id: "engineer", label: "engineer", from: 1880, to: 9999, minClass: 2, wage: 28, risk: 0.15 },
    { id: "doctor", label: "doctor", from: 1880, to: 9999, minClass: 3, wage: 38, risk: 0.05 },
    { id: "coder", label: "software developer", from: 1980, to: 9999, minClass: 2, wage: 36, risk: 0.2 },
  ];

  // ---------------------------------------------------------------- investments
  // mean / spread of yearly return, and when the asset exists
  const ASSETS = [
    { id: "cash", label: "cash in the house", from: -9999, mu: 0.0, sd: 0.0 },
    { id: "land", label: "land", from: -9999, mu: 0.03, sd: 0.04 },
    { id: "trade", label: "trade ventures", from: -9999, mu: 0.07, sd: 0.30 },
    { id: "lending", label: "lending", from: 1200, mu: 0.045, sd: 0.06 },
    { id: "stocks", label: "shares", from: 1695, mu: 0.07, sd: 0.18 },
  ];
  function assetsAt(year, region) {
    return ASSETS.filter((a) => year >= a.from && !(a.id === "stocks" && region !== "england" && year < 1800));
  }

  function eventsAt(region, year) {
    return EVENTS.filter((e) => (e.region === "*" || e.region.split("|").includes(region)) && year >= e.from && year <= e.to);
  }

  const CLASSES = ["poor", "working", "middling", "wealthy", "elite"];
  function classOf(wealth) {
    return wealth < 5 ? 0 : wealth < 40 ? 1 : wealth < 200 ? 2 : wealth < 1200 ? 3 : 4;
  }

  const api = { REGIONS, NAMES, STARTS, EVENTS, PROFESSIONS, ASSETS, CLASSES, background, eraLife, assetsAt, eventsAt, classOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.History = api;
})(typeof window !== "undefined" ? window : globalThis);
