import './theme/fonts.css';
import './theme/beton.css';
import './theme/willis.css';
import './theme/type.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { initAppearance } from './lib/appearance.svelte.ts';

initAppearance();
mount(App, { target: document.getElementById('app')! });
