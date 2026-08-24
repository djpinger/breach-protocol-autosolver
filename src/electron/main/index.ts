import { app } from 'electron';
import { Main } from './main';

// When launched detached from a terminal (desktop launcher, taskbar icon),
// stdout/stderr can be backed by a pipe whose reader goes away shortly after
// spawn. The next console.log/warn/error anywhere in the process (electron
// -updater's default logger is plain `console`) then throws an unhandled
// EPIPE and crashes the whole app. Swallow those instead of dying on them.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

app.once('ready', () => {
  if (app.requestSingleInstanceLock()) {
    const main = new Main();

    main.init();
  } else {
    app.exit();
  }
});
