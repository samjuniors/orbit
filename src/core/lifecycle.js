// Encapsulates window lifecycle, system tray menus, and single-instance handling
// for ORBIT Windows Worker, keeping them pure and testable.

function shouldHideWindowOnClose({ isQuitting }) {
  return !isQuitting;
}

function handleSecondInstance({ mainWindow }) {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  }
  return false;
}

function buildTrayMenuTemplate({ isPaused, onOpen, onTogglePause, onSettings, onQuit }) {
  return [
    { label: 'Open ORBIT', click: () => onOpen?.() },
    { label: isPaused ? 'Resume queue' : 'Pause queue', click: () => onTogglePause?.(!isPaused) },
    { label: 'Settings', click: () => onSettings?.() },
    { type: 'separator' },
    { label: 'Quit ORBIT', click: () => onQuit?.() }
  ];
}

function canAutoStartWorker({ settings }) {
  if (!settings) return false;
  if (!settings.onboardingComplete) return false;
  if (settings.autoRunEnabled === false) return false;
  if (settings.schedule?.enabled) return false;
  return true;
}

module.exports = {
  shouldHideWindowOnClose,
  handleSecondInstance,
  buildTrayMenuTemplate,
  canAutoStartWorker
};
