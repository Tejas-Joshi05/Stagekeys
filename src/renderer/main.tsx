import './app/styles.css';
import { runControl } from './app/control';
import { runStage } from './presenter';
import { errorMessage, logger } from './shared/log';

const root = document.getElementById('root');
if (root) {
  const start = window.location.hash === '#stage' ? runStage(root) : runControl(root);
  start.catch((e: unknown) => {
    logger.error('Window failed to start', errorMessage(e));
    root.textContent =
      'Stagekeys could not start. The details are in the log (Help → Open Log Folder).';
  });
}
