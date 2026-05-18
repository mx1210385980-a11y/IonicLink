import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { installChunkLoadRecovery } from './lib/lazyComponent'

(window as any).__IONICLINK_BUILD_ID = '2026-05-18-preload-gzip-fix'

installChunkLoadRecovery()
createApp(App).use(router).mount('#app')
