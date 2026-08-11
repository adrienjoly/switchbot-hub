const assert = require('node:assert/strict');
const { buildTemperatureChangeSentence } = require('./switchbot-temps.js');

const increase = buildTemperatureChangeSentence('Salon', 20.0, 21.2);
assert.equal(increase, 'la température de Salon a augmenté de 1.2 degrés');

const decrease = buildTemperatureChangeSentence('Chambre', 22.1, 20.8);
assert.equal(decrease, 'la température de Chambre a baissé de 1.3 degrés');

const same = buildTemperatureChangeSentence('Cuisine', 19.5, 19.5);
assert.equal(same, null);

console.log('ok');
