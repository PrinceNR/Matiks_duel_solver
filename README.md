# Matiks Duel Assistant

> A Chrome extension that reads Matiks Math and Logic Duel questions and works out the answer for you.

I built this to take the tedium out of grinding duels on [Matiks](https://www.matiks.com/). Open a duel, click the extension icon, and it reads whatever question is on screen and calculates the answer — no typing, no mental math under a timer.

Right now it handles **Logic Duel**, **Math Sprint Duel**, and **Math Fast Finger First**. More modes are on the way as I find time to add them.

## What it actually does

- Solves Logic Duel puzzles
- Solves arithmetic in Math Sprint Duel
- Solves supported Math Fast Finger First questions
- Reads the question straight off the page (or the visible game area, if it's rendered visually)
- Shows you the detected question and the answer in a small popup before anything happens
- Can fill the answer in without submitting it, so you can double-check first
- Can auto-detect and auto-submit arithmetic answers if you turn that on
- Runs entirely in your browser — nothing gets uploaded anywhere

## What it can solve

- Addition, subtraction, multiplication, division
- Multi-step expressions with several numbers or operators
- Remainders and MOD
- Powers
- Square roots, cube roots, and indexed roots
- HCF / GCD
- LCM
- Prime factorization
- Sum of squares

A quick caveat: Matiks tweaks its UI now and then, and when it does, detection can break until I catch up and push a fix. If something stops working, it's probably that.

## Getting it installed

You don't need to know how to code for this part.

**1. Grab the files**

- Click the green **Code** button at the top of this repo
- Choose **Download ZIP**
- Extract it somewhere you'll remember

If you're comfortable with git, you can just clone it instead:

```bash
git clone https://github.com/PrinceNR/Matiks_duel_solver.git
```

or you can give this readme file to chatgpt or claude and ask them to guide you

**2. Load it into Chrome**

1. Go to `chrome://extensions/`
2. Flip on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the folder that has `manifest.json` sitting directly inside it — not a subfolder, the actual root

That's it. You should see the Matiks Duel Assistant icon show up in your extensions list — pin it so it's easy to reach.

## Using it

### Solving a single question

This is the safest way to try it out first:

1. Open a duel on Matiks and wait until the whole question is visible on screen
2. Click the extension icon
3. Hit **Solve current puzzle**
4. Check the popup — it'll show what it read and what it calculated

Logic Duel is handled question-by-question on purpose, so you'll click **Solve current puzzle** again each time a new one shows up.

### Checking an answer before it gets submitted

Once you've got a calculated answer, hit **Fill only**. It drops the answer into the input box but doesn't press enter for you — good for a sanity check the first few times.

### Letting it run on its own for math rounds

For Math Sprint and Fast Finger First:

1. Turn on **Continuous math detection** — it'll start watching for new questions as they appear
2. If you also want it to submit automatically, turn on **Auto-submit math answers**

My honest recommendation: try it manually a few times first, make sure it's reading your questions correctly, *then* turn on auto-submit.

## The controls, quickly

| Control | Does what |
| --- | --- |
| Solve current puzzle | Reads what's on screen and calculates the answer |
| Fill only | Puts the answer in the box, doesn't submit |
| Continuous math detection | Keeps an eye out for new arithmetic questions |
| Auto-submit math answers | Fills and submits automatically |

## When something's not working

A few things worth checking before assuming it's broken:

- Double check you loaded the folder that directly contains `manifest.json`
- Make sure the full question is visible before clicking Solve
- A plain refresh of the Matiks page fixes more than you'd expect
- After updating the extension, go to `chrome://extensions/` and hit **Reload**
- If a rendered (image-style) question isn't being picked up, check that Chrome zoom and your display scaling are at normal levels
- Switched duel modes and continuous detection is acting weird? Toggle it off, then on again

## Where this came from

This isn't built from a blank slate — it's based on [@rashydaly's Matiks Duel Solver](https://github.com/rashydaly/Matiks-Duel-Solver), which already had Logic Duel solving working. Credit to that project for the foundation.

What I've added on top of it:

- Math Sprint Duel support
- Math Fast Finger First support
- Visual detection for questions that are rendered rather than plain text
- A popup that's easier to actually use
- Separate, cleaner workflows for manual Logic Duel solving vs. continuous math solving

## How it works, roughly

1. Pulls the visible question off the Matiks page
2. Falls back to local visual recognition if the question is rendered as an image instead of text
3. Turns whatever it detects into a clean expression
4. Does the math in plain JavaScript, locally
5. Shows you the result, and only fills or submits it if you've asked it to

No server, no external API calls. Just a Manifest V3 service worker, a content script, and a solving engine that runs in your browser.

## On privacy

- Everything is calculated on your machine
- No puzzle screenshots or images are ever uploaded
- No analytics, no remote scripts
- It only asks for permission on Matiks pages

As with any unpacked extension, it's worth skimming the source before you install it — that's just good practice, not specific to this project.

## What's next

- Support for more duel modes
- Better recognition across different screen sizes
- More automated testing
- Smoothing out install and setup even further

If you've got ideas or run into something odd, I'd genuinely like to hear about it.

## Found a bug, or just want to say hi?

Email me: [princenrtvm@gmail.com](mailto:princenrtvm@gmail.com)

Or open an issue here and include:

- Which duel mode you were playing
- What the question was
- What you expected the answer to be
- What the extension actually showed
- Your Chrome version and browser zoom level

## Disclaimer

This is an independent, educational side project — not affiliated with or endorsed by Matiks. All Matiks names and visual assets belong to their respective owners.

Please use this only where automation is actually allowed. Some classrooms, competitions, and tournaments have rules against this kind of thing, and that's on you to check and respect.

---

If this saved you some time, a ⭐ on the repo goes a long way — it helps other people find it and keeps me motivated to keep improving it.
