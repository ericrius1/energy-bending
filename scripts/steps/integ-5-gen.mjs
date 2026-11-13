// The integration's takes (docs/reports/5-integration.md), run with scripts/critic-cap.mjs --prefix 5:
//   node scripts/steps/integ-5-gen.mjs && node scripts/critic-cap.mjs scripts/steps/integ-5.json --only <take> --prefix 5 --fps 10
// A fire and a water dancer in each world (wide and close; the locked view is critic-worlds.json's), the presets, plasma
// against ice, the field's reactions close up, ?baseline in each world, the scripted Pool jogo, a 30 s jogo against the
// real partner in the redwoods (locked, with the roda), and the roda from a free camera.
import { writeFileSync } from 'node:fs';

const WORLDS = ['geode', 'redwoods', 'pool', 'temple', 'forge'];
const dusk = (w) => (w === 'redwoods' ? "bend.set('redwoods', { hour: 19.4, dayGoes: false }); " : '');
const takes = [];
const pair = (name, query, dist, gap, extra = '', cues = { '0.8': "bend.move(0,'armada')", '1.8': "bend.move(1,'meia-lua')" }, seconds = 3, stills = [1, 2.2]) =>
  takes.push({
    name, query, fps: 30, seconds, warm: 300,
    setup: `${extra}bend.set('camera', { followDist: ${dist}, followFov: 44, followPitch: 0.12, followSwing: 0 }); bend.wake(); bend.place(0,${-gap / 2},0.3,Math.PI/2); bend.place(1,${gap / 2},0.3,-Math.PI/2);`,
    cues, each: 'bend.camera({ yaw: 0.2 + 0.05*t });', sheet: { cols: 4, rows: 2, width: 400 }, stills,
  });
for (const w of WORLDS) {
  pair(`pair-${w}-wide`, `play&two&dress=fire,water&world=${w}`, 7, 1.6, dusk(w));
  pair(`pair-${w}-close`, `play&two&dress=fire,water&world=${w}`, 2.8, 1.2, dusk(w));
}
for (const p of ['ember', 'tide', 'geodeheart', 'monolith', 'all']) pair(`preset-${p}`, `play&two&dress=${p},${p === 'monolith' ? 'all' : 'gems'}&world=${p === 'monolith' ? 'geode' : 'pool'}`, 3.2, 1.6);
pair('plasma-ice', 'play&two&dress=plasma,ice&world=pool', 2.6, 0.55, '', { '0.5': "bend.move(0,'armada')", '1.5': "bend.move(1,'armada')" }, 3, [0.8, 1.6, 2.4]);
// the field's reactions, close: a kick's wake bending flame; water thinning in heat; water freezing beside ice; ice melting beside fire
pair('react-kick', 'play&two&dress=fire,water&world=pool', 2.6, 1.3, '', { '0.5': "bend.move(1,'armada')", '1.5': "bend.move(1,'meia-lua')" }, 3, [0.9, 1.9]);
pair('react-thin', 'play&two&dress=fire,water&world=pool', 2.2, 0.45, '', {}, 4, [1, 3.5]);
pair('react-freeze', 'play&two&dress=ice,water&world=pool', 2.2, 0.45, '', {}, 4, [1, 3.5]);
pair('react-melt', 'play&two&dress=fire,ice&world=pool', 2.2, 0.45, '', {}, 4, [1, 3.5]);
for (const w of WORLDS) takes.push({ name: `baseline-${w}`, query: `baseline&play&two&dress=fire,water&world=${w}`, fps: 10, seconds: 1, warm: 240, setup: `${dusk(w)}bend.wake();`, stills: [0.5], sheet: { cols: 2, rows: 1, width: 640 } });
// the jogo agent's Pool script: a dodge, a clash, the invitation, the fusion, the release (64 beats at 112 bpm + intro)
takes.push({ name: 'jogo-pool', query: 'jogo=script&script=pool-fire-water', fps: 5, seconds: 44, warm: 1, sheet: { cols: 6, rows: 4, width: 330 }, stills: [8, 14, 20, 26, 30, 34, 38, 42] });
// against the real partner (src/ai): seat 0 played by a script of presses, 30 s, locked in the redwoods, the roda round it
const human = {};
const seq = ['meia-lua', 'esquiva', 'armada', 'spin', 'martelo', 'au', 'block', 'meia-lua', 'role', 'armada'];
for (let i = 0; i < 18; i++) human[(4 + i * 1.5).toFixed(1)] = `bend.move(0,'${seq[i % seq.length]}')`;
takes.push({ name: 'jogo-partner-redwoods', query: 'jogo=partner&world=redwoods&dress=fire,water', fps: 5, seconds: 30, warm: 1, setup: "bend.set('redwoods', { hour: 19.4, dayGoes: false }); await bend.jogo.start();", cues: human, sheet: { cols: 6, rows: 4, width: 330 }, stills: [6, 12, 18, 24, 29] });
takes.push({ name: 'roda-free', query: 'jogo=partner&world=geode&dress=fire,water&free', fps: 5, seconds: 12, warm: 1, setup: "await bend.jogo.start(); bend.set('camera', { followDist: 8, followPitch: 0.3 });", cues: { '3': "bend.move(0,'armada')", '6': "bend.move(0,'au')" }, sheet: { cols: 4, rows: 3, width: 400 }, stills: [8, 11.5] });
writeFileSync('scripts/steps/integ-5.json', JSON.stringify(takes, null, 1));
console.log(`scripts/steps/integ-5.json: ${takes.length} takes`);
