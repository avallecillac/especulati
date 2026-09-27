import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { requestPersistentStorage } from './lib/pwa.svelte.ts';

mount(App, { target: document.getElementById('app')! });
void requestPersistentStorage();
