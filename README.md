# Matiks Duel Assistant

> A simple Chrome extension that detects and solves supported Matiks Math and Logic Duel questions.

Matiks Duel Assistant helps you calculate answers while playing supported duel modes on [Matiks](https://www.matiks.com/). Open a duel, click the extension, and let it read the visible question and calculate the answer for you.

The extension currently supports **Logic Duel**, **Math Sprint Duel**, and **Math Fast Finger First**. We plan to add more duel modes in future updates.

## What can it do?

- Solve supported **Logic Duel** questions.
- Solve arithmetic questions in **Math Sprint Duel**.
- Solve supported **Math Fast Finger First** questions.
- Detect questions directly from the page or from the visible game area.
- Display the detected question and calculated answer in a simple popup.
- Fill an answer without submitting it.
- Automatically detect and submit supported arithmetic questions when enabled.
- Work locally in your browser without uploading puzzle screenshots.

## Supported questions

The extension can currently solve:

- Addition, subtraction, multiplication, and division
- Calculations containing several numbers or operators
- Remainders and MOD
- Powers
- Square, cube, and indexed roots
- HCF / GCD
- LCM
- Prime factorization
- Sum of squares

Support can vary when Matiks changes its page layout or introduces a new question design.

## Installation

You do not need programming knowledge to install the extension.

### 1. Download the extension

1. Select the green **Code** button near the top of this GitHub page.
2. Select **Download ZIP**.
3. Extract the downloaded ZIP file to a folder on your computer.

Alternatively, developers can clone the repository:

```bash
git clone https://github.com/PrinceNR/Matiks_duel_solver.git
```

### 2. Add it to Chrome

1. Open Google Chrome.
2. Enter `chrome://extensions/` in the address bar.
3. Turn on **Developer mode** in the top-right corner.
4. Select **Load unpacked**.
5. Choose the extracted project folder—the folder that directly contains `manifest.json`.

The **Matiks Duel Assistant** icon should now appear in your extensions list. You can pin it from Chrome's Extensions menu for easier access.

## How to use it

### Solve one question

This is the easiest and safest way to try the extension:

1. Open [Matiks](https://www.matiks.com/) and start a supported duel.
2. Wait until the complete question is visible.
3. Select the **Matiks Duel Assistant** extension icon.
4. Select **Solve current puzzle**.
5. Check the detected question and calculated answer in the popup.

Logic Duel is intentionally handled one question at a time. Select **Solve current puzzle** for each new Logic Duel question.

### Fill without submitting

After the answer is calculated, select **Fill only**. The extension will place the answer in the game input but will not intentionally submit it. This lets you check the answer first.

### Continuous arithmetic solving

For supported Math Sprint and Fast Finger arithmetic rounds:

1. Turn on **Continuous math detection** to watch for new arithmetic questions.
2. Turn on **Auto-submit math answers** if you also want the extension to fill the answer and press Enter.

Try manual solving first and confirm that the extension reads your questions correctly before enabling automatic submission.

## Extension controls

| Control | What it does |
| --- | --- |
| **Solve current puzzle** | Reads the visible question and calculates its answer. |
| **Fill only** | Places the calculated answer in the input without intentionally submitting it. |
| **Continuous math detection** | Watches for new supported arithmetic rounds. |
| **Auto-submit math answers** | Fills and submits supported arithmetic answers automatically. |

## If it does not work

Try these quick fixes:

- Make sure you selected the folder that directly contains `manifest.json` during installation.
- Keep the complete question visible before selecting **Solve current puzzle**.
- Refresh the Matiks page and try again.
- Open `chrome://extensions/`, find this extension, and select **Reload** after installing an update.
- Keep Chrome zoom and Windows display scaling near their normal values if a visually rendered question is not recognized.
- Turn continuous detection off and on again after changing duel modes.

Matiks may update its interface at any time. Such changes can temporarily affect question detection until this extension is updated.

## How this project started

This project was **not built entirely from scratch**.

It is based on the work and idea from [@rashydaly's Matiks Duel Solver](https://github.com/rashydaly/Matiks-Duel-Solver), which already supported Logic Duel solving. We appreciate the original project and its contribution.

Building on that foundation, this project adds and improves support for:

- Math Sprint Duel solving
- Math Fast Finger First solving
- Visual arithmetic-question detection
- A redesigned, easier-to-use extension popup
- Separate manual Logic Duel and continuous arithmetic workflows

## How it works

At a high level, the extension:

1. Reads the visible Matiks question from the webpage.
2. Uses local visual recognition when the question is drawn instead of being available as normal text.
3. Converts the detected question into a clean mathematical expression.
4. Calculates the answer locally with JavaScript.
5. Shows the result and, only when requested, fills or submits it.

No server or external runtime is required. The project uses a Chrome Manifest V3 service worker, content scripts, browser storage, and a local JavaScript solving engine.

## Privacy

- Puzzle calculation happens locally in your browser.
- The extension does not upload captured puzzle images.
- It does not include analytics or remote JavaScript.
- It requests access only to supported Matiks pages.

You should always review the source code before installing any unpacked browser extension.

## Future plans

- Add support for more Matiks duel modes
- Improve recognition across different screen sizes and layouts
- Add more automated tests
- Make installation and usage even easier

Suggestions and contributions are welcome.

## Need help?

If you need any assistance, find a bug, or have a suggestion, please contact me. I am happy to help.

📧 **Email:** [princenrtvm@gmail.com](mailto:princenrtvm@gmail.com)

You can also open an issue in this repository and explain:

- Which duel mode you were playing
- What question appeared
- What answer you expected
- What the extension detected or displayed
- Your Chrome version and browser zoom level

## Disclaimer

This is an independent educational project and is not affiliated with, endorsed by, or sponsored by Matiks. Matiks names and visual assets belong to their respective owners.

Use the extension only where automation is allowed. Automated play may violate platform, classroom, competition, or tournament rules. You are responsible for using it fairly and following the applicable rules.

---

If this project helps you, consider giving the repository a ⭐. It helps others discover the extension and encourages future improvements.
