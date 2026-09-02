const STORAGE_KEY = 'logicDuelSolverState';

document.addEventListener('DOMContentLoaded', async () => {
  const modeValue = document.getElementById('modeValue');
  const targetValue = document.getElementById('targetValue');
  const solvedAnswer = document.getElementById('solvedAnswer');
  const statusEl = document.getElementById('status');
  const connectionEl = document.getElementById('connection');
  const scanButton = document.getElementById('scanButton');
  const fillButton = document.getElementById('fillButton');
  const watchToggle = document.getElementById('watchToggle');
  const autoFillToggle = document.getElementById('autoFillToggle');

  // Load saved state and auto-fill preference
  const stored = await chrome.storage.local.get([STORAGE_KEY, 'autoFillSubmitEnabled']);
  const state = stored[STORAGE_KEY];
  if (state) {
    updateUI(state);
  }

  if (autoFillToggle) {
    autoFillToggle.checked = Boolean(stored['autoFillSubmitEnabled']);
    autoFillToggle.addEventListener('change', async () => {
      await chrome.storage.local.set({ autoFillSubmitEnabled: autoFillToggle.checked });
    });
  }

  if (watchToggle && state) {
    watchToggle.checked = Boolean(state.autoWatch);
  }

  // Poll state updates
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'LOGIC_STATE_UPDATED' && message.state) {
      updateUI(message.state);
    }
  });

  // Scan / Solve Now Button Click
  scanButton.addEventListener('click', async () => {
    try {
      scanButton.disabled = true;
      setStatus('Reading the current puzzle...', 'info');

      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const isAutoFillActive = autoFillToggle ? autoFillToggle.checked : false;

      // Auto-fill keeps its existing behavior. With auto-fill off, a normal
      // scan is allowed to submit only a recognized Logic Duel puzzle. This
      // makes Logic Duel strictly one-puzzle-per-click without changing the
      // Math/Sprint/Fast Finger workflow.
      const messageType = isAutoFillActive ? 'SOLVE_AND_SUBMIT' : 'SCAN_NOW';
      const response = await chrome.runtime.sendMessage({
        type: messageType,
        tabId: tab?.id,
        submitLogic: !isAutoFillActive,
      });

      if (response && response.ok && response.result) {
        updateUI(response.result);
        const submitted = isAutoFillActive || response.result.puzzleFamily === 'logic';
        setStatus(submitted ? 'Answer calculated and submitted.' : 'Answer calculated successfully.', 'success');
      } else {
        throw new Error(response?.error || 'Could not solve the puzzle.');
      }
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      scanButton.disabled = false;
    }
  });

  // Manual Fill Button Click
  fillButton.addEventListener('click', async () => {
    try {
      const answer = solvedAnswer.textContent;
      if (!answer || answer === '—') {
        throw new Error('No answer available to fill.');
      }
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const response = await chrome.runtime.sendMessage({ type: 'FILL_ANSWER', answer, tabId: tab?.id });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Could not fill the answer.');
      }
      setStatus('Answer filled. Press Enter when you are ready.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  // Auto Watch Toggle Change
  if (watchToggle) {
    watchToggle.addEventListener('change', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const response = await chrome.runtime.sendMessage({
          type: 'SET_AUTO_WATCH',
          enabled: watchToggle.checked,
          tabId: tab?.id,
        });
        if (response && response.ok && response.result) {
          updateUI(response.result);
        }
      } catch (error) {
        watchToggle.checked = !watchToggle.checked;
        setStatus(error.message, 'error');
      }
    });
  }

  function updateUI(currentState) {
    if (!currentState) return;

    modeValue.textContent = currentState.mode || 'Waiting for a puzzle';
    targetValue.textContent = currentState.value || '—';
    solvedAnswer.textContent = currentState.solution?.answer || '—';

    if (currentState.status) {
      setStatus(currentState.status, currentState.solution?.answer ? 'success' : 'info');
    }

    if (watchToggle) {
      watchToggle.checked = Boolean(currentState.autoWatch);
    }

    if (connectionEl) {
      connectionEl.classList.add('active');
    }
  }

  function setStatus(text, type = 'info') {
    statusEl.textContent = text;
    statusEl.className = 'status';
    if (type === 'error') statusEl.classList.add('error');
    if (type === 'success') statusEl.classList.add('success');
  }
});
