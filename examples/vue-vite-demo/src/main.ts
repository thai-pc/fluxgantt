import './temporal.js'; // must stay first: installs globalThis.Temporal where it is not native
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
