import { mount } from 'svelte';
import './theme/fonts.css';
import './theme/base.css';
import './theme/macondo.css';
import './theme/patriarca.css';
import './app.css';
import App from './App.svelte';
import { initAppearance } from './lib/appearance.svelte.ts';
import { requestPersistentStorage } from './lib/pwa.svelte.ts';

initAppearance();
mount(App, { target: document.getElementById('app')! });
void requestPersistentStorage();
