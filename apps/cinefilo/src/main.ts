import './theme/fonts.css';
import './theme/beton.css';
import './theme/willis.css';
import './theme/type.css';
import './theme/details.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { initAppearance } from './lib/appearance.svelte.ts';

// Lists put the scroll position back themselves (screens/List.svelte); the browser must not fight them.
history.scrollRestoration = 'manual';
initAppearance();
mount(App, { target: document.getElementById('app')! });
