import { CloudSync } from '../shared/cloud-store.js';
import { setupProfile } from './profile.js';
import { setupActivities } from './activities.js';

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Frontend initialized");
    await CloudSync.init();
    setupProfile();
    setupActivities();
});
