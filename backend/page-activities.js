import { initAdminLayout } from './layout.js';
import { setupCustomActs } from './custom-activities.js';
import { setupActivityStats } from './activity-stats.js';

document.addEventListener('DOMContentLoaded', () => {
    initAdminLayout('activity', () => {
        setupActivityStats();
        setupCustomActs();
        window.onCloudUpdate = () => {
            setupActivityStats();
            setupCustomActs();
        };
    });
});
