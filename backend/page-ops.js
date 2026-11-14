import { initAdminLayout } from './layout.js';
import { setupOpsTools } from './state.js'; // reused state modules for mails/reports

document.addEventListener('DOMContentLoaded', () => {
    initAdminLayout('ops', () => {
        setupOpsTools();
        window.onCloudUpdate = () => {
            setupOpsTools();
        };
    });
});
