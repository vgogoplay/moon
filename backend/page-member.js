import { initAdminLayout } from './layout.js';
import { setupRoster } from './roster.js';
import { setupStateControls } from './state.js';

document.addEventListener('DOMContentLoaded', () => {
    initAdminLayout('member', () => {
        setupStateControls();
        setupRoster();
        window.onCloudUpdate = () => {
            setupStateControls();
            setupRoster();
        };
    });
});
