import { CloudSync } from '../shared/cloud-store.js';
import { renderRoster } from './roster.js';

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Backend initialized");
    await CloudSync.init();
    renderRoster();
});
