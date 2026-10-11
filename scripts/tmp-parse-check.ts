import { parseQuantity } from '../lib/units';

for (const s of ['10 Hz oscillation with a 10 mm stroke', '0.2 m/s', '6 µm/s', '10 Hz, 10 mm stroke (mean 0.2 m/s)']) {
  console.log(JSON.stringify(s), '=>', JSON.stringify(parseQuantity(s, 'velocity')));
}
