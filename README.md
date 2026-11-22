# Parachute

A co-op party game for a big screen and a room full of phones. The TV (or a laptop) shows a
playground parachute, and every phone is one of its twelve handles. Tip your phone up to lift
your edge, lay it flat to drop it, and flick it to snap a wave across the cloth. Work together
to launch balls through hoops, roll them onto glowing spots, sort them into holes and keep them
from flying off. Expect a lot of "everyone lift… NOW!".

Play it at **https://play.jadon.me/parachute/**: open that on the TV or laptop, then scan the
code with each phone. Best with 3–8 people; it takes up to 12.

## How it works

- **The big screen runs everything.** The cloth is a position-based simulation (631 particles,
  1,176 triangles, edge and bending constraints, long-range tethers to the handles, air drag
  along the normals) stepped at 120 Hz on a fixed timer, with balls that collide against the
  cloth's triangles. It's drawn with WebGL: sewn nylon panels with sheen and seams, ball and
  hoop shadows on the cloth, the cloth's shadow on a lamp-lit lawn, lanterns and fireflies.
- **Phones are handles.** Each phone turns its tilt into a height (0 flat … 1 upright, from
  `cos(beta)·cos(gamma)`, so portrait or landscape both work) and sends it ~30 times a second.
  A sharp jerk (linear acceleration above ~1.7 g) is a flick. No motion sensors? Drag the handle
  with a finger, or hold ↑/↓ and press space on a laptop.
- **Handles nobody holds** follow the hem between the nearest players on either side, so even
  two people control the whole parachute.
- **The server** (Node + `ws`) only relays: 4-letter rooms owned by one big screen, phone
  heights and flicks to it, its updates back out. Phones get a mini-map of the parachute from
  where they stand, a buzz when a ball is about to leave over their edge, and the coach's
  "Get low… 3, 2, 1, LIFT!" in time with the big screen.

## Levels

1. **Lift Off**: launch the ball through the hoop three times.
2. **Round the Rim**: roll the ball onto five glowing spots, each by a different player.
3. **Popcorn**: forty high pops from six kernels without losing them all.
4. **Colour Sort**: tip each ball into the hole of its colour.
5. **Sky Hoops**: a hoop that moves around the sky after every hit.
6. **Balloon Day**: keep a balloon aloft in a breeze.
7. **Storm**: hold on to three balls through 45 seconds of gusts.
8. **Fireworks**: as many hoop shots as you can in a minute.

Stars come from time (or balls kept, or shots); best stars are remembered on the big screen.

## Running it

```sh
npm install
npm start            # http://localhost:3135  (PORT and HOST are honoured)
npm test             # server relay test + bots playing every level on the real physics
```

- `?tv` forces the big screen, `?play` forces a handle. Without either, phones get the handle
  and anything larger becomes the big screen.
- `?tv&dev&bots=4` adds bot players to the big screen: `B`/`N` add or remove bots, `A` toggles
  their autopilot (off: arrow keys and space drive them), `1`–`8` start a level, `W`/`L` win or
  lose it. `window.__para` exposes the state.
- `?play&dev` on a handle simulates the phone: arrow keys (or W/S) tip it, space flicks.
- `node test/levels.js [level] [bots]` runs the autopilot through levels headlessly;
  `node test/probe.js key=value…` and `node test/sweep.mjs` measure the cloth (sag, launch
  height, how far a tilt rolls a ball) for tuning.
